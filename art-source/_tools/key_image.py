# -*- coding: utf-8 -*-
"""
单张图的背景抠除（美术组交来的图有不少是**画在白纸上**的，不是透明 PNG）
=====================================================================

用法::

    python key_image.py <输入图> <输出图> [--hard 38] [--lo 12]

比如 `背景/山.png` —— 一株青绿山峰画在白纸底上，直接当景物贴上会是一张白卡片
盖住画面。这里用和 `gen_video_fx.py` 同一套判据把它抠成透明：

1. 取边框一圈的中位色当底色（白纸底很稳，实测偏差极小）
2. 距离底色超过 `hard` 的判为前景
3. **填洞** —— 山体内部有大量浅色（云气、淡墨），只靠阈值会把山掏空；
   山的外轮廓是闭合的，把封闭区间整体判为前景就能救回来

⚠️ 不改源文件，输出到新路径。
"""

import argparse
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage


def main():
    ap = argparse.ArgumentParser(description="把白纸底的单张图抠成透明")
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--lo", type=float, default=12.0, help="开始过渡的色距")
    ap.add_argument("--hard", type=float, default=38.0, help="判为前景的色距")
    ap.add_argument("--close", type=int, default=3, help="闭运算核，补轮廓缺口")
    args = ap.parse_args()

    if not os.path.isfile(args.src):
        print("找不到输入:", args.src)
        return 1
    im = np.asarray(Image.open(args.src).convert("RGB")).astype(np.float32)
    h, w = im.shape[:2]

    band = 16
    edge = np.concatenate([im[:band].reshape(-1, 3), im[-band:].reshape(-1, 3),
                           im[:, :band].reshape(-1, 3), im[:, -band:].reshape(-1, 3)])
    bg = np.median(edge, axis=0)
    print(f"{w}x{h}  底色 RGB{bg.round(0)}  边缘离散 {edge.std(axis=0).round(1)}")

    d = np.linalg.norm(im - bg, axis=2)
    m = (d > args.hard).astype(np.uint8)
    if args.close:
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((args.close,) * 2, np.uint8))
    filled = ndimage.binary_fill_holes(m)
    a = np.clip((d - args.lo) / max(1e-6, args.hard - args.lo), 0, 1)
    a = np.maximum(a, filled.astype(np.float32))

    out = np.dstack([im, (a * 255 + 0.5).astype(np.uint8)]).astype(np.uint8)
    os.makedirs(os.path.dirname(args.dst) or ".", exist_ok=True)
    Image.fromarray(out).save(args.dst, optimize=True)
    print(f"不透明占比 {(a > 0.9).mean():.2%}  半透明 {((a > 0.1) & (a < 0.9)).mean():.2%}")
    print("->", args.dst)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
