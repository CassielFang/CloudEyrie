# -*- coding: utf-8 -*-
"""
从「小怪-攻击」里抽出那支箭，做成独立可用的抛射物素材
=================================================

小怪的攻击是**射箭**。箭要当独立抛射物用（自己的飞行与碰撞），所以得从动画里抽出来。

用法::

    python extract_arrow.py            # 抽出来，落到 _video_out/小怪-箭/
    python extract_arrow.py --sheet    # 额外出「原图 vs 重建」对照图

产出与 `gen_video_fx.py` 同格式，可直接接 `pack_atlas.py`。

⚠️ 箭杆是「画上去的」，不是抠出来的
--------------------------------
箭杆压在身体上那一段**分不开**。实测沿箭杆那一行采样：

    y=279~281，x 250→520 的亮度全部落在 51~70

箭杆和身体是同一族深藏青，数值上零分界 —— 按颜色抠必然把身体带进来。
但箭是**简单几何体**：带倒钩的三角箭头 + 一条 3~4px 粗的直杆 + 浅色箭羽。
箭头在身体左侧的背景上（干净可抠）、箭羽是浅色压在深色身体上（也可抠），
中间那段直杆按两端连一条直线补回来。

**这条线是补的，不是抠的** —— 见 `--sheet` 的对照图：在没有身体的区段上，
补出来的线与原图重合；压在身上的那一段则无法验证。
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
SRC_NAME = "小怪-攻击"
OUT_NAME = "小怪-箭"

FRAME_PICK = 56            # 拉满弓的保持段，箭画得最完整

# 以下几何全部由 `ascii map` 量得，改素材后要重新量
HEAD_X = (205, 275)        # 箭头（三角+倒钩）所在的 x
HEAD_Y = (258, 302)
SHAFT_Y = (277, 285)       # 箭杆的竖向范围（约 3~4px）
SHAFT_X = (255, 548)       # 箭杆从箭头右侧延伸到箭羽
FLETCH_X = (505, 600)      # 箭羽（浅色）所在 x
FLETCH_Y = (243, 315)
DARK_MAX = 125             # 「暗」的上限
LIGHT_MIN = 170            # 「浅」的下限（全局）
# 箭羽压在深色身体上，是灰白而不是纯白，单独的阈值要松一档；
# 只在 FLETCH 那个框里用，不会把背景卷进来
FLETCH_LIGHT_MIN = 138
PAD = 6


def main():
    ap = argparse.ArgumentParser(description="抽出小怪射出的箭")
    ap.add_argument("--sheet", action="store_true", help="出「原图 vs 重建」对照图")
    args = ap.parse_args()

    frames = [f for _, f in G.iter_frames(os.path.join(G.SRC_DIR, SRC_NAME + ".mp4"))]
    f = frames[min(FRAME_PICK, len(frames) - 1)]
    h, w = f.shape[:2]
    print(f"源 {SRC_NAME}：{len(frames)} 帧 {w}x{h}，取第 {FRAME_PICK} 帧")

    dark = f.max(axis=2) < DARK_MAX
    light = f.min(axis=2) > LIGHT_MIN

    def box(x, y):
        m = np.zeros((h, w), bool)
        m[y[0]:y[1], x[0]:x[1]] = True
        return m

    # ---- 箭头：在身体左侧的背景上，抠得干净 ----
    head = dark & box(HEAD_X, HEAD_Y)
    head = ndimage.binary_fill_holes(
        cv2.morphologyEx(head.astype(np.uint8), cv2.MORPH_CLOSE,
                         np.ones((3, 3), np.uint8)) > 0)
    if not head.any():
        print("没找到箭头，检查 HEAD_X / HEAD_Y")
        return 1
    ys, xs = np.where(head)
    print(f"箭头 bbox x {xs.min()}~{xs.max()}  y {ys.min()}~{ys.max()}  {int(head.sum())} px")

    # ---- 箭羽：浅色，压在身体上 ----
    fletch = (f.min(axis=2) > FLETCH_LIGHT_MIN) & box(FLETCH_X, FLETCH_Y)
    fletch = ndimage.binary_fill_holes(
        cv2.morphologyEx(fletch.astype(np.uint8), cv2.MORPH_CLOSE,
                         np.ones((5, 5), np.uint8)) > 0)
    if fletch.any():
        ys2, xs2 = np.where(fletch)
        print(f"箭羽 bbox x {xs2.min()}~{xs2.max()}  y {ys2.min()}~{ys2.max()}  {int(fletch.sum())} px")
    else:
        print("没找到箭羽")

    # ---- 箭杆：补出来的直线 ----
    shaft = box((SHAFT_X[0], SHAFT_X[1] + 1), (SHAFT_Y[0], SHAFT_Y[1] + 1))

    m = (head | fletch | shaft).astype(np.uint8)
    # 只留连成一体的那一块（线段把箭头和箭羽串起来了）
    nlab, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if nlab > 1:
        m = (lab == (1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])))).astype(np.uint8)

    canvas = np.dstack([f, (m * 255).astype(np.uint8)])

    # ⚠️ 箭杆要**填成纯色**，不能直接用原图那块像素 ——
    # 原图里箭杆压着的是手和身体，直接取色会把「手透出来」画成箭杆的花纹。
    # 从「箭杆露在背景上」的那一段取样：那里没有别的东西，是箭杆本色。
    sample = np.zeros((h, w), bool)
    sample[SHAFT_Y[0]:SHAFT_Y[1], SHAFT_X[0] + 25:SHAFT_X[0] + 85] = True
    sample &= dark
    if sample.any():
        shaft_color = np.median(f[sample], axis=0)
        band = np.zeros((h, w), bool)
        band[SHAFT_Y[0]:SHAFT_Y[1], SHAFT_X[0]:SHAFT_X[1]] = True
        band &= (m > 0)
        canvas[band, :3] = shaft_color.astype(np.uint8)
        print(f"箭杆取色 BGR{shaft_color.round(0)}（取 {int(sample.sum())} px 样本）")
    ys3, xs3 = np.where(m > 0)
    x0, x1, y0, y1 = int(xs3.min()), int(xs3.max()), int(ys3.min()), int(ys3.max())
    print(f"合成 bbox x {x0}~{x1}  y {y0}~{y1}  ({x1-x0+1}×{y1-y0+1})")

    crop = canvas[max(0, y0 - PAD):y1 + 1 + PAD, max(0, x0 - PAD):x1 + 1 + PAD]

    out_dir = os.path.join(ROOT, "_video_out", OUT_NAME)
    os.makedirs(out_dir, exist_ok=True)
    for n in os.listdir(out_dir):
        if n.endswith(".png") or n == "manifest.json":
            os.remove(os.path.join(out_dir, n))
    Image.fromarray(crop).save(os.path.join(out_dir, f"{OUT_NAME}_0000.png"))

    ch, cw = crop.shape[:2]
    manifest = dict(name=OUT_NAME, fps=24, frames=1, loop=None,
                    canvas=[cw, ch], source=f"{SRC_NAME}.mp4",
                    note="单帧抛射物；箭杆是按两端补齐的直线，见 extract_arrow.py 的说明")
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f"输出 1 帧 {cw}x{ch} -> {out_dir}")

    if args.sheet:
        # 并排：原图裁切 | 重建结果，都放大 3 倍，好对照箭杆补得准不准
        src_crop = f[max(0, y0 - PAD):y1 + 1 + PAD, max(0, x0 - PAD):x1 + 1 + PAD]
        tiles = []
        for arr in (Image.fromarray(src_crop).convert("RGB"),
                    Image.fromarray(crop).convert("RGBA")):
            if arr.mode == "RGBA":
                plate = Image.new("RGBA", arr.size, (150, 150, 150, 255))
                plate.alpha_composite(arr)
                arr = plate.convert("RGB")
            tiles.append(arr.resize((arr.width * 3, arr.height * 3), Image.NEAREST))
        sheet = Image.new("RGB", (sum(t.width for t in tiles) + 12,
                                  max(t.height for t in tiles)), (40, 40, 44))
        sheet.paste(tiles[0], (0, 0))
        sheet.paste(tiles[1], (tiles[0].width + 12, 0))
        p = os.path.join(ROOT, "_preview", "video", f"{OUT_NAME}.png")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        sheet.save(p)
        print("对照图（左 原图 / 右 重建）->", p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
