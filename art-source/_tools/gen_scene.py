# -*- coding: utf-8 -*-
"""
场景资产生成器 —— 对照 `docs/大赛规划v2.0` 美术资产清单 #8–15
==========================================================

风格依据 `docs/Cloud Eyrie.md` §7.1：

    多层视差滚动营造纵深感，画面通透柔和
      远景：淡墨山峦，云雾流动
      中景：林木、岩石、古建筑，细节丰富
      近景：草丛、花枝、碎石，随人物移动轻微晃动

产出（`art-source/scene/`）
-----------------------
远景山峦、中景林木古祠、近景草丛、云雾带 ×2、Boss 战场谷地、
灵泉石台、灵界屏障、灵界机关两态、地面 tileset。

⚠️ 视差层的左右两条边必须能接上。本文件的层全部用可平铺噪声
（`ik.fbm` / `ik.ridged_1d` 都是整数频率），**不要**在这里改用
`np.random` 逐点撒点 —— 那会破坏接缝。
"""

import numpy as np

import inkwash as ik

FAR_SIZE = (4096, 2048)
MID_SIZE = (4096, 2048)
NEAR_SIZE = (4096, 1024)
MIST_SIZE = (4096, 1024)


# ------------------------------------------------------------ 远景

def bg_far_mountains(size=FAR_SIZE, seed=800):
    """
    远景层 —— 淡墨山峦 + 云雾流动。

    三层山，越远越淡、越糊，中间用云雾隔开（留白）。
    山脚一律 `vertical_fade`，让它融进下方的雾里 —— 硬切的山脚会让
    「深远」当场消失。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    white = (0.985, 0.982, 0.968)

    # 最远：几乎只有影子
    prof = ik.norm01(ik.ridged_1d(w, rng, octaves=6, base=3) + ik.peaks_1d(w, rng, 6))
    top = h * 0.06 + (1 - prof) * h * 0.26
    out = ik.over(out, ik.mountain_layer(
        (h, w), rng, top, ink="pale", density=0.38, blur=14, granulate=0.25,
        edge_darken=0.15, vertical_fade=0.65, color=ik.MINERAL["azurite_lt"],
        color_amt=0.30, contour=1.6, contour_alpha=0.30,
        cun=40, cun_length=(30, 90), cun_alpha=0.22))
    out = ik.over(out, ik.mist_band((h, w), rng, h * 0.34, h * 0.13,
                                    color=white, density=0.92))

    # 中远
    prof = ik.norm01(ik.ridged_1d(w, rng, octaves=7, base=2, roughness=0.58)
                     + ik.peaks_1d(w, rng, 5, width=(0.04, 0.16)))
    top = h * 0.18 + (1 - prof) * h * 0.30
    out = ik.over(out, ik.mountain_layer(
        (h, w), rng, top, ink="pale", density=0.52, blur=9, granulate=0.30,
        edge_darken=0.24, warp_amt=3, vertical_fade=0.55,
        color=(ik.MINERAL["malachite_lt"], ik.MINERAL["azurite_lt"]), color_amt=0.40,
        contour=2.2, contour_ink=ik.INK["light"], contour_alpha=0.45,
        cun=120, cun_length=(24, 70), cun_alpha=0.28))
    out = ik.over(out, ik.mist_band((h, w), rng, h * 0.62, h * 0.14,
                                    color=white, density=0.88))

    # 中景山（`art-source/scene` 里最实的一层，玩家跳台多在这一层附近）
    prof = ik.norm01(ik.ridged_1d(w, rng, octaves=7, base=2)
                     + ik.peaks_1d(w, rng, 4, width=(0.05, 0.20)))
    top = h * 0.34 + (1 - prof) * h * 0.34
    out = ik.over(out, ik.mountain_layer(
        (h, w), rng, top, ink="light", density=0.72, blur=5, granulate=0.40,
        edge_darken=0.42, warp_amt=4,
        color=(ik.MINERAL["malachite"], ik.MINERAL["azurite"]), color_amt=0.5,
        vertical_fade=0.38, contour=3.0, contour_ink=ik.INK["medium"],
        cun=520, cun_length=(22, 75), cun_alpha=0.34,
        cun_tilt=0.30, cun_bend=0.30, cun_spread=0.42))
    out = ik.over(out, ik.mist_band((h, w), rng, h * 0.86, h * 0.12,
                                    color=white, density=0.8))
    return out


def cloud_mist(size=MIST_SIZE, seed=810, variant=0):
    """
    云雾带 —— 两层不同速度滚动就是 GDD 要的「云雾流动」。

    `variant` 换个种子出第二条，两条带子的疏密不同，滚动时才不会看出重复。
    """
    w, h = size
    rng = np.random.default_rng(seed + variant * 13)
    out = ik.new_layer(w, h)
    white = (0.99, 0.986, 0.972)
    for i in range(3):
        y = h * (0.34 + i * 0.22)
        out = ik.over(out, ik.mist_band((h, w), rng, y, h * (0.16 - i * 0.02),
                                        color=white,
                                        density=0.72 + 0.12 * i,
                                        stretch=5.0 + i * 2.0,
                                        seed_scale=3 + i))
    return out


# ------------------------------------------------------------ 中景

# 本文件所有「小元素」（树 / 石 / 残壁）都在**局部小画布**上绘制再贴回。
# 原因：`ellipse_mask` / `polygon_mask` 的内部超采样画布是按传入的 shape 开的，
# 一张 4096 宽的中景层上，单个 120px 的树冠会开 8192×4096 的中间图再降采样 ——
# 180 个树冠足以让这张图跑不完。局部化后成本与元素大小成正比，与画幅无关。

def _tree(out, shape, rng, x, base_y, height, color, alpha=0.85, lean=0.0):
    """一棵树 —— 树干一笔，树冠几团墨。就地合成进 `out`。"""
    h, w = shape
    bb = ik.clip_bbox(shape, (x - height * 0.85, base_y - height * 1.30,
                              x + height * 0.85, base_y + height * 0.10))
    if bb is None:
        return out
    x0, y0, x1, y1 = bb
    sub_shape = (y1 - y0, x1 - x0)
    lx, lb = x - x0, base_y - y0
    lay = ik.new_layer(*sub_shape[::-1])

    n = 24
    t = np.linspace(0.0, 1.0, n)
    trunk = np.stack([lx + lean * height * t ** 1.6, lb - height * t], axis=1)
    lay = ik.over(lay, ik.ink_stroke(sub_shape, rng, trunk,
                                     ik.taper(n, height * 0.055, (0.9, 0.25, 0.12)),
                                     color, alpha=alpha, dry=0.35,
                                     blur=0.8, granulate=0.3))

    # 树冠：几团压扁的墨点，整体呈伞形。
    # 要注意别把树冠"打散"过头 —— 大的 warp + 高的 granulate 会把一团墨变成
    # 几缕游丝，整片林子就只剩光秃秃的细枝。
    for i in range(9):
        ct = 0.50 + 0.50 * (i / 8.0)
        cx = lx + lean * height * ct ** 1.6 + rng.uniform(-0.20, 0.20) * height * 0.5
        cy = lb - height * ct + rng.uniform(-0.08, 0.08) * height
        rx = height * rng.uniform(0.15, 0.28) * (1.0 - 0.30 * ct)
        m = ik.ellipse_mask(sub_shape, cx, cy, rx, rx * rng.uniform(0.55, 0.80),
                            feather=rx * 0.22)
        m = ik.ink_wash(m, rng, density=0.92, blur=rx * 0.10,
                        warp_amt=rx * 0.08, granulate=0.28)
        lay = ik.over(lay, ik.fill(color, m * alpha))
    ik.over_region(out, lay, x0, y0)
    return out


def _rock(out, shape, rng, x, base_y, scale, color, alpha=0.85):
    """一块石头 —— 多边形 + 皴。"""
    h, w = shape
    bb = ik.clip_bbox(shape, (x - scale * 1.3, base_y - scale * 1.3,
                              x + scale * 1.3, base_y + scale * 0.4))
    if bb is None:
        return out
    x0, y0, x1, y1 = bb
    sub_shape = (y1 - y0, x1 - x0)
    lx, lb = x - x0, base_y - y0
    lay = ik.new_layer(*sub_shape[::-1])

    n = int(rng.integers(6, 9))
    ang = np.sort(rng.uniform(0, 2 * np.pi, n))
    rad = rng.uniform(0.65, 1.0, n)
    pts = [(lx + np.cos(a) * scale * r, lb - abs(np.sin(a)) * scale * r * 0.85)
           for a, r in zip(ang, rad)]
    m = ik.polygon_mask(sub_shape, pts, feather=scale * 0.03)
    m = ik.ink_wash(m, rng, density=0.9, blur=scale * 0.05, warp_amt=scale * 0.06,
                    granulate=0.45, edge_darken=0.45)
    lay = ik.over(lay, ik.fill(color, m * alpha))

    for _ in range(int(scale / 6)):
        sx = lx + rng.uniform(-0.7, 0.7) * scale
        sy = lb - rng.uniform(0.1, 0.8) * scale
        p = np.stack([sx + np.linspace(0, rng.uniform(-0.4, 0.4) * scale, 8),
                      sy + np.linspace(0, rng.uniform(0.1, 0.4) * scale, 8)], axis=1)
        sub, ox, oy = ik.local_stroke(sub_shape, rng, p,
                                      ik.taper(8, scale * 0.04, (0.3, 0.4, 0.05)),
                                      ik.INK["medium"], alpha=0.35, dry=0.5, blur=0.8)
        if sub is not None:
            ik.over_region(lay, sub, ox, oy)
    ik.over_region(out, lay, x0, y0)
    return out


def _ruin(out, shape, rng, x, base_y, scale, color, alpha=0.9):
    """古祠残壁 —— 几根残柱 + 一段断墙。"""
    h, w = shape
    bb = ik.clip_bbox(shape, (x - scale * 1.7, base_y - scale * 1.5,
                              x + scale * 1.7, base_y + scale * 0.25))
    if bb is None:
        return out
    x0, y0, x1, y1 = bb
    sub_shape = (y1 - y0, x1 - x0)
    lx, lb = x - x0, base_y - y0
    lay = ik.new_layer(*sub_shape[::-1])

    for i in range(3):
        px = lx + (i - 1) * scale * 0.55
        ph = scale * rng.uniform(0.7, 1.25)
        pw = scale * 0.10
        m = ik.polygon_mask(sub_shape, [(px - pw, lb), (px + pw, lb),
                                        (px + pw * 0.85, lb - ph),
                                        (px - pw * 0.85, lb - ph)],
                            feather=scale * 0.02)
        m = ik.ink_wash(m, rng, density=0.88, blur=scale * 0.03,
                        warp_amt=scale * 0.04, granulate=0.40, edge_darken=0.35)
        lay = ik.over(lay, ik.fill(color, m * alpha))
        cap = ik.polygon_mask(sub_shape, [(px - pw * 1.3, lb - ph),
                                          (px + pw * 1.3, lb - ph),
                                          (px + pw * 1.15, lb - ph * 1.06),
                                          (px - pw * 1.15, lb - ph * 1.06)],
                              feather=scale * 0.015)
        lay = ik.over(lay, ik.fill(color, cap * alpha * 0.95))

    wm = ik.polygon_mask(sub_shape, [(lx - scale * 1.1, lb),
                                     (lx - scale * 0.15, lb),
                                     (lx - scale * 0.20, lb - scale * 0.62),
                                     (lx - scale * 0.75, lb - scale * 0.50),
                                     (lx - scale * 1.10, lb - scale * 0.58)],
                         feather=scale * 0.03)
    wm = ik.ink_wash(wm, rng, density=0.9, blur=scale * 0.035,
                     warp_amt=scale * 0.05, granulate=0.42, edge_darken=0.4)
    lay = ik.over(lay, ik.fill(color, wm * alpha))
    ik.over_region(out, lay, x0, y0)
    return out


def bg_mid_forest(size=MID_SIZE, seed=820):
    """
    中景层 —— 林木 + 岩石 + 古祠残壁，细节比远景丰富。

    元素沿 X 均匀分布（用等距 + 抖动，而不是纯随机），否则视差滚动时会出现
    大片空当和局部拥挤。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)

    # 先垫一道远树剪影，给中景一点纵深
    prof = ik.norm01(ik.ridged_1d(w, rng, octaves=6, base=3) + ik.peaks_1d(w, rng, 6))
    top = h * 0.30 + (1 - prof) * h * 0.14
    body = ik.below_profile((h, w), top)
    body = ik.ink_wash(body, rng, density=0.40, blur=13, granulate=0.3)
    out = ik.over(out, ik.fill(ik.INK["pale"], body))

    # 古祠残壁：画面中部偏左，作为地标
    _ruin(out, (h, w), rng, w * 0.24, h * 0.72, h * 0.20,
          ik.INK["medium"], alpha=0.8)

    # 林木：等距 + 抖动
    n_trees = 26
    for i in range(n_trees):
        x = (i + 0.5) / n_trees * w + rng.uniform(-0.4, 0.4) * (w / n_trees)
        x = float(np.clip(x, 60, w - 60))
        base_y = h * rng.uniform(0.70, 0.86)
        ht = h * rng.uniform(0.16, 0.30)
        lean = rng.uniform(-0.10, 0.10)
        # 越远越淡
        depth = rng.uniform(0.0, 1.0)
        ink = ik.INK["light"] if depth < 0.4 else ik.INK["medium"]
        _tree(out, (h, w), rng, x, base_y, ht, ink,
              alpha=0.70 + 0.28 * depth, lean=lean)

    # 岩石
    for i in range(16):
        x = rng.uniform(0, w)
        base_y = h * rng.uniform(0.74, 0.90)
        _rock(out, (h, w), rng, x, base_y, h * rng.uniform(0.03, 0.075),
              ik.INK["medium"], alpha=rng.uniform(0.5, 0.8))

    # 近地面的一条墨带，把中景"坐"在地上
    ground = ik.below_profile((h, w), np.full(w, h * 0.88, np.float32))
    ground = ik.ink_wash(ground, rng, density=0.55, blur=8, granulate=0.5,
                         edge_darken=0.3)
    out = ik.over(out, ik.fill(ik.INK["medium"], ground))
    return out


def bg_near_grass(size=NEAR_SIZE, seed=830):
    """
    近景层 —— 草丛 + 碎石 + 花枝，随人物移动轻微晃动。

    只画**下缘一条带**：近景层在引擎里会被放大并贴近相机，铺满整屏会糊成一片。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    base = h * 0.92

    # 一丛草 = 若干片叶
    n_clump = 90
    for i in range(n_clump):
        cx = rng.uniform(0, w)
        cw = h * rng.uniform(0.18, 0.42)
        blades = int(rng.integers(4, 9))
        for _ in range(blades):
            ln = cw * rng.uniform(0.6, 1.3)
            lean = rng.uniform(-0.7, 0.7)
            n = 14
            t = np.linspace(0.0, 1.0, n)
            p = np.stack([cx + lean * ln * 0.5 * t ** 2 + rng.uniform(-4, 4),
                          base - ln * t], axis=1)
            wid = ik.taper(n, h * rng.uniform(0.012, 0.026), (0.9, 0.3, 0.03))
            sub, ox, oy = ik.local_stroke((h, w), rng, p, wid,
                                          ik.INK["heavy"] if rng.random() < 0.5
                                          else ik.INK["medium"],
                                          alpha=rng.uniform(0.55, 0.95),
                                          dry=0.3, blur=0.7, granulate=0.25)
            if sub is not None:
                ik.over_region(out, sub, ox, oy)

    # 碎石
    for _ in range(45):
        cx = rng.uniform(0, w)
        r = h * rng.uniform(0.012, 0.040)
        m = ik.ellipse_mask((h, w), cx, base - r * 0.4, r * rng.uniform(1.0, 1.8), r,
                            feather=r * 0.35)
        m = ik.ink_wash(m, rng, density=0.85, warp_amt=r * 0.3, granulate=0.4,
                        edge_darken=0.4)
        out = ik.over(out, ik.fill(ik.INK["medium"], m * rng.uniform(0.5, 0.85)))

    # 花枝（赭石小点，画面里唯一的暖色，用来提亮近景）
    for _ in range(26):
        cx = rng.uniform(0, w)
        ln = h * rng.uniform(0.15, 0.34)
        n = 12
        t = np.linspace(0, 1, n)
        p = np.stack([cx + 0.4 * ln * t ** 2 * rng.uniform(-1, 1), base - ln * t], axis=1)
        sub, ox, oy = ik.local_stroke((h, w), rng, p,
                                      ik.taper(n, h * 0.010, (0.8, 0.3, 0.05)),
                                      ik.INK["medium"], alpha=0.7, dry=0.4)
        if sub is not None:
            ik.over_region(out, sub, ox, oy)
        for k in range(3):
            bt = 0.6 + 0.4 * k / 2.0
            fx = cx + 0.4 * ln * bt ** 2 * 0.8
            fy = base - ln * bt
            fl = ik.ellipse_mask((h, w), fx + rng.uniform(-6, 6), fy,
                                 h * 0.012, h * 0.010, feather=h * 0.005)
            out = ik.over(out, ik.fill(ik.MINERAL["ochre"], fl * 0.75))
    return out


def boss_valley(size=FAR_SIZE, seed=840):
    """
    Boss 战场背景 —— 青丘谷地，比常规远景更开阔（清单 #11）。

    「开阔」的做法是**压低山线、加大留白**：地平线以下压到画面下 1/4，
    上面全是雾和天，气势才出得来。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    white = (0.985, 0.982, 0.968)

    prof = ik.norm01(ik.ridged_1d(w, rng, octaves=5, base=2) + ik.peaks_1d(w, rng, 3))
    top = h * 0.30 + (1 - prof) * h * 0.16
    out = ik.over(out, ik.mountain_layer(
        (h, w), rng, top, ink="pale", density=0.35, blur=16, granulate=0.22,
        vertical_fade=0.7, color=ik.MINERAL["azurite_lt"], color_amt=0.32,
        contour=1.8, contour_alpha=0.28, cun=30, cun_length=(30, 80), cun_alpha=0.2))
    out = ik.over(out, ik.mist_band((h, w), rng, h * 0.56, h * 0.16,
                                    color=white, density=0.95))

    # 谷地两侧的丘
    for sgn in (-1, 1):
        prof = ik.norm01(ik.ridged_1d(w, rng, octaves=6, base=2))
        top = h * 0.58 + (1 - prof) * h * 0.16
        # 只保留一侧：把另一侧推高到画面外
        cx = 0.5 + 0.5 * sgn
        mask = np.clip(1.0 - np.abs(np.linspace(0, 1, w) - cx) / 0.42, 0, 1)
        top = top + (1.0 - mask) * h
        out = ik.over(out, ik.mountain_layer(
            (h, w), rng, top, ink="light", density=0.62, blur=7, granulate=0.35,
            edge_darken=0.35, warp_amt=3,
            color=(ik.MINERAL["malachite"], ik.MINERAL["azurite"]), color_amt=0.45,
            vertical_fade=0.4, contour=2.6, contour_ink=ik.INK["medium"],
            cun=200, cun_length=(22, 70), cun_alpha=0.3, cun_spread=0.4))

    out = ik.over(out, ik.mist_band((h, w), rng, h * 0.78, h * 0.10,
                                    color=white, density=0.85))
    return out


# ------------------------------------------------------------ 道具

def spring_platform(size=(512, 384), seed=850):
    """
    灵泉石台（清单 #12）—— 触碰恢复 50 点灵炁（GDD §3.1）。

    必须一眼看出「这里能回灵炁」：石台中央一汪会发光的灵泉，
    冷青的灵炁色跟场景的青绿拉开明度差。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    cx, base = w * 0.5, h * 0.82

    # 石台：三层台阶，越往上越窄
    for i, (sw, sy, tone) in enumerate([(0.46, 0.00, 0.46), (0.38, -0.09, 0.52),
                                        (0.30, -0.18, 0.58)]):
        pts = [(cx - w * sw, base - h * sy), (cx + w * sw, base - h * sy),
               (cx + w * sw * 0.94, base - h * (sy + 0.10)),
               (cx - w * sw * 0.94, base - h * (sy + 0.10))]
        m = ik.polygon_mask((h, w), pts, feather=6)
        m = ik.ink_wash(m, rng, density=0.92, blur=4, warp_amt=3, granulate=0.45,
                        edge_darken=0.45)
        out = ik.over(out, ik.fill((tone, tone + 0.02, tone), m))

    # 泉眼
    pool = ik.ellipse_mask((h, w), cx, base - h * 0.28, w * 0.21, h * 0.085, feather=8)
    pool = ik.ink_wash(pool, rng, density=0.95, blur=3, granulate=0.2)
    out = ik.over(out, ik.fill(ik.SPIRIT["deep"], pool * 0.85))
    out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], pool, w * 0.10, 1.0))
    core = ik.ellipse_mask((h, w), cx, base - h * 0.29, w * 0.15, h * 0.055, feather=6)
    out = ik.over(out, ik.fill(ik.SPIRIT["core"], core * 0.8))

    # 上升的灵炁
    for i in range(14):
        t = np.linspace(0, 1, 18)
        px = cx + rng.uniform(-0.18, 0.18) * w
        rise = h * rng.uniform(0.16, 0.42)
        p = np.stack([px + np.sin(t * 2.4 + i) * w * 0.035,
                      base - h * 0.30 - rise * t], axis=1)
        m = ik.stroke_mask((h, w), p, ik.taper(18, w * 0.020, (0.4, 0.35, 0.02)))
        m = ik.dry_brush(m, rng, 0.5, stretch=5)
        out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], m, w * 0.03, 0.8))
        out = ik.over(out, ik.fill(ik.SPIRIT["core"], m * 0.6))
    return out


def realm_barrier(size=(512, 768), seed=860):
    """
    灵界屏障（清单 #13）—— 分隔「实体界」与「灵界」。

    半透明是关键：玩家要透过它看见另一边，才知道"那边有路"。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)

    body = ik.ellipse_mask((h, w), w * 0.5, h * 0.5, w * 0.42, h * 0.46, feather=w * 0.10)
    n = ik.fbm(h, w, rng, octaves=5, base_cells=5)
    body = body * (0.55 + 0.45 * n)
    out = ik.over(out, ik.fill(ik.SPIRIT["deep"], body * 0.30))

    # 竖直的灵纹
    for i in range(9):
        x = w * (0.14 + 0.09 * i)
        t = np.linspace(0, 1, 40)
        p = np.stack([x + np.sin(t * 5.0 + i) * w * 0.025, h * 0.08 + t * h * 0.84], axis=1)
        m = ik.stroke_mask((h, w), p, ik.taper(40, w * 0.018, (0.2, 0.5, 0.2)))
        m = m * body
        out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], m, w * 0.035, 0.9))
        out = ik.over(out, ik.fill(ik.SPIRIT["core"], m * 0.55))

    # 边缘亮框
    rim = np.clip(ik.gblur(body, w * 0.02) - ik.gblur(body, w * 0.06), 0, 1)
    out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], ik.norm01(rim), w * 0.04, 1.0))
    return out


def realm_switch(size=(256, 256), on=False, seed=870):
    """
    灵界机关（清单 #14）—— 暗 / 亮两态。

    两态**共用同一套几何**，只改亮度与灵光；形状变了下手就认不出是同一个机关。
    """
    w, h = size
    rng = np.random.default_rng(seed + (1 if on else 0))
    out = ik.new_layer(w, h)
    cx, cy = w * 0.5, h * 0.54

    # 八角石盘
    r = w * 0.32
    ang = np.linspace(0, 2 * np.pi, 9)[:-1] + np.pi / 8
    pts = [(cx + r * np.cos(a), cy + r * np.sin(a)) for a in ang]
    m = ik.polygon_mask((h, w), pts, feather=5)
    m = ik.ink_wash(m, rng, density=0.92, blur=3, warp_amt=2, granulate=0.45,
                    edge_darken=0.45)
    out = ik.over(out, ik.fill((0.42, 0.44, 0.43) if not on else (0.46, 0.48, 0.46), m))

    # 内圈灵纹
    inner = ik.ellipse_mask((h, w), cx, cy, r * 0.52, r * 0.52, feather=4)
    if on:
        out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], inner, w * 0.10, 1.0))
        out = ik.over(out, ik.fill(ik.SPIRIT["core"], inner * 0.85))
    else:
        m2 = ik.ink_wash(inner, rng, density=0.8, blur=2, granulate=0.3)
        out = ik.over(out, ik.fill(ik.INK["heavy"], m2 * 0.6))

    # 三条辐条
    for i in range(3):
        a = -np.pi / 2 + i * 2 * np.pi / 3
        p = np.stack([cx + np.linspace(r * 0.30, r * 0.86, 10) * np.cos(a),
                      cy + np.linspace(r * 0.30, r * 0.86, 10) * np.sin(a)], axis=1)
        col = ik.SPIRIT["core"] if on else ik.INK["light"]
        out = ik.over(out, ik.ink_stroke((h, w), rng, p,
                                         np.full(10, w * 0.022, np.float32), col,
                                         alpha=0.9 if on else 0.5))
    return out


def ground_tileset(size=(1024, 512), seed=880):
    """
    地面 / 平台 tileset（清单 #15）。

    横向可平铺（引擎按 Tiled 铺开），所以上缘轮廓也必须用可平铺噪声。
    上缘画出高低起伏，铺开后才有"土坡"而不是"一条直尺"。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)

    prof = ik.ridged_1d(w, rng, octaves=5, base=6)
    top = h * 0.16 + ik.norm01(prof) * h * 0.10
    body = ik.below_profile((h, w), top)
    body = ik.ink_wash(body, rng, density=0.9, blur=4, warp_amt=3, granulate=0.5,
                       edge_darken=0.3)
    out = ik.over(out, ik.fill((0.44, 0.47, 0.44), body))
    # 覆土：上缘一层薄薄的青绿
    grass = ik.below_profile((h, w), top) - ik.below_profile((h, w), top + h * 0.075)
    gm = ik.ink_wash(np.clip(grass, 0, 1), rng, density=0.85, blur=3, granulate=0.5)
    out = ik.over(out, ik.fill(ik.MINERAL["malachite"], gm * 0.6))

    # 层理线：横向细纹，让平地也有内容
    for i in range(4):
        y = h * (0.34 + i * 0.16)
        t = np.linspace(0, w, 90)
        p = np.stack([t, y + 4 * np.sin(t / w * np.pi * 4 + i)], axis=1)
        out = ik.over(out, ik.ink_stroke((h, w), rng, p,
                                         np.full(90, h * 0.012, np.float32),
                                         ik.INK["light"], alpha=0.35, dry=0.55,
                                         blur=1.2))
    return out


# ------------------------------------------------------------ 入口

def build(out_dir, seed=3000):
    res = {}
    res["bg_far_mountains.png"] = bg_far_mountains(seed=seed)
    res["cloud_mist_a.png"] = cloud_mist(seed=seed, variant=0)
    res["cloud_mist_b.png"] = cloud_mist(seed=seed, variant=1)
    res["bg_mid_forest.png"] = bg_mid_forest(seed=seed + 20)
    res["bg_near_grass.png"] = bg_near_grass(seed=seed + 30)
    res["boss_valley.png"] = boss_valley(seed=seed + 40)
    res["spring_platform.png"] = spring_platform(seed=seed + 50)
    res["realm_barrier.png"] = realm_barrier(seed=seed + 60)
    res["realm_switch_off.png"] = realm_switch(on=False, seed=seed + 70)
    res["realm_switch_on.png"] = realm_switch(on=True, seed=seed + 70)
    res["ground_tileset.png"] = ground_tileset(seed=seed + 80)
    return res
