# -*- coding: utf-8 -*-
"""
角色与敌人 sprite 生成器 —— 对照 `docs/大赛规划v2.0` 美术资产清单 #3–7
==================================================================

风格依据 `docs/Cloud Eyrie.md` §7.2：

    莹翳：通体雪白，生半透明鹿角，尾带灵雾（§2.3）
          实体形态毛发柔和，灵雾形态采用水墨粒子效果，边缘晕染虚化
    浊湮：浓黑水墨质感，带有颗粒流动感，与清亮的灵炁形成强烈对比

产出（`art-source/char/`）
-----------------------
莹翳实体态 / 灵雾态、阳浊小怪、阴浊、狐火。

⚠️ 这是**程序化占位**，不是正式美术。骨骼动画、多帧待机/行走/攻击都做不了，
只能给一张能定比例、定配色、定朝向的静帧。正式资产仍要美术组手绘。

朝向约定
-------
所有角色一律**朝右**绘制。GDD 只提供了单侧素材，左右靠镜像 ——
与 `FacingFlip.naturalFacing = 1`（立绘朝右）保持一致。
传错会出现"攻击打到背后"（见 CLAUDE.md 的踩坑记录）。
"""

import numpy as np

import inkwash as ik

# ------------------------------------------------------------ 莹翳的轮廓
#
# 图标、实体态 sprite、灵雾态 sprite 都从这里取形 —— 同一个角色在 UI 里和
# 场景里长得不一样是很低级的问题。

DEER_BODY = [
    (-0.34, -0.02),   # 臀
    (-0.28, -0.11),
    (-0.14, -0.14),   # 背
    (0.02, -0.14),
    (0.14, -0.11),    # 肩
    (0.19, -0.19),    # 颈
    (0.24, -0.27),    # 头顶
    (0.31, -0.30),    # 额
    (0.38, -0.27),    # 鼻尖
    (0.35, -0.21),    # 嘴下
    (0.28, -0.18),    # 下颌
    (0.23, -0.08),    # 胸
    (0.17, 0.09),     # 前腿根
    (0.05, 0.14),     # 腹
    (-0.12, 0.15),
    (-0.24, 0.11),    # 后腿根
    (-0.33, 0.04),
]

DEER_LEGS = [0.155, 0.115, -0.235, -0.175]      # x 位置（单位坐标）
DEER_ANTLER_ROOT = (0.24, -0.29)


def deer_path(size, cx, cy, unit, facing=1):
    """把单位轮廓映射到画布坐标。`unit` 是身体长度（px）。"""
    return np.array([(cx + x * unit * facing, cy + y * unit) for x, y in DEER_BODY])


def deer_antlers(size, rng, cx, cy, unit, facing=1, alpha=0.85):
    """
    鹿角 —— 半透明，是莹翳最关键的识别特征（§2.3）。

    做成两支分叉，且**灵炁辉光**而非实色：GDD 说"生半透明鹿角"，
    实心黑角会立刻把它从瑞兽拉回普通鹿。
    """
    h, w = size
    out = ik.new_layer(w, h)
    root_x = cx + DEER_ANTLER_ROOT[0] * unit * facing
    root_y = cy + DEER_ANTLER_ROOT[1] * unit
    for sgn in (-1, 1):
        for br in range(2):
            t = np.linspace(0.0, 1.0, 22)
            # 主枝向上后弯；侧枝是主枝中段分出去的一小杈
            x0 = root_x + facing * (br * 0.05 - 0.02) * unit * sgn * 0.6
            pts = np.stack([
                x0 + facing * (0.10 + 0.06 * br) * unit * sgn * t ** 1.4,
                root_y - (0.10 + 0.05 * br) * unit * t - 0.02 * unit * t ** 2,
            ], axis=1)
            wid = ik.taper(22, unit * (0.028 - 0.008 * br), profile=(0.35, 0.4, 0.03))
            m = ik.stroke_mask((h, w), pts, wid)
            out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], m, unit * 0.03, 0.55))
            out = ik.over(out, ik.fill(ik.SPIRIT["core"], m * alpha))
    return out


def deer_tail_mist(size, rng, cx, cy, unit, facing=1, count=4, alpha=0.6):
    """尾部灵雾 —— 从臀部向后拖出的几缕水墨晕染。"""
    h, w = size
    out = ik.new_layer(w, h)
    bx = cx - 0.34 * unit * facing
    by = cy - 0.02 * unit
    for i in range(count):
        t = np.linspace(0.0, 1.0, 40)
        pts = np.stack([
            bx - facing * (0.10 + 0.20 * i / count) * unit * t,
            by + (rng.uniform(-0.05, 0.05) + 0.10 * t) * unit
            + 0.05 * unit * np.sin(t * 3.4 + i * 1.7),
        ], axis=1)
        m = ik.stroke_mask((h, w), pts, ik.taper(40, unit * 0.05, (0.25, 0.45, 0.02)))
        m = ik.dry_brush(m, rng, 0.45, stretch=6)
        out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], m, unit * 0.04, 0.5))
        out = ik.over(out, ik.fill(ik.SPIRIT["core"], m * alpha))
    return out


def yingyi_entity(size=(512, 512), unit=340.0, seed=700):
    """
    莹翳 · 实体态 —— 通体雪白 + 半透明鹿角 + 尾带灵雾。

    白身不能是纯白：纯白在浅色宣纸背景上会"消失"。用极淡的冷白，
    再靠一圈很淡的墨边把它从纸上"托"起来。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    cx, cy = w * 0.50, h * 0.56
    out = ik.new_layer(w, h)

    # 躯干
    body = ik.polygon_mask((h, w), deer_path(size, cx, cy, unit), feather=unit * 0.012)
    body = ik.ink_wash(body, rng, density=1.0, blur=unit * 0.008,
                       warp_amt=unit * 0.010, granulate=0.18)
    out = ik.over(out, ik.fill((0.965, 0.975, 0.985), body))
    # 冷调暗部：下腹压一点青，不然是一张白纸剪影
    shade = np.clip(body - ik.gblur(body, unit * 0.02) * 0.6, 0, 1)
    out = ik.over(out, ik.fill(ik.SPIRIT["deep"], shade * 0.22))

    # 墨边 —— 把白身从纸上托起来
    edge = np.clip(ik.gblur(body, unit * 0.006) - ik.gblur(body, unit * 0.020), 0, 1)
    out = ik.over(out, ik.fill(ik.INK["light"], ik.norm01(edge) * 0.55))

    # 四肢 —— 起点必须**扎进躯干内部**（y 从 0.02 起，而非贴着腹线），
    # 否则腿和身体之间会留一道缝，看起来像浮在旁边的四根棍。
    for i, lx in enumerate(DEER_LEGS):
        t = np.linspace(0.0, 1.0, 18)
        x = cx + lx * unit
        pts = np.stack([x + 0.02 * unit * np.sin(t * 2.0 + i) * t,
                        cy + (0.02 + 0.29 * t) * unit], axis=1)
        leg = ik.ink_stroke((h, w), rng, pts,
                            ik.taper(18, unit * 0.034, (0.75, 0.4, 0.25)),
                            (0.905, 0.920, 0.940), alpha=0.98,
                            blur=unit * 0.004)
        out = ik.over(out, leg)
        # 腿要有一点墨边才看得见 —— 白腿踩在白身上等于没画
        lm = leg[..., 3]
        edg = np.clip(ik.gblur(lm, unit * 0.005) - ik.gblur(lm, unit * 0.014), 0, 1)
        out = ik.over(out, ik.fill(ik.INK["light"], ik.norm01(edg) * 0.5))

    out = ik.over(out, deer_tail_mist(size, rng, cx, cy, unit))
    out = ik.over(out, deer_antlers(size, rng, cx, cy, unit))

    # 眼 —— 一点焦墨，是整只兽的"神"
    eye = ik.ellipse_mask((h, w), cx + 0.305 * unit, cy - 0.245 * unit,
                          unit * 0.016, unit * 0.019, feather=unit * 0.004)
    out = ik.over(out, ik.fill(ik.INK["burnt"], eye * 0.9))
    return out


def yingyi_mist(size=(512, 512), unit=340.0, seed=701):
    """
    莹翳 · 灵雾态 —— 水墨粒子，边缘晕染虚化（§7.2）。

    保留轮廓但让它碎掉：先画实体剪影，再用噪声把边缘"打散"，
    最后叠灵炁辉光。完全丢掉轮廓就认不出是谁了。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    cx, cy = w * 0.50, h * 0.56
    out = ik.new_layer(w, h)

    body = ik.polygon_mask((h, w), deer_path(size, cx, cy, unit), feather=unit * 0.02)
    # 打散：噪声阈值切割 + 糊开。
    # 阈值不能太狠 —— 全打散就只剩一团光斑，认不出是谁了。
    n = ik.fbm(h, w, rng, octaves=5, base_cells=6)
    body = body * ik.smoothstep(n, 0.20, 0.60)
    body = ik.gblur(body, unit * 0.035)

    out = ik.over(out, ik.fill(ik.SPIRIT["deep"], body * 0.45))
    out = ik.over(out, ik.glow_layer(ik.SPIRIT["glow"], body, unit * 0.10, 0.9))
    core = ik.gblur(body, unit * 0.02)
    out = ik.over(out, ik.fill(ik.SPIRIT["core"], np.clip(core * 1.1, 0, 1) * 0.8))

    # 飘散的粒子
    for _ in range(70):
        px = cx + rng.uniform(-0.55, 0.55) * unit
        py = cy + rng.uniform(-0.42, 0.40) * unit
        r = unit * rng.uniform(0.006, 0.022)
        m = ik.ellipse_mask((h, w), px, py, r, r, feather=r)
        out = ik.over(out, ik.fill(ik.SPIRIT["core"], m * rng.uniform(0.35, 0.85)))

    out = ik.over(out, deer_antlers(size, rng, cx, cy, unit, alpha=0.55))
    return out


def yangzhuo(size=(384, 384), unit=300.0, seed=710):
    """
    阳浊 —— 实体化浊影兽。有物理躯体，青禾普攻可直接造成伤害（§4.2）。

    浓黑水墨 + 颗粒流动。形体压得低、四肢粗，跟莹翳的轻盈形成对照。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    cx, cy = w * 0.5, h * 0.58
    out = ik.new_layer(w, h)

    body = [
        (-0.34, 0.02), (-0.30, -0.10), (-0.16, -0.16), (0.04, -0.17),
        (0.20, -0.13), (0.28, -0.18), (0.36, -0.14), (0.40, -0.04),
        (0.34, 0.04), (0.24, 0.06), (0.20, 0.12), (0.02, 0.17),
        (-0.16, 0.15), (-0.30, 0.10),
    ]
    pts = [(cx + x * unit, cy + y * unit) for x, y in body]
    m = ik.polygon_mask((h, w), pts, feather=unit * 0.012)
    m = ik.ink_wash(m, rng, density=0.96, blur=unit * 0.02,
                    warp_amt=unit * 0.03, granulate=0.45, edge_darken=0.5)
    out = ik.over(out, ik.fill(ik.CORRUPT["deep"], m))

    # 颗粒流动 —— 浊湮的标志质感
    grain = ik.fbm(h, w, rng, octaves=5, base_cells=10)
    g = np.clip(m * (grain - 0.45) * 2.2, 0, 1)
    out = ik.over(out, ik.fill(ik.CORRUPT["haze"], ik.gblur(g, unit * 0.006) * 0.5))

    # 四肢（粗短）—— 同样从躯干内部起笔
    for lx in (0.22, 0.12, -0.24, -0.14):
        t = np.linspace(0, 1, 14)
        p = np.stack([cx + lx * unit + 0.02 * unit * np.sin(t * 1.6),
                      cy + (0.04 + 0.26 * t) * unit], axis=1)
        out = ik.over(out, ik.ink_stroke((h, w), rng, p,
                                         ik.taper(14, unit * 0.055, (0.8, 0.45, 0.35)),
                                         ik.CORRUPT["mid"], alpha=0.98,
                                         granulate=0.3))

    # 一对浊光眼（比灵炁暗，是"灭"的光）
    for sgn in (-1, 1):
        e = ik.ellipse_mask((h, w), cx + (0.30 + 0.02 * sgn) * unit, cy - 0.155 * unit,
                            unit * 0.020, unit * 0.014, feather=unit * 0.005)
        out = ik.over(out, ik.glow_layer((0.62, 0.30, 0.26), e, unit * 0.03, 0.7))
        out = ik.over(out, ik.fill((0.78, 0.42, 0.34), e * 0.9))
    return out


def yinzhuo(size=(384, 384), unit=300.0, seed=711):
    """
    阴浊 —— 半透明黑雾。青禾普攻完全无效，须先用莹翳灵炁显形（§4.2）。

    所以它**不能有实体轮廓**：做成团黑雾，只在中心留一点隐约的兽形。
    若画成实心怪，玩家就没有"打不动、需要显形"的视觉理由。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    cx, cy = w * 0.5, h * 0.58
    out = ik.new_layer(w, h)

    haze = ik.ellipse_mask((h, w), cx, cy, unit * 0.36, unit * 0.26, feather=unit * 0.10)
    hm = ik.fbm(h, w, rng, octaves=5, base_cells=4)
    haze = haze * ik.smoothstep(hm, 0.28, 0.78)
    haze = ik.gblur(haze, unit * 0.05)
    out = ik.over(out, ik.fill(ik.CORRUPT["mid"], haze * 0.62))
    out = ik.over(out, ik.fill(ik.CORRUPT["deep"], ik.gblur(haze, unit * 0.02) * 0.5))

    # 隐约的兽形：只有一点点比雾更深
    faint = ik.ellipse_mask((h, w), cx, cy + unit * 0.02, unit * 0.24, unit * 0.15,
                            feather=unit * 0.06)
    out = ik.over(out, ik.fill(ik.CORRUPT["deep"], faint * 0.30))

    # 飘散的颗粒
    for _ in range(60):
        px = cx + rng.uniform(-0.45, 0.45) * unit
        py = cy + rng.uniform(-0.34, 0.34) * unit
        r = unit * rng.uniform(0.005, 0.018)
        m = ik.ellipse_mask((h, w), px, py, r, r, feather=r)
        out = ik.over(out, ik.fill(ik.CORRUPT["ash"], m * rng.uniform(0.2, 0.6)))
    return out


def foxfire(size=(128, 128), seed=720):
    """狐火 —— 浊焰弹丸（#7 / #24）。无骨骼，靠引擎旋转 + 拖尾。"""
    w, h = size
    rng = np.random.default_rng(seed)
    out = ik.new_layer(w, h)
    cx, cy = w * 0.5, h * 0.5

    core = ik.ellipse_mask((h, w), cx, cy, w * 0.20, h * 0.26, feather=w * 0.05)
    out = ik.over(out, ik.glow_layer((0.72, 0.34, 0.22), core, w * 0.16, 1.0))
    out = ik.over(out, ik.fill((0.95, 0.62, 0.34), ik.gblur(core, w * 0.02) * 0.95))
    inner = ik.ellipse_mask((h, w), cx, cy + h * 0.02, w * 0.10, h * 0.13, feather=w * 0.03)
    out = ik.over(out, ik.fill((1.0, 0.90, 0.68), inner * 0.9))

    # 外焰：几缕向上飘的浊焰
    for i in range(5):
        t = np.linspace(0, 1, 20)
        ang = rng.uniform(-1.0, 1.0)
        p = np.stack([cx + np.sin(t * 3 + i * 2) * w * 0.12 + ang * w * 0.06,
                      cy + h * 0.10 - t * h * 0.34], axis=1)
        m = ik.stroke_mask((h, w), p, ik.taper(20, w * 0.07, (0.4, 0.3, 0.02)))
        m = ik.dry_brush(m, rng, 0.5, stretch=4)
        out = ik.over(out, ik.fill((0.80, 0.40, 0.24), m * 0.55))
    return out


# ------------------------------------------------------------ 入口

def build(out_dir, seed=2000):
    res = {}
    res["yingyi_entity.png"] = yingyi_entity(seed=seed)
    res["yingyi_mist.png"] = yingyi_mist(seed=seed)
    res["yangzhuo.png"] = yangzhuo(seed=seed)
    res["yinzhuo.png"] = yinzhuo(seed=seed)
    res["foxfire.png"] = foxfire(seed=seed)
    return res
