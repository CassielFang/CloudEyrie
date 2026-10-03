# -*- coding: utf-8 -*-
"""
从「小怪-攻击」里单独抠出**喷出的粘液球**
=====================================

小怪的攻击不是射箭，是张嘴喷出一道青紫色粘液。这段粘液在游戏里要当**独立的
抛射物**用（自己的飞行、自己的碰撞），所以得从压平的动画里单独抠出来。

用法::

    python extract_proj.py              # 抠出来，落到 _video_out/小怪-粘液/
    python extract_proj.py --sheet      # 额外出联系表
    python extract_proj.py --debug      # 每帧导出诊断图（看掩码对不对）

产出与 `gen_video_fx.py` 同格式，因此可以直接接着跑 `pack_atlas.py`。

判据为什么不是单纯的色相
------------------------
粘液是**亮青紫**，但小怪身上那层浊湮斑块也是紫调（见下），只按色相切必然误伤：

    静止帧 f0: 紫调像素 57864，V 中位 0.28、95 分位 0.91

也就是说本体的紫**暗部**（中位 0.28）和粘液的**亮部**差得开，但本体的高光
（95 分位 0.91）和粘液一样亮。所以判据是**三条同时成立**：

1. 色相落在青紫带（215°~325°）
2. 亮度 V ≥ 0.42 —— 滤掉本体浊湮的暗紫
3. **在静止帧身体右缘之外** —— 本体的高光紫再亮也在躯干上，不会跑到右缘外

第 3 条是关键。再用连通域面积比滤掉残余噪点（头盔上的浊湮滴只有约 180px，
粘液是 1000~10000px）。
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_video_fx as G          # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_NAME = "小怪-粘液"
SRC_NAME = "小怪-攻击"

# 掩码参数
HUE_LO, HUE_HI = 215.0, 325.0     # 青紫带（度）
SAT_MIN = 0.30
VAL_MIN = 0.42
AREA_KEEP = 0.15                  # 连通域面积不足最大块的这个比例就丢掉
# 绝对下限：头盔上那滴浊湮只有约 12×26px。**只按「最大块」筛是筛不掉它的** ——
# 在粘液还没喷出来的帧里，它就是最大块。所以再加一条宽度下限。
MIN_AREA = 400
MIN_WIDTH = 40
PAD = 12                          # 输出画布四周留白
ALIGN = "left"                    # 按粘液左端（靠嘴那侧）对齐，播起来才是「喷出去」


def spit_mask(rgb, body_right):
    """返回粘液的二值掩码。"""
    hsv = np.asarray(Image.fromarray(rgb).convert("HSV"), np.float32)
    H, S, V = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    h, w = rgb.shape[:2]

    m = ((H >= HUE_LO) & (H <= HUE_HI) & (S >= SAT_MIN) & (V >= VAL_MIN))
    side = np.zeros((h, w), bool)
    side[:, body_right:] = True
    m = (m & side).astype(np.uint8)

    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    nlab, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if nlab > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        widths = stats[1:, cv2.CC_STAT_WIDTH]
        keep = np.zeros(nlab, bool)
        keep[1:] = (areas >= areas.max() * AREA_KEEP) & (areas >= MIN_AREA) \
            & (widths >= MIN_WIDTH)
        m = keep[lab].astype(np.uint8)

    return ndimage.binary_fill_holes(m > 0).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser(description="抠出小怪喷的粘液球")
    ap.add_argument("--sheet", action="store_true", help="额外出一张联系表")
    ap.add_argument("--debug", action="store_true", help="每帧导出诊断图")
    args = ap.parse_args()

    src = os.path.join(G.SRC_DIR, SRC_NAME + ".mp4")
    if not os.path.isfile(src):
        print("找不到源视频:", src)
        return 1
    frames = [f for _, f in G.iter_frames(src)]
    bg = G.estimate_bg(src)
    print(f"源 {SRC_NAME}：{len(frames)} 帧 {frames[0].shape[1]}x{frames[0].shape[0]}")

    # 用一张「没在喷」的帧量身体右缘。取靠后的帧（那时嘴已闭上）
    rest = frames[min(len(frames) - 1, 88)]
    a_rest, _ = G.key_frame(rest, bg, **G.KEY)
    xs = np.where(a_rest > 0.5)[1]
    body_right = int(xs.max()) + 2
    print(f"静止帧身体右缘 x = {body_right}")

    # 逐帧取掩码 → 记录 bbox，先收集再统一画布（对齐才不跳）
    found = []
    for i, rgb in enumerate(frames):
        m = spit_mask(rgb, body_right)
        if m.sum() == 0:
            continue
        ys, xs = np.where(m > 0)
        found.append((i, m, int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())))

    if not found:
        print("一帧粘液都没抠到，检查阈值。")
        return 1
    idxs = [f[0] for f in found]
    print(f"抠到粘液 {len(found)} 帧：{idxs[0]}~{idxs[-1]}")

    # 统一画布：宽取最长跨度，高取最大跨度，按左端对齐
    max_w = max(f[3] - f[2] + 1 for f in found)
    max_h = max(f[5] - f[4] + 1 for f in found)
    cw, ch = max_w + PAD * 2, max_h + PAD * 2
    # 垂直方向按所有帧的中位中心对齐，避免上下跳
    cy = int(np.median([(f[4] + f[5]) / 2 for f in found]))

    out_dir = os.path.join(G.ROOT, "_video_out", OUT_NAME)
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith(".png") or f == "manifest.json":
            os.remove(os.path.join(out_dir, f))

    tiles = []
    for k, (i, m, x0, x1, y0, y1) in enumerate(found):
        rgb = frames[i]
        cut = np.dstack([rgb, (m * 255).astype(np.uint8)])
        # 目标位置：左端固定贴 PAD，垂直按中位中心
        px0 = PAD
        py0 = int(ch / 2 - (cy - y0))
        canvas = np.zeros((ch, cw, 4), np.uint8)
        sx0, sy0 = x0, y0
        ww, hh = x1 - x0 + 1, y1 - y0 + 1
        dx0, dy0 = max(0, px0), max(0, py0)
        ww2 = min(ww - (dx0 - px0), cw - dx0)
        hh2 = min(hh - (dy0 - py0), ch - dy0)
        if ww2 > 0 and hh2 > 0:
            canvas[dy0:dy0 + hh2, dx0:dx0 + ww2] = \
                cut[sy0 + (dy0 - py0):sy0 + (dy0 - py0) + hh2,
                    sx0 + (dx0 - px0):sx0 + (dx0 - px0) + ww2]
        Image.fromarray(canvas).save(os.path.join(out_dir, f"{OUT_NAME}_{k:04d}.png"))
        if args.sheet:
            im = Image.fromarray(canvas).convert("RGBA")
            plate = Image.new("RGBA", im.size, (150, 150, 150, 255))
            plate.alpha_composite(im)
            tiles.append(plate.convert("RGB"))

    manifest = dict(name=OUT_NAME, fps=24, frames=len(found), loop=None,
                    source=f"{SRC_NAME}.mp4", extracted_from=[idxs[0], idxs[-1]],
                    canvas=[cw, ch], note="从攻击动画里按颜色+位置抠出的抛射物")
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f"输出 {len(found)} 帧 {cw}x{ch} -> {out_dir}")

    if args.sheet and tiles:
        s = 220 / max(t.height for t in tiles)
        tiles = [t.resize((max(1, int(t.width * s)), max(1, int(t.height * s))), Image.LANCZOS)
                 for t in tiles]
        sheet = Image.new("RGB", (sum(t.width for t in tiles) + 6 * len(tiles),
                                  max(t.height for t in tiles) + 12), (40, 40, 44))
        x = 0
        for t in tiles:
            sheet.paste(t, (x, 6))
            x += t.width + 6
        p = os.path.join(ROOT, "_preview", "video", f"{OUT_NAME}.png")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        sheet.save(p)
        print("联系表 ->", p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
