# -*- coding: utf-8 -*-
"""
《云岫》程序化美术生成入口
========================

用法::

    python gen_art.py                      # 全部生成
    python gen_art.py --only ui fx         # 只生成指定类别
    python gen_art.py --seed 1234          # 换一套随机（整批统一偏移）
    python gen_art.py --list               # 只列出会产出哪些文件
    python gen_art.py --sheet ui           # 生成后额外出一张联系表（校对用）

产出落到 `art-source/<类别>/`，另有 `art-source/_preview/` 放联系表。

⚠️ 这些是**程序化占位素材**，不是正式美术
----------------------------------------
它们能定比例、定配色、定构图层次，用来在没有正式资产时把玩法和关卡调通；
但做不出骨骼动画、多帧动作、真正的笔触细节。正式资产仍由美术组手绘。

`art-source/` 故意放在 `assets/` 之外：Cocos 会把 `assets/` 下所有图导入并
生成 `.meta`，这些高分辨率素材全部导入会白白吃掉显存。
确定要进引擎的版本，由人挑选后放进 `assets/Textures/`。
"""

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import inkwash as ik          # noqa: E402
import gen_ui                 # noqa: E402
import gen_scene              # noqa: E402
import gen_fx                 # noqa: E402
import gen_char               # noqa: E402
import gen_title              # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # art-source/

MODULES = {
    "ui": (gen_ui, 1000),
    "scene": (gen_scene, 3000),
    "fx": (gen_fx, 4000),
    "char": (gen_char, 2000),
    # title 不是整批随机生成的，seed 对它无效（三张图都是解析式的）
    "title": (gen_title, 5000),
}


def main():
    ap = argparse.ArgumentParser(
        description="生成《云岫》程序化美术素材",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="+", choices=sorted(MODULES),
                    help="只生成指定类别，默认全部")
    ap.add_argument("--seed", type=int, default=0,
                    help="整批随机种子偏移；同一 seed 必然复现同一套图")
    ap.add_argument("--sheet", nargs="*", choices=sorted(MODULES),
                    help="为这些类别额外出联系表（不填则 --only 的全部）")
    args = ap.parse_args()

    targets = args.only or sorted(MODULES)
    prev_dir = os.path.join(ROOT, "_preview")
    total = 0

    for name in targets:
        mod, base = MODULES[name]
        out_dir = os.path.join(ROOT, name)
        t0 = time.time()
        assets = mod.build(out_dir, seed=base + args.seed)
        for fname, layer in sorted(assets.items()):
            ik.save(layer, os.path.join(out_dir, fname))

        longest = max(max(v.shape[:2]) for v in assets.values())
        total += len(assets)
        print(f"[{name:5s}] {len(assets):2d} 张  最长边 {longest:5d}px  "
              f"{time.time() - t0:5.1f}s  -> {name}/")

        # 联系表复用刚生成的图层，不重算
        if args.sheet is not None and (not args.sheet or name in args.sheet):
            keys = sorted(assets)
            sheet = ik.contact_sheet([assets[k] for k in keys], cols=4, cell=400)
            ik.save(ik.flatten(sheet, (1, 1, 1)),
                    os.path.join(prev_dir, f"sheet_{name}.png"))

    print(f"\n共 {total} 张。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
