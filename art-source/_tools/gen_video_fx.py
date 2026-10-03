# -*- coding: utf-8 -*-
"""
《云岫》美术组视频素材后处理
==========================

把 `assets/Resources/视频合集/` 里美术组给的 9 段 mp4 处理成引擎可用的
PNG 序列（RGBA），**不改动源文件**。

用法::

    python gen_video_fx.py --analyze           # 只测量 + 出预览，不写序列
    python gen_video_fx.py --export            # 全量导出 PNG 序列
    python gen_video_fx.py --export --only 狐火-静息
    python gen_video_fx.py --export --fps 12   # 抽帧降采样（省显存）

产出落到 `art-source/_video_out/<视频名>/`，含 `manifest.json`。

处理的四件事
------------
1. **去背景** —— 源视频底是烧死在画面里的浅色宣纸，不是绿幕。做法是
   「估一个全局底色 → 硬阈值 → 形态学闭运算补轮廓缺口 → 填洞」。
   填洞是关键：扁平卡通和九尾狐的水墨稿都有闭合的深色描边，把封闭区域
   整体判为前景，才能救回内部那些**恰好和底色相近**的地方（浅色火焰、
   白狐的身体、白色高光）—— 只靠色距阈值会把它们一起抠掉。

2. **首尾接得上** —— 循环动画要么裁掉尾巴让末帧接回首帧（`trim`），
   要么把整段左右镜像接在后面（`mirror`，给「狐火-转身」用：转过去、
   再转回来）。

3. **主体等大** —— 同组内按「主体包围盒高度」的中位数统一缩放，
   让狐火三个动画里的狐狸一样大、九尾狐三阶段一样大。

4. **落 PNG 序列** —— 没有音轨问题（序列本来就没声音），PNG 天然带 alpha，
   所以不需要 ffmpeg 编码透明视频。

⚠️ 为什么不做「颜色反混合」（unmultiply）
----------------------------------------
把半透明像素里混进去的白底减掉、还原"真实颜色"，理论上合成到任意底色上都更准。
但本作底色就是**浅色宣纸**（见 `art-source/README.md` 的硬约束），
不减反而更接近美术组画出来的观感。需要时用 `--decontaminate` 打开对比。
"""

import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np
import cv2
from scipy import ndimage
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # art-source/
PROJECT = os.path.dirname(ROOT)                    # 仓库根

SRC_DIR = os.path.join(PROJECT, "assets", "Resources", "视频合集")
OUT_DIR = os.path.join(ROOT, "_video_out")
PREVIEW_DIR = os.path.join(ROOT, "_preview", "video")

# --- 分组：同组共用一个画布尺寸，主体缩放到一样大 ---------------------------
GROUPS = {
    # alpha = 抠背景；fit = 按主体包围盒缩放居中（sprite 用）。
    # 两者是两件事：全屏那三段要抠背景，但**不能**做主体缩放 —— 它得铺满画布。
    "A": dict(canvas=(384, 384), alpha=True, fit=True, fmt="png",
              label="狐火 · 小怪（三个动画主体等大）"),
    "B": dict(canvas=(768, 768), alpha=True, fit=True, fmt="png",
              label="九尾狐 · 三阶段（比狐火大，主体等大）"),
    # 全屏三段要**叠在调暗的游戏画面上**播，所以必须带 alpha：
    # 水墨大片留白处要透出后面的场景，不透明的话就是一块白板盖住画面。
    #
    # 曾试过 VP9/WebM 透明视频（26MB vs 517MB），已放弃：Cocos 3.8.8 的
    # video-clip 导入器不认 .webm，且 Web 端 VideoPlayer 是 DOM <video> 元素，
    # 画布里的任何东西都盖不到它上面。改用 PNG 序列，代价是体积。
    "C": dict(canvas=(1920, 1080), alpha=True, fit=False, fmt="png",
              label="阶段转换 / 最终净化 · 全屏叠放（不循环）"),
    # 戴头盔持弓的阳浊小怪。和狐火（A 组）分开：体型差着一档，
    # 归一化到同一个画布会让其中一方过大或过小。
    "D": dict(canvas=(512, 512), alpha=True, fit=True, fmt="png",
              label="阳浊小怪（行走 / 攻击，主体等大）"),
}

# VP9 带 alpha 的编码参数。CRF 越低越清晰、体积越大。
WEBM = dict(crf=32, cpu_used=2)

# (视频名, 组, 循环方式[, 是否左右镜像])   loop: "trim" | "mirror" | None
#
# ⚠️ 第 4 项「左右镜像」是为**素材朝向不一致**准备的。
# 项目约定所有角色一律朝右绘制（`art-source/README.md`），但美术组交来的视频
# 未必遵守 —— 实测「小怪-行走」朝右、「小怪-攻击」朝左，同一只小怪的两段动画
# 左右相反。不统一的话，游戏里 `applyFacingFlip` 只能迁就一边、另一边必然反。
VIDEOS = [
    ("狐火-静息",           "A", "trim"),
    ("狐火-上升",           "A", "trim"),
    ("狐火-转身",           "A", "mirror"),
    ("九尾狐-幻影",         "B", "trim"),
    ("九尾狐-狂乱",         "B", "trim"),
    ("九尾狐-归心",         "B", "trim"),
    ("九尾狐-幻影狂乱衔接", "C", None),
    ("九尾狐-狂乱归心衔接", "C", None),
    ("九尾狐-最终净化",     "C", None),
    ("小怪-行走",           "D", "trim"),
    # 攻击是一次性动作，不循环。
    # 素材画的是**朝左**（弓在左、箭囊在右），和行走那条相反，所以镜像过来统一朝右。
    ("小怪-攻击",           "D", None, True),
]

# 抠像参数（按素材风格统一，个别视频可覆盖）
KEY = dict(lo=12.0, hard=38.0, close=5, min_speck=0)
# 循环点交叉淡化：接缝比超过 min_ratio 才补一道（淡化会留重影，能不用就不用）
CFADE = dict(min_ratio=2.0, trim=6, mirror=8)
# 主体占画布的比例（长边方向），决定缩放目标
SUBJECT_FRAC = 0.72
FEAT_PX = 96          # 循环匹配用的特征图边长


# --------------------------------------------------------------------------
# 解码 / 抠像
# --------------------------------------------------------------------------
def open_video(path):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"打不开视频：{path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    return cap, fps, n


def iter_frames(path, stride=1, scale=1.0):
    """
    流式出帧，避免把整段视频读进内存（1080p×193 帧就有 1.2GB）。

    ⚠️ 这里把 OpenCV 的 BGR 翻成 RGB。下游一律按 RGB 处理，
    否则存 PNG 时会红蓝互换（踩过：狐火的深藏青会变成暗红）。
    """
    cap, _, _ = open_video(path)
    i = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if i % stride == 0:
                if scale != 1.0:
                    frame = cv2.resize(frame, None, fx=scale, fy=scale,
                                       interpolation=cv2.INTER_AREA)
                yield i, frame[:, :, ::-1]
            i += 1
    finally:
        cap.release()


def estimate_bg(path, band=16, nsample=40):
    """边框一圈的中位色 —— 采样若干帧再取中位，抗主体出画。返回 RGB。"""
    cap, _, n = open_video(path)
    step = max(1, n // nsample)
    acc = []
    try:
        for p in range(0, n, step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, p)
            ok, im = cap.read()
            if not ok:
                continue
            px = np.concatenate([im[:band].reshape(-1, 3), im[-band:].reshape(-1, 3),
                                 im[:, :band].reshape(-1, 3), im[:, -band:].reshape(-1, 3)])
            acc.append(np.median(px, axis=0)[::-1])      # BGR → RGB，和 iter_frames 对齐
    finally:
        cap.release()
    if not acc:
        raise RuntimeError(f"取不到帧：{path}")
    return np.median(np.stack(acc), axis=0).astype(np.float32)


def key_frame(rgb, bg, lo, hard, close, min_speck=0):
    """底色 → alpha。返回 (alpha float32 0..1, 前景掩码 uint8)。"""
    d = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2)
    m = (d > hard).astype(np.uint8)

    if close:                       # 闭运算补轮廓上的小缺口，否则填洞会漏
        k = np.ones((close, close), np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)

    if min_speck:                   # 抹掉压缩噪点，但保留狐火那种小火星
        nlab, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
        if nlab > 1:
            small = np.zeros(nlab, bool)
            small[1:] = stats[1:, cv2.CC_STAT_AREA] < min_speck
            m[small[lab]] = 0

    filled = ndimage.binary_fill_holes(m)          # 封闭区间整体判为前景
    a = np.clip((d - lo) / max(1e-6, hard - lo), 0, 1)
    a = np.maximum(a, filled.astype(np.float32))
    return a, m


def decontaminate(rgb, alpha, bg):
    """反混合：把半透明像素里混着的底色减掉，还原直通色。"""
    a = np.maximum(alpha, 1e-3)[..., None]
    out = (rgb.astype(np.float32) - (1.0 - a) * bg) / a
    return np.clip(out, 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------
# 循环处理
# --------------------------------------------------------------------------
def loop_trim(feats, window_frac=0.35):
    """
    在尾巴里找一帧和首帧最像的，把它前面的帧丢掉，让末帧自然接回首帧。
    返回 (keep 帧数, 接缝误差, 相邻帧典型误差)。
    """
    n = len(feats)
    if n < 6:
        return n, 0.0, 0.0
    w = max(3, int(n * window_frac))
    lo = max(1, n - w)
    f0 = feats[0]
    dists = [np.abs(feats[j] - f0).mean() for j in range(lo, n)]
    j = lo + int(np.argmin(dists))

    seam = float(np.abs(feats[j - 1] - feats[0]).mean())   # 保持 [0, j) 后的接缝
    step = float(np.mean([np.abs(feats[i + 1] - feats[i]).mean() for i in range(n - 1)]))
    return j, seam, step


def mirror_append(arrs):
    """整段左右镜像接在后面：转过去、再转回来。"""
    return arrs + [a[:, ::-1] for a in arrs]


def mirror_plan(feats):
    """
    给镜像拼接挑切点 k：序列取 [0..k]，再接上它的镜像。

    拼接处（f_k → mirror(f_0)）和回绕处（mirror(f_k) → f_0）的帧差是恒等的
    （镜像等距，两边互为镜像），所以只需最小化 ||f_k − mirror(f_0)|| 这一个量。
    不用整段硬接 —— 转身未必刚好转到 180°，多半存在更顺的切点。
    """
    n = len(feats)
    f0m = feats[0][:, ::-1]
    best_k, best_d = n - 1, None
    for k in range(n // 2, n):
        d = float(np.abs(feats[k] - f0m).mean())
        if best_d is None or d < best_d:
            best_k, best_d = k, d
    step = float(np.mean([np.abs(feats[i + 1] - feats[i]).mean() for i in range(n - 1)]))
    return best_k + 1, best_d, step


def blend_loop(frames, m):
    """
    循环点交叉淡化：把最后 m 帧逐步让位给最前面的 m 帧。

    序列长度不变，但末帧会被淡成接近 frames[m-1]，于是「末帧 → 首帧」这一步
    退化成动画自己的一个正常步长，接缝就看不出来了。

    ⚠️ 必须按**预乘 alpha** 混合。直接插值直通 RGBA 的话，透明区的 RGB
    （这里是 0）会渗进边缘，淡出一圈黑边。
    """
    L = len(frames)
    if m <= 0 or L < 2 * m + 4:
        return frames
    out = list(frames)
    for j in range(m):
        w = (j + 1) / (m + 1)
        a = frames[L - m + j].astype(np.float32)
        b = frames[j].astype(np.float32)
        fa, fb = a[..., 3:4] / 255.0, b[..., 3:4] / 255.0
        pa = a[..., :3] * fa * (1.0 - w) + b[..., :3] * fb * w
        fa2 = fa * (1.0 - w) + fb * w
        rgb = pa / np.maximum(fa2, 1e-4)
        out[L - m + j] = np.dstack(
            [np.clip(rgb, 0, 255), np.clip(fa2 * 255.0, 0, 255)]).astype(np.uint8)
    return out


def encode_webm(frames, path, fps, crf=32, cpu_used=2):
    """
    RGBA 帧 → 带 alpha 的 WebM（VP9 / yuva420p）。

    `-auto-alt-ref 0` 不能省：VP9 的隐藏 alt-ref 帧和 alpha 通道不兼容，
    开着编出来在多数播放器上 alpha 会整个丢掉（画面变黑底）。

    ⚠️ **验证 alpha 时必须显式指定 libvpx 解码器**：:

        ffmpeg -c:v libvpx-vp9 -i x.webm -f rawvideo -pix_fmt rgba out.rgba

    ffmpeg 默认走原生 vp9 解码器，它**不报错、也不警告，直接给你 alpha=255**，
    看上去就像 alpha 编丢了。实际编码是好的（踩过，白查了一轮）。
    """
    import imageio_ffmpeg
    h, w = frames[0].shape[:2]
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}",
           "-r", str(fps), "-i", "-",
           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
           "-crf", str(crf), "-b:v", "0",
           "-auto-alt-ref", "0", "-row-mt", "1", "-cpu-used", str(cpu_used),
           # WebM 的 alpha 约定，部分播放器/引擎靠它识别通道
           "-metadata:s:v:0", "alpha_mode=1",
           path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for fr in frames:
        p.stdin.write(np.ascontiguousarray(fr).tobytes())
    p.stdin.close()
    err = p.stderr.read().decode("utf-8", "replace").strip()
    if p.wait() != 0:
        raise RuntimeError(f"ffmpeg 编码失败：\n{err}")
    return err


def loop_quality(frames, px=96):
    """
    量**最终序列**的回绕接缝：末帧 → 首帧的帧差 ÷ 相邻帧的典型帧差。

    必须在成品帧上量，不能在源帧上量 —— 镜像是在「居中 + 缩放」之后做的，
    源帧上量出来的接缝和真正播出来的不是一回事（踩过）。
    """
    small = []
    for f in frames:
        h, w = f.shape[:2]
        s = px / max(h, w)
        g = cv2.resize(f[..., :3], (max(2, int(w * s)), max(2, int(h * s))),
                       interpolation=cv2.INTER_AREA).astype(np.float32)
        a = cv2.resize(f[..., 3], (g.shape[1], g.shape[0]),
                       interpolation=cv2.INTER_AREA).astype(np.float32)[..., None] / 255.0
        small.append(g * a)
    step = np.mean([np.abs(small[i + 1] - small[i]).mean() for i in range(len(small) - 1)])
    seam = np.abs(small[-1] - small[0]).mean()
    return float(step), float(seam)


def loop_candidates(feats, topn=5):
    """列出尾巴里最像首帧的几个候选切点，用来判断到底存不存在好的循环点。"""
    n = len(feats)
    step = np.mean([np.abs(feats[i + 1] - feats[i]).mean() for i in range(n - 1)])
    d = [(j, float(np.abs(feats[j] - feats[0]).mean())) for j in range(n // 2, n)]
    d.sort(key=lambda t: t[1])
    return d[:topn], step


# --------------------------------------------------------------------------
# 主体定位 / 缩放
# --------------------------------------------------------------------------
def subject_box(alpha, thr=0.5):
    ys, xs = np.where(alpha > thr)
    if len(ys) == 0:
        return None
    return xs.min(), ys.min(), xs.max(), ys.max()


def plan_scale(boxes, canvas, frac=SUBJECT_FRAC):
    """按包围盒中位数定缩放，长边吃到 frac，同时保证短边装得下。"""
    hs = np.array([b[3] - b[1] + 1 for b in boxes], np.float32)
    ws = np.array([b[2] - b[0] + 1 for b in boxes], np.float32)
    cx = np.array([(b[0] + b[2]) / 2.0 for b in boxes], np.float32)
    by = np.array([b[3] for b in boxes], np.float32)
    mh, mw = float(np.median(hs)), float(np.median(ws))
    cw, ch = canvas
    s = min(frac * ch / mh, frac * cw / mw)
    return dict(scale=s, med_h=mh, med_w=mw,
                cx=float(np.median(cx)), bottom=float(np.median(by)))


def place(rgb, alpha, plan, canvas):
    """
    缩放并摆到画布上。

    水平：把主体包围盒的中位中心对到画布中线。
    垂直：把主体的中位脚底对到同一条水平线上 —— 同组各动画因此「站在同一地面」。
    两者都用中位数而非逐帧值，主体自身的起伏（火焰长高、转身）才不会被抵消掉。
    """
    ch, cw = canvas[1], canvas[0]
    s = plan["scale"]
    h, w = rgb.shape[:2]
    nh, nw = max(1, int(round(h * s))), max(1, int(round(w * s)))
    interp = cv2.INTER_AREA if s < 1 else cv2.INTER_LANCZOS4
    rgb_s = cv2.resize(rgb, (nw, nh), interpolation=interp)
    a_s = cv2.resize(alpha, (nw, nh), interpolation=interp)

    cx_t = plan["cx"] * s                      # 主体中心在缩放图中的 x
    by_t = plan["bottom"] * s                  # 主体脚底在缩放图中的 y
    ground = ch * (1.0 - (1.0 - SUBJECT_FRAC) / 2.0)   # 画布上的地面线

    ox = int(round(cw / 2.0 - cx_t))
    oy = int(round(ground - by_t))

    out_rgb = np.zeros((ch, cw, 3), np.uint8)
    out_a = np.zeros((ch, cw), np.float32)

    sx0, sy0 = max(0, ox), max(0, oy)
    dx0, dy0 = max(0, -ox), max(0, -oy)
    ww = min(nw - dx0, cw - sx0)
    hh = min(nh - dy0, ch - sy0)
    if ww > 0 and hh > 0:
        out_rgb[sy0:sy0 + hh, sx0:sx0 + ww] = rgb_s[dy0:dy0 + hh, dx0:dx0 + ww]
        out_a[sy0:sy0 + hh, sx0:sx0 + ww] = a_s[dy0:dy0 + hh, dx0:dx0 + ww]
    return out_rgb, out_a


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
def analyze_and_build(name, group, loop, stride=1, flip_x=False):
    """第一遍：抠像 → 统计主体 → 定缩放 → 定循环点。返回构建计划。"""
    g = GROUPS[group]
    src = os.path.join(SRC_DIR, name + ".mp4")
    canvas = g["canvas"]

    bg = estimate_bg(src) if g["alpha"] else None
    boxes, feats = [], []
    n_frames = 0
    for _, frame in iter_frames(src, stride=stride):
        if flip_x:
            frame = frame[:, ::-1]
        n_frames += 1
        if not g["fit"]:            # 全屏三段不做主体统计，它要铺满画布
            continue
        a, _ = key_frame(frame, bg, **KEY)
        b = subject_box(a)
        if b:
            boxes.append(b)
        small = cv2.resize(frame, (FEAT_PX, FEAT_PX), interpolation=cv2.INTER_AREA).astype(np.float32)
        sa = cv2.resize(a, (FEAT_PX, FEAT_PX), interpolation=cv2.INTER_AREA)[..., None]
        feats.append(small * sa)          # 带 alpha 的特征：形状和颜色都算进去

    plan = dict(name=name, group=group, loop=loop, canvas=canvas,
                bg=bg, n_src=n_frames, fps=None)

    if g["fit"]:
        plan["fit"] = plan_scale(boxes, canvas)
        if loop == "trim":
            keep, seam, step = loop_trim(feats)
            plan.update(keep=keep, seam=seam, step=step)
        elif loop == "mirror":
            keep, best_d, step = mirror_plan(feats)
            plan.update(keep=keep, seam=best_d, step=step)
        plan["feats"] = feats
    return plan


def export_one(plan, decon=False, stride=1, crossfade=0, flip_x=False):
    g = GROUPS[plan["group"]]
    src = os.path.join(SRC_DIR, plan["name"] + ".mp4")
    canvas = g["canvas"]
    out_dir = os.path.join(OUT_DIR, plan["name"])
    os.makedirs(out_dir, exist_ok=True)
    # 清掉上一次的产物。换过输出格式后新旧文件会并存在同一目录里，
    # 体积统计和后续打包都会因此失真（踩过：webm 目录里躺着 193 张旧 PNG）。
    for f in os.listdir(out_dir):
        if f.endswith((".png", ".webm")) or f == "manifest.json":
            os.remove(os.path.join(out_dir, f))

    rgba_frames = []          # 序列不长（≤500 帧 @ 画布尺寸），放得下
    _, fps_src, _ = open_video(src)
    fps_eff = fps_src / stride        # 抽帧后真正播出来的帧率
    for idx, frame in iter_frames(src, stride=stride):
        if flip_x:
            frame = frame[:, ::-1]
        if not g["alpha"]:
            img = cv2.resize(frame, canvas, interpolation=cv2.INTER_AREA
                             if frame.shape[1] > canvas[0] else cv2.INTER_LANCZOS4)
            rgba_frames.append(np.dstack([img, np.full(img.shape[:2], 255, np.uint8)]))
            continue
        a, _ = key_frame(frame, plan["bg"], **KEY)
        rgb = decontaminate(frame, a, plan["bg"]) if decon else frame
        if g["fit"]:
            rgb2, a2 = place(rgb, a, plan["fit"], canvas)
        else:                       # 全屏：等比铺满画布，不做主体定位
            interp = cv2.INTER_AREA if frame.shape[1] > canvas[0] else cv2.INTER_LANCZOS4
            rgb2 = cv2.resize(rgb, canvas, interpolation=interp)
            a2 = cv2.resize(a, canvas, interpolation=interp)
        rgba_frames.append(np.dstack([rgb2, (np.clip(a2, 0, 1) * 255 + 0.5).astype(np.uint8)]))

    if plan["loop"] == "trim" and "keep" in plan:
        rgba_frames = rgba_frames[:plan["keep"]]
    elif plan["loop"] == "mirror":
        rgba_frames = mirror_append(rgba_frames[:plan["keep"]])

    # 在成品帧上量回绕接缝 —— 这是真正播出来会不会跳的指标
    if plan["loop"]:
        step, seam = loop_quality(rgba_frames)
        plan.update(step=step, seam=seam, ratio=seam / step if step else 0.0)
        # 接缝明显就补一道交叉淡化（镜像那类必然需要：首尾姿势未必刚好对称）
        if crossfade and plan["ratio"] > CFADE["min_ratio"]:
            rgba_frames = blend_loop(rgba_frames, crossfade)
            # 归一化仍用**淡化前**的 step：淡化本身会拉平尾部相邻帧差，
            # 拿它当分母的话指标会虚高，看不出真实改善。
            _, seam2 = loop_quality(rgba_frames)
            plan.update(seam=seam2, ratio=seam2 / step if step else 0.0,
                        crossfade=crossfade)

    if g["fmt"] == "webm":
        vpath = os.path.join(out_dir, plan["name"] + ".webm")
        t0 = time.time()
        encode_webm(rgba_frames, vpath, fps_eff, **WEBM)
        plan["encode_s"] = time.time() - t0
        asset = os.path.basename(vpath)
    else:
        for i, fr in enumerate(rgba_frames):
            Image.fromarray(fr).save(
                os.path.join(out_dir, f"{plan['name']}_{i:04d}.png"), optimize=True)
        asset = f"{plan['name']}_*.png"

    manifest = dict(name=plan["name"], group=plan["group"], loop=plan["loop"],
                    canvas=list(canvas), frames=len(rgba_frames),
                    fps=round(fps_eff, 3), alpha=bool(g["alpha"]),
                    format=g["fmt"],
                    codec="vp9+yuva420p" if g["fmt"] == "webm" else "png-rgba",
                    asset=asset,
                    anchor="bottom-center", source=os.path.basename(src),
                    source_frames=plan["n_src"],
                    loop_seam_ratio=round(plan["ratio"], 3) if "ratio" in plan else None,
                    crossfade=plan.get("crossfade", 0),
                    subject_scale=round(plan["fit"]["scale"], 4) if "fit" in plan else 1.0)
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    return manifest, rgba_frames


def write_preview(name, frames, cols=6):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    n = len(frames)
    picks = np.linspace(0, n - 1, min(cols, n)).astype(int)
    tiles = []
    for p in picks:
        fr = frames[p].astype(np.float32)
        a = fr[..., 3:4] / 255.0
        h, w = fr.shape[:2]
        y, x = np.mgrid[0:h, 0:w]
        sq = max(8, h // 16)
        ck = (((y // sq) + (x // sq)) % 2)[..., None]
        board = np.where(ck == 0, 70, 200).astype(np.float32).repeat(3, axis=2)
        comp = fr[..., :3] * a + board * (1 - a)
        t = cv2.resize(comp.astype(np.uint8), (300, max(1, int(300 * h / w))))
        cv2.putText(t, str(p), (8, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        tiles.append(t)
    sheet = np.hstack(tiles)
    Image.fromarray(sheet).save(os.path.join(PREVIEW_DIR, f"{name}.png"))
    return sheet


def main():
    ap = argparse.ArgumentParser(
        description="把美术组给的视频处理成引擎可用的 PNG 序列",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--analyze", action="store_true", help="只测量并出预览")
    ap.add_argument("--export", action="store_true", help="全量导出 PNG 序列")
    ap.add_argument("--only", nargs="+", help="只处理这些视频")
    ap.add_argument("--fps", type=float, default=None, help="抽帧到该帧率，默认保持源帧率")
    ap.add_argument("--decontaminate", action="store_true", help="开启颜色反混合")
    ap.add_argument("--no-preview", action="store_true", help="不出预览图")
    ap.add_argument("--diagnose", action="store_true",
                    help="列出每个循环动画的候选切点，判断是否存在好的循环点")
    ap.add_argument("--crossfade", type=int, default=None,
                    help="循环点交叉淡化的帧数，缺省按循环方式取（0 = 关闭）")
    args = ap.parse_args()

    targets = [v for v in VIDEOS if not args.only or v[0] in args.only]
    if not targets:
        print("没有匹配的视频。可选：", ", ".join(v[0] for v in VIDEOS))
        return 1

    print(f"源目录：{SRC_DIR}")
    print(f"产出目录：{OUT_DIR}\n")
    print(f"{'视频':<22}{'组':<4}{'循环':<8}{'源帧':>6}{'保留':>7}"
          f"{'主体高':>8}{'缩放':>7}{'接缝/相邻':>13}")
    print("-" * 82)

    results = []
    for spec in targets:
        name, group, loop = spec[0], spec[1], spec[2]
        flip_x = len(spec) > 3 and bool(spec[3])
        src = os.path.join(SRC_DIR, name + ".mp4")
        if not os.path.exists(src):
            print(f"!! 缺文件：{src}")
            continue
        stride = 1
        if args.fps:
            _, fps_src, _ = open_video(src)
            stride = max(1, int(round(fps_src / args.fps)))

        t0 = time.time()
        plan = analyze_and_build(name, group, loop, stride=stride, flip_x=flip_x)
        cf = args.crossfade if args.crossfade is not None else CFADE.get(loop, 0)
        mf, frames = export_one(plan, decon=args.decontaminate, stride=stride,
                                crossfade=cf, flip_x=flip_x) if args.export else (None, None)

        if args.export and not args.no_preview:
            write_preview(name, frames)

        if "fit" in plan:
            # 帧数都按抽帧后的计（plan 里存的就是抽帧后的数）
            keep = plan["keep"] * 2 if loop == "mirror" else plan.get("keep", plan["n_src"])
            subj = f"{plan['fit']['med_h']:.0f}"
            sc = f"{plan['fit']['scale']:.3f}"
        else:
            keep, subj, sc = plan["n_src"], "—", "—"
        seam = f"{plan['seam']:.2f}/{plan['step']:.2f}" if "seam" in plan else "—"
        print(f"{name:<22}{group:<4}{str(loop):<8}{plan['n_src']:>6}{keep:>7}"
              f"{subj:>8}{sc:>7}{seam:>13}   {time.time()-t0:4.1f}s")
        results.append((name, plan, mf))

        if args.diagnose and loop == "trim":
            cands, step = loop_candidates(plan["feats"])
            print(f"    候选切点（距首帧）："
                  + "  ".join(f"f{j}={v:.2f}" for j, v in cands)
                  + f"   [相邻帧典型差 {step:.2f}]")

    print("\n接缝/相邻 = 循环接缝处的帧差 ÷ 相邻帧的典型帧差。"
          "\n  接近 1 → 接到一起看不出来；明显大于 1 → 接缝会跳，需要调循环点。")

    if args.export:
        total = 0
        print(f"\n{'视频':<22}{'帧数':>6}{'画布':>12}{'体积MB':>10}")
        print("-" * 52)
        for name, plan, mf in results:
            d = os.path.join(OUT_DIR, name)
            size = sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d))
            total += size
            print(f"{name:<22}{mf['frames']:>6}{'x'.join(map(str, mf['canvas'])):>12}"
                  f"{size/1024/1024:>10.1f}")
        print("-" * 52)
        print(f"{'合计':<22}{'':>6}{'':>12}{total/1024/1024:>10.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
