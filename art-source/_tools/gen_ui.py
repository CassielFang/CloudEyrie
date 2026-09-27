# -*- coding: utf-8 -*-
"""
UI 组件生成器 —— 对照 `docs/大赛规划v2.0` 美术资产清单 #28–31
==========================================================

风格依据 `docs/Cloud Eyrie.md` §7.3：

    极简主义，最大限度减少界面元素对氛围感的破坏；
    菜单采用石碑、卷轴意象，半透明水墨质感。

产出（`art-source/ui/`）
-----------------------
灵炁条    track / fill / tip 三件套 —— 拆开是因为填充要能按灵炁百分比横向裁切，
          若把首尾的笔锋做进 fill 里，一裁切笔锋就断了。
Boss 阶段 单段弧线的亮 / 暗两态 —— 三段由引擎摆三次，比做成一张三弧图灵活。
面板      宣纸九宫格、完整卷轴、石碑
按钮      石碑三态（常态 / 悬停 / 按下）
图标      三形态（实体 / 灵雾 / 灵合）
提示      操作提示的水墨底框
"""

import numpy as np

import inkwash as ik
import gen_char


# ------------------------------------------------------------ 路径工具

def rounded_rect_path(x0, y0, x1, y1, radius, samples_per_edge=120):
    """
    圆角矩形的轮廓采样点（闭合环，首尾相连）。

    不做圆角的话，四角会和整幅画的「柔」冲突 —— 直角是工业感的来源。

    四角的**排列顺序必须跟圆弧角度区间一致**，否则四点各自孤立、连不成环，
    画出来就是角上四段散笔画。角度扫过 0→90→180→270→360 对应：
        右下(0→90) → 左下(90→180) → 左上(180→270) → 右上(270→360)
    """
    r = max(0.0, float(radius))
    cx = [x1 - r, x0 + r, x0 + r, x1 - r]
    cy = [y1 - r, y1 - r, y0 + r, y0 + r]
    pts = []
    for i in range(4):
        a = np.linspace(i * np.pi / 2, (i + 1) * np.pi / 2,
                        max(2, samples_per_edge // 4))
        pts.append(np.stack([cx[i] + r * np.cos(a), cy[i] + r * np.sin(a)], axis=1))
    return np.concatenate(pts, axis=0)


def ink_frame(shape, rng, rect, width=3.0, color=None, alpha=0.9,
              radius=24, dry=0.35, glow=0.0):
    """
    水墨边框 —— 一笔勾出的圆角矩形。

    `glow` > 0 时在框外再加一层很淡的洇墨，模拟墨在纸上的晕开。
    """
    h, w = shape
    color = color if color is not None else ik.INK["medium"]
    x0, y0, x1, y1 = rect
    pts = rounded_rect_path(x0, y0, x1, y1, radius)
    # 闭合：首尾相接，笔宽沿周长轻微起伏（同一个人写的一圈字，不会每处一样粗）
    pts = np.concatenate([pts, pts[:1]], axis=0)
    n = len(pts)
    wid = np.full(n, float(width), np.float32)
    wid *= 0.75 + 0.5 * ik.fbm(1, n, rng, octaves=4, base_cells=6)[0]

    out = ik.new_layer(w, h)
    if glow > 0:
        m = ik.stroke_mask((h, w), pts, wid * 4.0)
        out = ik.over(out, ik.glow_layer(color, m, glow, 0.5))
    # 边框是成环的，没有单一走向 —— 飞白必须用各向同性，
    # 用横向丝会把左右两条竖边剁断
    out = ik.over(out, ik.ink_stroke((h, w), rng, pts, wid, color,
                                     alpha=alpha, dry=dry, dry_direction="iso",
                                     blur=1.0, granulate=0.3, edge_darken=0.25))
    return out


# ------------------------------------------------------------ 灵炁条

def spirit_bar(track_size=(2048, 192), fill_size=(2048, 192), tip_size=(128, 192),
               seed=101):
    """
    灵炁条三件套。

    `track` 槽底：一道淡墨横笔 + 两端小竖笔收口。
    `fill`  填充：垂直渐变的青碧，**沿 X 方向均匀** —— 这样引擎按百分比裁切
            左边任意长度都成立。首尾笔锋另出 `tip`。
    `tip`   笔锋：填充前端的亮点，跟着百分比跑。
    """
    out = {}

    # ---- 槽底
    w, h = track_size
    rng = np.random.default_rng(seed)
    lay = ik.new_layer(w, h)
    cy = h * 0.55
    n = 400
    t = np.linspace(0.0, 1.0, n)
    xs = 40 + t * (w - 80)
    # 横笔微微起伏 —— 完全水平会像 UI 控件，不像画的
    ys = cy + 3.0 * np.sin(t * np.pi * 2.2) + 1.5 * np.sin(t * np.pi * 5.0)
    pts = np.stack([xs, ys], axis=1)
    wid = ik.taper(n, h * 0.22, profile=(0.12, 0.5, 0.12))
    lay = ik.over(lay, ik.ink_stroke((h, w), rng, pts, wid, ik.INK["medium"],
                                     alpha=0.8, dry=0.25, blur=1.6, granulate=0.35))
    # 两端收口
    for ex in (52.0, w - 52.0):
        p = np.stack([np.full(24, ex), np.linspace(cy - h * 0.14, cy + h * 0.14, 24)], axis=1)
        lay = ik.over(lay, ik.ink_stroke((h, w), rng, p, ik.taper(24, 6.0, (0.1, 0.5, 0.1)),
                                         ik.INK["medium"], alpha=0.75, dry=0.25, blur=0.8))
    out["spirit_bar_track.png"] = lay

    # ---- 填充（X 向均匀）
    w, h = fill_size
    rng = np.random.default_rng(seed + 1)
    yy = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    # 上缘偏亮、下缘沉 —— 一道有厚度的光，不是一个色块
    top = np.asarray(ik.SPIRIT["core"], np.float32)
    mid = np.asarray(ik.SPIRIT["glow"], np.float32)
    bot = np.asarray(ik.SPIRIT["deep"], np.float32)
    up = ik.smoothstep(yy, 0.0, 0.45)[..., None]      # (h, 1, 1)
    dn = ik.smoothstep(yy, 0.45, 1.0)[..., None]
    col = top.reshape(1, 1, 3) * (1 - up) + mid.reshape(1, 1, 3) * up
    col = col * (1 - dn) + bot.reshape(1, 1, 3) * dn
    col = np.repeat(col, w, axis=1)                    # (h, w, 3)
    # 极轻的横向起伏（幅度压到 3%，裁切处看不出接缝）
    wob = 1.0 + 0.03 * (ik.fbm(h, w, rng, octaves=3, base_cells=2) - 0.5) * 2.0
    alpha = np.ones((h, w), np.float32)
    # 上下边缘软收，避免硬边
    alpha *= ik.smoothstep(yy, 0.0, 0.18) * (1.0 - ik.smoothstep(yy, 0.82, 1.0))
    lay = np.concatenate([np.clip(col * wob[..., None], 0, 1), alpha[..., None]], axis=2)
    # 内辉光：让填充看起来在发光，而不是一块漆
    g = ik.gblur(alpha, h * 0.10)
    lay = ik.over(lay, ik.fill(ik.SPIRIT["core"], g * 0.25))
    out["spirit_bar_fill.png"] = lay

    # ---- 笔锋
    w, h = tip_size
    rng = np.random.default_rng(seed + 2)
    lay = ik.new_layer(w, h)
    m = ik.ellipse_mask((h, w), w * 0.5, h * 0.5, w * 0.16, h * 0.40, feather=w * 0.06)
    lay = ik.over(lay, ik.glow_layer(ik.SPIRIT["glow"], m, w * 0.22, 0.9))
    lay = ik.over(lay, ik.fill(ik.SPIRIT["core"], ik.gblur(m, w * 0.02) * 0.85))
    out["spirit_bar_tip.png"] = lay

    return out


# ------------------------------------------------------------ Boss 阶段指示器

def phase_arc(size=(256, 256), lit=True, seed=202):
    """
    单段阶段弧线 —— 环绕 Boss 头顶。三段由引擎摆三次。

    弧线开口朝下（缺口留在正下方），三段拼起来是一圈；这样「还剩几段」一眼可数。
    """
    w, h = size
    rng = np.random.default_rng(seed + (0 if lit else 77))
    lay = ik.new_layer(w, h)

    r = min(w, h) * 0.36
    cx, cy = w * 0.5, h * 0.5
    a = np.linspace(np.deg2rad(-160), np.deg2rad(-20), 90)
    pts = np.stack([cx + r * np.cos(a), cy + r * np.sin(a)], axis=1)

    color = ik.SPIRIT["glow"] if lit else ik.INK["medium"]
    wid = ik.taper(len(a), min(w, h) * 0.055, profile=(0.25, 0.5, 0.25))
    if lit:
        lay = ik.over(lay, ik.glow_layer(ik.SPIRIT["glow"],
                                         ik.stroke_mask((h, w), pts, wid * 3.0),
                                         min(w, h) * 0.06, 1.0))
    lay = ik.over(lay, ik.ink_stroke((h, w), rng, pts, wid, color,
                                     alpha=0.95 if lit else 0.6,
                                     dry=0.3, blur=0.8, granulate=0.2))
    return lay


# ------------------------------------------------------------ 面板 / 卷轴 / 石碑

def panel_paper(size=(1024, 1024), seed=303):
    """
    宣纸九宫格面板 —— 半透明水墨质感。

    九宫格要求四条边沿拉伸方向**尽量均匀**，所以边框走一圈等宽笔，不加大幅度的
    飞白（飞白被拉长会变成条纹）。切图边距见 README。
    """
    w, h = size
    rng = np.random.default_rng(seed)
    lay = ik.new_layer(w, h)
    m = max(24, int(min(w, h) * 0.06))

    # 纸面：很淡的一层暖白，半透明
    body = ik.polygon_mask((h, w), [(m, m), (w - m, m), (w - m, h - m), (m, h - m)],
                           feather=m * 0.8)
    body = ik.ink_wash(body, rng, density=0.82, blur=m * 0.25, granulate=0.22)
    lay = ik.over(lay, ik.fill(ik.PAPER["xuan"], body))
    # 边缘积墨，把纸"压"在画面上
    edge = ik.polygon_mask((h, w), [(m, m), (w - m, m), (w - m, h - m), (m, h - m)],
                           feather=m * 1.2) - body
    lay = ik.over(lay, ik.fill(ik.PAPER["shadow"], np.clip(edge, 0, 1) * 0.35))

    # 九宫格面板的边框会被引擎沿轴向拉伸，飞白一旦被拉长就成条纹 ——
    # 这层不用 dry，质感交给 ink_wash 的颗粒
    lay = ik.over(lay, ink_frame((h, w), rng, (m, m, w - m, h - m),
                                 width=max(4.0, m * 0.20), color=ik.INK["medium"],
                                 alpha=0.9, radius=m * 0.7, dry=0.0))
    lay = ik.over(lay, ik.stain(lay * 0, rng, "aged", amount=0.12, count=10,
                                scale=(0.05, 0.18)))
    return lay


def panel_scroll(size=(1024, 640), seed=304):
    """完整卷轴 —— 定尺，不做九宫格（两端的轴拉长就成擀面杖了）。"""
    w, h = size
    rng = np.random.default_rng(seed)
    lay = ik.new_layer(w, h)
    ax = int(w * 0.055)          # 轴的宽度
    m = int(h * 0.10)

    # 纸body
    body = ik.polygon_mask((h, w), [(ax, m), (w - ax, m), (w - ax, h - m), (ax, h - m)],
                           feather=10)
    body = ik.ink_wash(body, rng, density=0.88, blur=4, granulate=0.20)
    lay = ik.over(lay, ik.fill(ik.PAPER["xuan"], body))

    # 上下留白边的细横线（卷轴的"天地"）
    for yy in (h * 0.20, h * 0.80):
        p = np.stack([np.linspace(ax + 20, w - ax - 20, 60), np.full(60, yy)], axis=1)
        lay = ik.over(lay, ik.ink_stroke((h, w), rng, p,
                                         np.full(60, 2.4, np.float32), ik.INK["light"],
                                         alpha=0.5, dry=0.5))

    # 两端木轴
    for i, x in enumerate((ax * 0.5, w - ax * 0.5)):
        m2 = ik.ellipse_mask((h, w), x, h * 0.5, ax * 0.42, h * 0.5 - 2, feather=6)
        m2 = ik.ink_wash(m2, rng, density=0.95, blur=3, granulate=0.35)
        lay = ik.over(lay, ik.fill((0.35, 0.28, 0.22), m2))
        # 轴头
        m3 = ik.ellipse_mask((h, w), x, h * 0.5, ax * 0.52, h * 0.10, feather=4)
        lay = ik.over(lay, ik.fill((0.24, 0.19, 0.15), m3 * 0.9))

    lay = ik.over(lay, ik.stain(lay * 0, rng, "aged", amount=0.14, count=12,
                                scale=(0.06, 0.22)))
    return lay


def panel_stele(size=(768, 1024), seed=305):
    """石碑 —— 上圆下方的碑身 + 碑座。"""
    w, h = size
    rng = np.random.default_rng(seed)
    lay = ik.new_layer(w, h)
    cxm = w * 0.5
    top, bot = h * 0.06, h * 0.84

    # 碑身：上半圆 + 直边
    pts = []
    r = w * 0.36
    a = np.linspace(np.pi, 0.0, 70)
    pts += [(cxm + r * np.cos(t), top + r + r * np.sin(t) * -1.0) for t in a]
    pts += [(cxm + r, h * 0.62), (cxm + r * 0.96, bot), (cxm - r * 0.96, bot),
            (cxm - r, h * 0.62)]
    body = ik.polygon_mask((h, w), pts, feather=8)
    body = ik.ink_wash(body, rng, density=0.90, blur=5, warp_amt=3, granulate=0.42,
                       edge_darken=0.35)
    lay = ik.over(lay, ik.fill((0.51, 0.53, 0.51), body))

    # 碑面刻痕：几道横竖细线，让它读起来是"有字的碑"而非一块石头
    for i in range(7):
        y = top + r * 1.6 + i * (bot - top) * 0.078
        ww = r * rng.uniform(0.35, 0.80)
        p = np.stack([np.linspace(cxm - ww, cxm + ww, 40), np.full(40, y)], axis=1)
        lay = ik.over(lay, ik.ink_stroke((h, w), rng, p,
                                         np.full(40, 3.0, np.float32), ik.INK["medium"],
                                         alpha=0.35, dry=0.6, blur=1.0))

    # 碑座
    base = ik.polygon_mask((h, w), [(w * 0.14, bot), (w * 0.86, bot),
                                    (w * 0.92, h * 0.95), (w * 0.08, h * 0.95)], feather=6)
    base = ik.ink_wash(base, rng, density=0.95, blur=4, granulate=0.40)
    lay = ik.over(lay, ik.fill((0.42, 0.44, 0.43), base))

    lay = ik.over(lay, ink_frame((h, w), rng, (cxm - r * 0.86, top + r * 0.5,
                                               cxm + r * 0.86, bot - 20),
                                 width=3.0, color=ik.INK["medium"],
                                 alpha=0.45, radius=r * 0.5, dry=0.3))
    return lay


def stele_button(size=(512, 192), state="normal", seed=306):
    """
    石碑按钮三态。

    三态只在**明度与灵光**上做区别，形状完全一致 —— 形状一变，鼠标移上去会"跳"。
    """
    w, h = size
    rng = np.random.default_rng(seed + {"normal": 0, "hover": 1, "pressed": 2}[state])
    lay = ik.new_layer(w, h)
    m = 16

    body = ik.polygon_mask((h, w), [(m, m), (w - m, m), (w - m, h - m), (m, h - m)],
                           feather=8)
    tone = {"normal": (0.55, 0.57, 0.55), "hover": (0.63, 0.66, 0.63),
            "pressed": (0.44, 0.46, 0.45)}[state]
    body_w = ik.ink_wash(body, rng, density=0.92, blur=3, granulate=0.40,
                         edge_darken=0.4)
    lay = ik.over(lay, ik.fill(tone, body_w))

    if state == "hover":
        # 悬停：碑面浮起一层灵光
        lay = ik.over(lay, ik.glow_layer(ik.SPIRIT["glow"], body, 22, 0.55))
    if state == "pressed":
        # 按下：整体压暗一档
        lay = ik.over(lay, ik.fill(ik.INK["burnt"], body * 0.18))

    lay = ik.over(lay, ink_frame((h, w), rng, (m, m, w - m, h - m),
                                 width=5.0, color=ik.INK["medium"],
                                 alpha=0.8, radius=10, dry=0.2))
    return lay


# ------------------------------------------------------------ 图标

def form_icon(kind, size=(256, 256), seed=400):
    """
    三形态图标 —— 极简水墨符号，不写实。

    实体：莹翳的侧影（有角）
    灵雾：三道流动的雾纹
    灵合：两个交缠的旋（人与兽合一）
    """
    w, h = size
    rng = np.random.default_rng(seed + {"entity": 0, "mist": 1, "merge": 2}[kind])
    lay = ik.new_layer(w, h)
    cx, cy, s = w * 0.5, h * 0.5, min(w, h)

    if kind == "entity":
        # 用莹翳的正式轮廓 —— 图标与 sprite 必须是同一只兽
        unit = s * 0.62
        dcy = cy + s * 0.10
        body = ik.polygon_mask((h, w), gen_char.deer_path((h, w), cx, dcy, unit),
                               feather=unit * 0.02)
        lay = ik.over(lay, ik.fill((0.97, 0.98, 0.99), body))
        edge = np.clip(ik.gblur(body, unit * 0.012) - ik.gblur(body, unit * 0.045), 0, 1)
        lay = ik.over(lay, ik.fill(ik.INK["light"], ik.norm01(edge) * 0.6))
        # 四肢 —— 起点扎进躯干（同 gen_char），否则图标上的腿也是浮着的
        for i, lx in enumerate(gen_char.DEER_LEGS):
            t = np.linspace(0, 1, 12)
            p = np.stack([np.full(12, cx + lx * unit),
                          dcy + (0.02 + 0.29 * t) * unit], axis=1)
            lay = ik.over(lay, ik.ink_stroke((h, w), rng, p,
                                             ik.taper(12, unit * 0.05, (0.75, 0.4, 0.25)),
                                             (0.94, 0.95, 0.96), alpha=0.95))
        lay = ik.over(lay, gen_char.deer_tail_mist((h, w), rng, cx, dcy, unit, count=3))
        lay = ik.over(lay, gen_char.deer_antlers((h, w), rng, cx, dcy, unit))

    elif kind == "mist":
        for i in range(3):
            t = np.linspace(0, 1, 70)
            p = np.stack([cx - s * 0.30 + t * s * 0.60,
                          cy + (i - 1) * s * 0.12 + np.sin(t * 4.0 + i * 1.3) * s * 0.05],
                         axis=1)
            m = ik.stroke_mask((h, w), p, ik.taper(70, s * 0.055, (0.05, 0.5, 0.05)))
            m = ik.dry_brush(m, rng, 0.45, stretch=7)
            lay = ik.over(lay, ik.glow_layer(ik.SPIRIT["glow"], m, s * 0.05, 0.5))
            lay = ik.over(lay, ik.fill(ik.SPIRIT["core"], m * 0.8))

    else:  # merge
        for i, sgn in enumerate((1, -1)):
            t = np.linspace(0, np.pi * 1.6, 80)
            r = s * 0.24 * (1 - t / (np.pi * 2.2))
            c = np.stack([cx + s * 0.10 * sgn + r * np.cos(t * sgn),
                          cy + r * np.sin(t * sgn)], axis=1)
            m = ik.stroke_mask((h, w), c, ik.taper(80, s * 0.05, (0.1, 0.45, 0.05)))
            lay = ik.over(lay, ik.glow_layer(ik.SPIRIT["merge"], m, s * 0.06, 0.6))
            lay = ik.over(lay, ik.fill(ik.SPIRIT["merge"], m * 0.85))
        core = ik.ellipse_mask((h, w), cx, cy, s * 0.06, s * 0.06, feather=s * 0.03)
        lay = ik.over(lay, ik.fill(ik.SPIRIT["core"], core))

    return lay


def prompt_frame(size=(640, 160), seed=500):
    """操作提示的水墨底框 —— 教学提示浮现 3 秒后淡出（规划 #30）。"""
    w, h = size
    rng = np.random.default_rng(seed)
    lay = ik.new_layer(w, h)
    # 一笔横过底部的淡墨，托住文字
    t = np.linspace(0, 1, 200)
    p = np.stack([40 + t * (w - 80), h * 0.78 + 2.5 * np.sin(t * np.pi * 1.5)], axis=1)
    lay = ik.over(lay, ik.ink_stroke((h, w), rng, p, ik.taper(200, h * 0.10, (0.05, 0.5, 0.05)),
                                     ik.INK["light"], alpha=0.4, dry=0.45, blur=2.0))
    return lay


# ------------------------------------------------------------ 入口

def build(out_dir, seed=1000):
    """生成全部 UI 组件，返回 {文件名: 图层}。"""
    res = {}
    res.update(spirit_bar(seed=seed))
    res["phase_arc_lit.png"] = phase_arc(lit=True, seed=seed)
    res["phase_arc_dim.png"] = phase_arc(lit=False, seed=seed)
    res["panel_paper.png"] = panel_paper(seed=seed)
    res["panel_scroll.png"] = panel_scroll(seed=seed)
    res["panel_stele.png"] = panel_stele(seed=seed)
    for st in ("normal", "hover", "pressed"):
        s = "" if st == "normal" else f"_{st}"
        res[f"btn_stele{s}.png"] = stele_button(state=st, seed=seed)
    for k in ("entity", "mist", "merge"):
        res[f"icon_form_{k}.png"] = form_icon(k, seed=seed)
    res["prompt_frame.png"] = prompt_frame(seed=seed)
    return res
