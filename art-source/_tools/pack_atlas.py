# -*- coding: utf-8 -*-
"""
序列帧打包器
============

把 `gen_video_fx.py` 导出的 PNG 序列打包成引擎可加载的「图集页 + 索引」，
输出到 `assets/Resources/video_fx/<名>/`（放进 Resources 才能被 `resources.load`）。

用法::

    python pack_atlas.py                  # 打包全部
    python pack_atlas.py --only 狐火-静息
    python pack_atlas.py --verify         # 打包后抽帧校验坐标
    python pack_atlas.py --page 2048      # 改页尺寸

产出::

    page_00.png ... page_NN.png
    manifest.json

两种布局，**manifest 格式完全一致，播放器不需要区分**
----------------------------------------------------
- `grid`   —— 网格打包（帧小、量大时用，显著减少资源数）
- `single` —— 一帧一页（帧大到一页只装得下一两张时用）

⚠️ 为什么大帧反而不打包
----------------------
一张 2048 的页只装得下 1 张 1920×1080 的帧，但**要显示 1 帧就得把整页常驻显存**。
全屏那三段本来就是「同一时刻只需要 1 帧」（流式播放），打包等于凭空多占 3 倍显存，
而显存正是这条链路最紧的资源。所以帧面积超过 `SINGLE_IF_AREA` 就退回一帧一页 ——
此时「页」就是原图，直接拷贝，不重编码，零损失。

坐标约定
--------
`entries[i].y` 用 **Cocos 的左上原点**（`SpriteFrame.rect` 就是这个约定），
打包时已经换算好，播放器拿到即用，不要再翻。
"""

import argparse
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                        # art-source/
PROJECT = os.path.dirname(ROOT)                     # 仓库根

SRC_DIR = os.path.join(ROOT, "_video_out")
OUT_DIR = os.path.join(PROJECT, "assets", "Resources", "video_fx")

PAGE = 2048          # 网格打包的页边长上限
PAD = 2              # 帧与帧之间留的空隙，防双线性采样在边缘渗色
# 帧面积超过这个值就退回「一帧一页」。768² = 59 万 → 打包；1920×1080 = 207 万 → 不打包
SINGLE_IF_AREA = 1_000_000

# ⚠️ 默认降半分辨率。
#
# 起因：按原规格全量打包后，723 张图集页合计 15.8 亿像素 ≈ **5.89GB**（解成 RGBA）。
# 编辑器要为每个资源建导入项、选中大图还会上传贴图，GPU 显存一紧 Chromium 就把
# WebGL 上下文丢掉（编辑器反复弹「WebGL 上下文丢失」）。降半后像素降到 1/4。
#
# 缩放放在**打包阶段**而不是上游抽帧 —— `_video_out/` 里始终留着原规格序列，
# 以后想换回原规格或换别的倍率，重跑一次本脚本即可，不必回视频里重新抽帧。
SCALE = 0.5


def frame_files(src_dir):
    """按帧号排好序的帧文件。"""
    names = [f for f in os.listdir(src_dir)
             if f.lower().endswith(".png")]
    if not names:
        return []
    # 文件名形如 <视频名>_0000.png，按末尾数字排，不要按字典序（位数不齐会错）
    def idx(n):
        stem = os.path.splitext(n)[0]
        tail = stem.rsplit("_", 1)[-1]
        return int(tail) if tail.isdigit() else 0
    return [os.path.join(src_dir, n) for n in sorted(names, key=idx)]


def grid_shape(fw, fh, page):
    """能塞进 page×page 的列数/行数（至少 1×1）。"""
    cell_w, cell_h = fw + PAD, fh + PAD
    cols = max(1, page // cell_w)
    rows = max(1, page // cell_h)
    return cols, rows, cell_w, cell_h


def pack_grid(files, out_dir, fw, fh, page):
    """网格打包：逐帧贴进当前页，页满就落盘换新页。内存里始终只有一页。"""
    max_cols, max_rows, cw, ch = grid_shape(fw, fh, page)
    per_page = max_cols * max_rows
    entries, pages = [], []

    for start in range(0, len(files), per_page):
        batch = files[start:start + per_page]
        # ⚠️ 页尺寸按**这一批实际的帧数**开，不是按整页网格容量。
        # 否则最后不满的一页（极端情况：8 帧只占第一行）会开出一整张
        # 2000×2000 的画布，99% 是透明的，白白吃显存。
        bcols = min(max_cols, len(batch))
        brows = -(-len(batch) // bcols)
        cols = bcols
        pw, ph = bcols * cw, brows * ch
        sheet = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        for k, path in enumerate(batch):
            col, row = k % cols, k // cols
            x, y = col * cw, row * ch
            with Image.open(path) as im:
                im = im.convert("RGBA")
                if im.size != (fw, fh):
                    im = im.resize((fw, fh), Image.LANCZOS)
                sheet.paste(im, (x, y))
            # y 已经是左上原点，与 Cocos rect 一致，直接用
            entries.append(dict(page=len(pages), x=x, y=y, w=fw, h=fh))
        name = f"page_{len(pages):02d}.png"
        sheet.save(os.path.join(out_dir, name), optimize=True)
        pages.append(name)

    # pageSize 记「满页」的尺寸；末页不满时会小一些，运行时按 entries 取帧、不依赖它
    return dict(layout="grid", pageSize=[max_cols * cw, max_rows * ch], pages=pages,
                entries=entries, grid=[max_cols, max_rows])


def pack_single(files, out_dir, fw, fh):
    """一帧一页：直接拷原图，不重编码（零损失，也快得多）。"""
    entries, pages = [], []
    for i, path in enumerate(files):
        name = f"page_{i:04d}.png"
        shutil.copyfile(path, os.path.join(out_dir, name))
        entries.append(dict(page=i, x=0, y=0, w=fw, h=fh))
        pages.append(name)
    return dict(layout="single", pageSize=[fw, fh], pages=pages, entries=entries)


def process(name, page=PAGE, verify=False, scale=SCALE):
    src_dir = os.path.join(SRC_DIR, name)
    meta_path = os.path.join(src_dir, "manifest.json")
    if not os.path.isfile(meta_path):
        print(f"  跳过 {name}：没有上游 manifest")
        return None

    with open(meta_path, encoding="utf-8") as fh:
        upstream = json.load(fh)
    files = frame_files(src_dir)
    if not files:
        print(f"  跳过 {name}：没有帧")
        return None

    with Image.open(files[0]) as im:
        sw, sh = im.size
    fw, fh = max(1, round(sw * scale)), max(1, round(sh * scale))

    out_dir = os.path.join(OUT_DIR, name)
    os.makedirs(out_dir, exist_ok=True)
    # 清掉上一次的页，避免换了布局之后新旧页混在一起（体积统计和加载都会失真）
    for f in os.listdir(out_dir):
        if f.endswith(".png") or f == "manifest.json":
            os.remove(os.path.join(out_dir, f))

    # 缩放过就一律走网格：一帧一页的「直接拷原图、零重编码」优势只在原尺寸下成立，
    # 而且降半后大帧也装得进一页好几张，网格反而把页数压下来（对编辑器导入友好）
    if scale == 1.0 and fw * fh > SINGLE_IF_AREA:
        packed = pack_single(files, out_dir, fw, fh)
    else:
        packed = pack_grid(files, out_dir, fw, fh, page)

    manifest = dict(
        name=name,
        canvas=[fw, fh],
        scale=round(scale, 4),
        sourceCanvas=[sw, sh],
        fps=upstream.get("fps", 24),
        frames=len(files),
        loop=upstream.get("loop"),
        anchor=upstream.get("anchor", "bottom-center"),
        source=upstream.get("source"),
        **packed,
    )
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1, separators=(",", ":"))

    if verify:
        check_entries(files, out_dir, manifest)
    return manifest


def check_entries(files, out_dir, manifest, samples=(0, None, -1)):
    """
    抽几帧按 entries 坐标裁出来，和源图逐像素比。

    这是唯一能证明「坐标没搞反、原点没搞错」的检查 —— 肉眼看图看不出
    y 轴方向错了（裁出来的还是那张画，只是位置偏了），必须比数据。
    """
    n = len(files)
    idxs = [i if i is not None else n // 2 for i in samples]
    bad = 0
    for i in idxs:
        i = i % n
        e = manifest["entries"][i]
        page = Image.open(os.path.join(out_dir, manifest["pages"][e["page"]])).convert("RGBA")
        crop = page.crop((e["x"], e["y"], e["x"] + e["w"], e["y"] + e["h"]))
        src = Image.open(files[i]).convert("RGBA")
        if src.size != crop.size:
            src = src.resize(crop.size, Image.LANCZOS)
        d = np.abs(np.asarray(crop, np.int16) - np.asarray(src, np.int16))
        same = d.max() == 0
        if not same:
            bad += 1
        print(f"    帧{i:>4}: 页{e['page']:>3} @({e['x']},{e['y']}) "
              f"最大差值={d.max():>3} 均值={d.mean():.4f} {'✓' if same else '✗ 不一致'}")
    return bad == 0


def main():
    ap = argparse.ArgumentParser(description="把序列帧打包成图集页 + 索引")
    ap.add_argument("--only", nargs="+", help="只打包这些")
    ap.add_argument("--page", type=int, default=PAGE, help=f"网格页边长上限，默认 {PAGE}")
    ap.add_argument("--scale", type=float, default=SCALE,
                    help=f"输出分辨率倍率，默认 {SCALE}（原规格传 1.0）")
    ap.add_argument("--verify", action="store_true", help="打包后抽帧校验坐标")
    args = ap.parse_args()

    names = sorted(d for d in os.listdir(SRC_DIR)
                   if os.path.isdir(os.path.join(SRC_DIR, d)))
    if args.only:
        names = [n for n in names if n in args.only]
    if not names:
        print("没有可打包的目录。")
        return 1

    print(f"源：{SRC_DIR}")
    print(f"出：{OUT_DIR}   倍率 {args.scale}\n")
    print(f"{'视频':<22}{'帧数':>6}{'布局':>8}{'页数':>6}{'页尺寸':>14}{'体积MB':>9}")
    print("-" * 68)

    total = 0
    total_px = 0
    for name in names:
        m = process(name, page=args.page, verify=args.verify, scale=args.scale)
        if m:
            total_px += m["canvas"][0] * m["canvas"][1] * m["frames"]
        if not m:
            continue
        d = os.path.join(OUT_DIR, name)
        size = sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d))
        total += size
        print(f"{name:<22}{m['frames']:>6}{m['layout']:>8}{len(m['pages']):>6}"
              f"{'x'.join(map(str, m['pageSize'])):>14}{size/1024/1024:>9.1f}")
    print("-" * 68)
    print(f"{'合计':<22}{'':>6}{'':>8}{'':>6}{'':>14}{total/1024/1024:>9.1f}")
    # 这一行是关键指标：解成 RGBA 后编辑器/GPU 要扛多少
    print(f"\n总像素 {total_px/1e6:.0f} M  →  解成 RGBA 约 {total_px*4/1024**3:.2f} GB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
