# -*- coding: utf-8 -*-
"""
特效素材生成器 —— 对照 `docs/大赛规划v2.0` 美术资产清单 #16–27
==========================================================

风格依据 `docs/Cloud Eyrie.md` §7.2：

    莹翳灵雾形态采用水墨粒子效果，边缘晕染虚化
    浊湮：浓黑水墨质感，带有颗粒流动感，与清亮的灵炁形成强烈对比

产出（`art-source/fx/`）
-----------------------
剑光弧线 / 重击光柱 / 踏云闪拖尾 / 形态切换粒子表 / 灵合爆发 / 浊湮水洼 /
灵炁弹丸 / 净化光环 / 格挡闪光 / 完美格挡反制 / 受击反馈。

⚠️ 全部是**单帧**。真正带旋转、缩放、拖尾的动画要靠引擎的粒子系统驱动
（规划里的「特效系统框架（粒子）」还是 ❌）。这里给的是每个特效的**定格一帧**，
用来定色、定形、定尺寸，也可以直接当静态贴图用。

尺寸约定
-------
特效一律画在正方形或宽高比明确的画布中央，**四周留出透明边距**：
引擎做缩放 / 模糊 / 加色混合时，贴边会被裁掉。
"""

import numpy as np

import inkwash as ik


# ------------------------------------------------------------ 通用形体

def crescent(shape, rng, cx, cy, r, thickness, angle=0.0, sweep=np.pi * 0.85,
             color=None, alpha=0.95, glow=1.0, dry=0.25):
    """
    一弯弧 —— 剑光的基本形。

    弧的两端收成尖锋（`taper`），中段最厚；这是「挥」出来的痕迹，
    等宽的圆环看起来像甜甜圈。
    """
    h, w = shape
    color = color if color is not None else ik.SPIRIT["core"]
    out = ik.new_layer(w, h)
    a = np.linspace(-sweep / 2, sweep / 2, 80) + angle
    pts = np.stack([cx + r * np.cos(a), cy + r * np.sin(a)], axis=1)
    wid = ik.taper(80, thickness, profile=(0.02, 0.5, 0.02), power=0.85)

    m = ik.stroke_mask((h, w), pts, wid)
    if glow > 0:
        out = ik.over(out, ik.glow_layer(color, m, thickness * 2.2, glow))
    core = m * (0.45 + 0.55 * ik.fbm(h, w, rng, octaves=4, base_cells=8))
    out = ik.over(out, ik.fill(color, core * alpha))
    # 内芯更白，光才有"核"
    inner = ik.stroke_mask((h, w), pts, wid * 0.42)
    out = ik.over(out, ik.fill((1.0, 1.0, 1.0), inner * alpha * 0.8))
    return out


def radial_burst(shape, rng, cx, cy, r, count=26, color=None, alpha=0.85,
                 length=(0.5, 1.0), width=0.035, glow=1.0, spread=1.0):
    """
    放射爆发 —— 灵合 / 净化 / 受击反馈共用。

    射线长度与宽度都带随机，否则会像个太阳图标。
    """
    h, w = shape
    color = color if color is not None else ik.SPIRIT["glow"]
    out = ik.new_layer(w, h)
    if glow > 0:
        core = ik.ellipse_mask((h, w), cx, cy, r * 0.55, r * 0.55, feather=r * 0.3)
        out = ik.over(out, ik.glow_layer(color, core, r * 0.35, glow * 0.7))

    for i in range(count):
        a = (i / count) * 2 * np.pi * spread + rng.uniform(-0.08, 0.08)
        ln = r * rng.uniform(*length)
        n = 12
        t = np.linspace(0.15, 1.0, n)
        pts = np.stack([cx + ln * t * np.cos(a), cy + ln * t * np.sin(a)], axis=1)
        wid = ik.taper(n, r * width * rng.uniform(0.6, 1.4),
                       profile=(0.9, 0.35, 0.02))
        m = ik.stroke_mask((h, w), pts, wid)
        m = ik.dry_brush(m, rng, 0.35, stretch=5)
        out = ik.over(out, ik.fill(color, m * alpha * rng.uniform(0.6, 1.0)))

    cc = ik.ellipse_mask((h, w), cx, cy, r * 0.16, r * 0.16, feather=r * 0.08)
    out = ik.over(out, ik.fill((1.0, 1.0, 1.0), cc * alpha))
    return out


def ink_splash(shape, rng, cx, cy, r, color=None, alpha=0.9, drops=40):
    """
    墨点飞溅 —— 浊湮与打击反馈共用。

    主体是一团不规则的墨，外加甩出去的散点；散点方向要有主次，
    均匀分布会像噪点。
    """
    h, w = shape
    color = color if color is not None else ik.INK["burnt"]
    out = ik.new_layer(w, h)

    blob = ik.ellipse_mask((h, w), cx, cy, r * 0.42, r * 0.36, feather=r * 0.1)
    blob = ik.ink_wash(blob, rng, density=0.95, blur=r * 0.03,
                       warp_amt=r * 0.16, granulate=0.45, edge_darken=0.4)
    out = ik.over(out, ik.fill(color, blob * alpha))

    main_a = rng.uniform(0, 2 * np.pi)
    for _ in range(drops):
        a = main_a + rng.normal(0, 0.9)
        d = r * (0.35 + abs(rng.normal(0, 0.45)))
        px, py = cx + d * np.cos(a), cy + d * np.sin(a)
        rr = r * abs(rng.normal(0.035, 0.022)) + r * 0.008
        m = ik.ellipse_mask((h, w), px, py, rr * rng.uniform(1.0, 2.2), rr,
                            feather=rr * 0.4)
        out = ik.over(out, ik.fill(color, m * alpha * rng.uniform(0.4, 1.0)))
    return out


# ------------------------------------------------------------ 各特效

def slash_light(size=(512, 512), seed=900):
    """
    剑光 · 轻击 —— 挥砍弧线（清单 #16）。

    主体用 `SPIRIT["glow"]`（青碧）而非 `core`（近白）：本作底色是浅色宣纸，
    近白的光刃在浅底上等于没画。白色只留在最内一层做"核"。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = crescent((h, w), rng, w * 0.5, h * 0.52, w * 0.30, w * 0.055,
                   angle=-0.5, sweep=np.pi * 0.9,
                   color=ik.SPIRIT["glow"], alpha=0.95, glow=1.0)
    out = ik.over(out, ink_splash((h, w), rng, w * 0.5, h * 0.52, w * 0.20,
                                  color=ik.SPIRIT["deep"], alpha=0.35, drops=16))
    return out


def slash_heavy(size=(512, 768), seed=901):
    """
    剑光 · 蓄力重击 —— 光柱（清单 #16）。

    竖向构图：蓄满 250% 的那一下是"砸"下去的，横弧表现不出重量。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    cx = w * 0.5

    # 光柱本体：中间最宽、两端收锋
    n = 40
    t = np.linspace(0.0, 1.0, n)
    pts = np.stack([cx + 6 * np.sin(t * np.pi * 2.0), h * 0.06 + t * h * 0.86], axis=1)
    wid = ik.taper(n, w * 0.34, profile=(0.25, 0.55, 0.04), power=0.8)
    m = ik.stroke_mask((h, w), pts, wid)
    m = ik.dry_brush(m, rng, 0.30, stretch=10)
    out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], m, w * 0.14, 1.0))
    out = ik.over(out, ik.fill(ik.SPIRIT["glow"], m * 0.85))
    inner = ik.stroke_mask((h, w), pts, wid * 0.38)
    out = ik.over(out, ik.fill((1.0, 1.0, 1.0), inner * 0.9))

    # 落点的迸溅
    out = ik.over(out, ink_splash((h, w), rng, cx, h * 0.88, w * 0.36,
                                  color=ik.SPIRIT["core"], alpha=0.5, drops=30))
    return out


def dash_trail(size=(768, 256), seed=902):
    """
    踏云闪 · 水墨拖尾（清单 #17）。

    横向拖尾，左淡右浓 —— 右端是角色当前位置，残影向后（左）衰减。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    # 沿画布宽度的衰减斜坡。注意别拿笔画采样序号当斜坡：那是 60 个点，
    # 而遮罩是 768 宽的，广播不上。
    ramp = (0.12 + 0.88 * np.linspace(0.0, 1.0, w, dtype=np.float32))[None, :]

    for i in range(12):
        t = np.linspace(0.0, 1.0, 60)
        y = h * (0.5 + rng.uniform(-0.34, 0.34))
        pts = np.stack([t * w * 0.94, y + np.sin(t * 4.0 + i) * h * 0.05 * t], axis=1)
        # 越靠右越粗越实
        wid = ik.taper(60, h * rng.uniform(0.05, 0.13), profile=(0.02, 0.95, 0.30))
        m = ik.stroke_mask((h, w), pts, wid)
        m = ik.dry_brush(m, rng, 0.45, stretch=9) * ramp
        out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], m, h * 0.045, 0.55))
        out = ik.over(out, ik.fill(ik.SPIRIT["core"], m * 0.75))
    return out


def switch_particles(size=(1024, 1024), frames=16, seed=903):
    """
    形态切换粒子表（清单 #18）—— 4×4 = 16 帧，实体 ↔ 灵雾。

    粒子**向外扩散并变淡**，读法是「散成雾」；反过来播就是「凝成实体」。
    帧序按行从左到右、从上到下。
    """
    W, H = size
    cw, ch = W // 4, H // 4
    sheet = ik.new_layer(W, H)

    for f in range(frames):
        rng = np.random.default_rng(seed + f)
        t = f / (frames - 1.0)
        cell = ik.new_layer(cw, ch)
        cx, cy = cw * 0.5, ch * 0.5

        # 半径随帧扩大，整体透明度随帧衰减
        r = cw * (0.10 + 0.36 * t)
        fade = 1.0 - 0.75 * t
        for i in range(30):
            a = rng.uniform(0, 2 * np.pi)
            d = r * rng.uniform(0.55, 1.15)
            px, py = cx + d * np.cos(a), cy + d * np.sin(a)
            rr = cw * rng.uniform(0.012, 0.040) * (1.0 - 0.35 * t)
            m = ik.ellipse_mask((ch, cw), px, py, rr, rr, feather=rr * 0.7)
            cell = ik.over(cell, ik.fill(ik.SPIRIT["glow"], m * fade * rng.uniform(0.5, 1.0)))
        # 中心的灵核
        core = ik.ellipse_mask((ch, cw), cx, cy, cw * 0.13 * (1 - t) ** 1.4,
                               ch * 0.13 * (1 - t) ** 1.4, feather=cw * 0.04)
        cell = ik.over(cell, ik.glow_layer(ik.SPIRIT["glow"], core, cw * 0.06, 0.9))
        cell = ik.over(cell, ik.fill(ik.SPIRIT["core"], core * 0.95))

        r_, c_ = divmod(f, 4)
        sheet[r_ * ch:(r_ + 1) * ch, c_ * cw:(c_ + 1) * cw] = cell
    return sheet


def merge_burst(size=(768, 768), seed=904):
    """灵合切换光效 —— 灵雾 → 灵合的爆发（清单 #19）。用暖金，与灵炁的青碧区分。"""
    w, h = size
    rng = np.random.default_rng(seed)
    out = radial_burst((h, w), rng, w * 0.5, h * 0.5, w * 0.40,
                       count=34, color=ik.SPIRIT["merge"], alpha=0.85,
                       length=(0.45, 1.0), width=0.030, glow=1.2)
    # 外圈光环
    a = np.linspace(0, 2 * np.pi, 120)
    ring = np.stack([w * 0.5 + w * 0.36 * np.cos(a), h * 0.5 + h * 0.36 * np.sin(a)],
                    axis=1)
    rm = ik.stroke_mask((h, w), ring, np.full(120, w * 0.020, np.float32))
    out = ik.over(out, ik.glow_layer(ik.SPIRIT["merge"], rm, w * 0.05, 1.0))
    out = ik.over(out, ik.fill(ik.SPIRIT["merge_deep"], rm * 0.7))
    return out


def corruption_pool(size=(768, 384), seed=905):
    """
    浊湮区域 —— 黑墨水洼 + 颗粒流动（清单 #20）。

    颗粒要**横向流动**（GDD 说"颗粒流动感"），所以噪声按 X 拉长。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)

    # 压扁一点才像"水洼"；正圆会读成"墨团"
    pool = ik.ellipse_mask((h, w), w * 0.5, h * 0.5, w * 0.46, h * 0.27, feather=w * 0.05)
    # 噪声先生成矮而宽的一张再放大 → 颗粒被横向拉长，看起来在流动
    n = ik.fbm(max(2, h // 4), w, rng, octaves=5, base_cells=6)
    n = ik.resize(n, (w, h))
    pool = pool * ik.smoothstep(n, 0.24, 0.74)
    pool = ik.ink_wash(pool, rng, density=0.97, blur=w * 0.012, warp_amt=w * 0.02,
                       granulate=0.35)
    out = ik.over(out, ik.fill(ik.CORRUPT["deep"], pool))

    # 颗粒
    grain = ik.fbm(max(2, h // 3), w, rng, octaves=4, base_cells=12)
    grain = ik.resize(grain, (w, h))
    g = np.clip(pool * (grain - 0.52) * 3.0, 0, 1)
    out = ik.over(out, ik.fill(ik.CORRUPT["ash"], ik.gblur(g, 2) * 0.55))

    # 边缘翳散
    rim = np.clip(ik.gblur(pool, w * 0.02) - pool, 0, 1)
    out = ik.over(out, ik.fill(ik.CORRUPT["haze"], ik.norm01(rim) * 0.5))
    return out


def spirit_orb(size=(128, 128), seed=906):
    """灵炁弹丸 —— 灵雾态发射（清单 #21，对应 `combat/MistShot.ts`）。"""
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    cx, cy = w * 0.5, h * 0.5
    core = ik.ellipse_mask((h, w), cx, cy, w * 0.20, h * 0.20, feather=w * 0.06)
    out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], core, w * 0.20, 1.2))
    out = ik.over(out, ik.fill(ik.SPIRIT["core"], ik.gblur(core, w * 0.02) * 0.95))
    inner = ik.ellipse_mask((h, w), cx, cy, w * 0.09, h * 0.09, feather=w * 0.03)
    out = ik.over(out, ik.fill((1.0, 1.0, 1.0), inner * 0.95))
    return out


def purify_ring(size=(768, 768), seed=907):
    """净化光环 —— 灵合态范围光圈（清单 #22）。"""
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    cx, cy = w * 0.5, h * 0.5

    # 主环
    a = np.linspace(0, 2 * np.pi, 200)
    ring = np.stack([cx + w * 0.38 * np.cos(a), cy + h * 0.38 * np.sin(a)], axis=1)
    wid = np.full(200, w * 0.022, np.float32)
    wid *= 0.7 + 0.6 * ik.fbm(1, 200, rng, octaves=4, base_cells=7)[0]
    rm = ik.stroke_mask((h, w), ring, wid)
    rm = ik.dry_brush(rm, rng, 0.35, stretch=6)
    out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], rm, w * 0.06, 1.1))
    out = ik.over(out, ik.fill(ik.SPIRIT["core"], rm * 0.8))

    # 外散的光尘
    for i in range(50):
        ang = rng.uniform(0, 2 * np.pi)
        d = w * rng.uniform(0.34, 0.48)
        r = w * rng.uniform(0.004, 0.014)
        m = ik.ellipse_mask((h, w), cx + d * np.cos(ang), cy + d * np.sin(ang),
                            r, r, feather=r)
        out = ik.over(out, ik.fill(ik.SPIRIT["glow"], m * rng.uniform(0.3, 0.8)))
    return out


def block_spark(size=(384, 384), seed=908):
    """格挡闪光 —— 挡住的那一下（清单 #25）。"""
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    cx, cy = w * 0.5, h * 0.52
    # 十字星芒：格挡是"挡"，不是"打"，所以是硬边的星而非柔光
    for a0, ln, wd in [(0, 0.46, 0.030), (np.pi / 2, 0.34, 0.026),
                       (np.pi / 4, 0.22, 0.018), (-np.pi / 4, 0.22, 0.018)]:
        pts = np.stack([cx + np.linspace(-ln, ln, 30) * w * np.cos(a0),
                        cy + np.linspace(-ln, ln, 30) * h * np.sin(a0)], axis=1)
        m = ik.stroke_mask((h, w), pts, ik.taper(30, w * wd, (0.0, 0.5, 0.0)))
        out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], m, w * 0.06, 1.0))
        out = ik.over(out, ik.fill((1.0, 1.0, 1.0), m * 0.9))
    return out


def block_counter(size=(512, 512), seed=909):
    """
    完美格挡反制剑光（清单 #25）。

    和轻击剑光**必须是不同的形**：两者若都是单弧，玩家分不出哪一下是反制。
    这里用青碧 + 暖金两道交叉弧，读作「架开并回敬」。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    for ang, sweep, col in [(-2.4, 1.05, ik.SPIRIT["glow"]),
                            (-0.7, 0.85, ik.SPIRIT["merge"])]:
        out = ik.over(out, crescent((h, w), rng, w * 0.5, h * 0.5, w * 0.30,
                                    w * 0.042, angle=ang, sweep=np.pi * sweep,
                                    color=col, alpha=1.0, glow=1.2))
    out = ik.over(out, ink_splash((h, w), rng, w * 0.5, h * 0.5, w * 0.24,
                                  color=ik.SPIRIT["deep"], alpha=0.5, drops=22))
    return out


def hit_feedback(size=(384, 384), seed=910):
    """受击反馈 —— 灵光闪烁 + 粒子飞散（清单 #26）。"""
    w, h = size
    rng = np.random.default_rng(seed)
    out = radial_burst((h, w), rng, w * 0.5, h * 0.5, w * 0.36,
                       count=22, color=ik.SPIRIT["glow"], alpha=0.9,
                       length=(0.45, 1.0), width=0.055, glow=1.0)
    out = ik.over(out, ink_splash((h, w), rng, w * 0.5, h * 0.5, w * 0.22,
                                  color=ik.INK["burnt"], alpha=0.4, drops=18))
    return out


# ------------------------------------------------------------ 入口

def build(out_dir, seed=4000):
    res = {}
    res["slash_light.png"] = slash_light(seed=seed)
    res["slash_heavy.png"] = slash_heavy(seed=seed)
    res["dash_trail.png"] = dash_trail(seed=seed)
    res["switch_particles.png"] = switch_particles(seed=seed)
    res["merge_burst.png"] = merge_burst(seed=seed)
    res["corruption_pool.png"] = corruption_pool(seed=seed)
    res["spirit_orb.png"] = spirit_orb(seed=seed)
    res["purify_ring.png"] = purify_ring(seed=seed)
    res["block_spark.png"] = block_spark(seed=seed)
    res["block_counter.png"] = block_counter(seed=seed)
    res["hit_feedback.png"] = hit_feedback(seed=seed)
    return res
