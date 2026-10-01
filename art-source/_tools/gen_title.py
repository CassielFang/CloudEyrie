# -*- coding: utf-8 -*-
"""
首页素材生成器 —— 供 `assets/Scene/Title.scene` 使用
===================================================

风格依据 `docs/Cloud Eyrie.md` §7.3：

    极简主义，最大限度减少界面元素对氛围感的破坏；
    菜单采用石碑、卷轴意象，半透明水墨质感。

产出
----
title_scroll.png    长卷中段 —— 从美术组给的 `assets/Textures/scroll.png` 裁出
title_vignette.png  径向暗角 —— 压四边，把视线收到画面中央
title_glow.png      径向柔光 —— 一图三用：标题辉光 / 选中项辉光 / 灵炁光点

为什么长卷只取中段
------------------
原图 4000×1000（4:1）是横向长卷，直接铺进 16:9 的屏幕要么拉变形、要么上下露边。
中段 2200×1000（2.2:1）这一段正好框住中央的蓝色灵脉瀑布和两侧浮空岛，构图最完整；
左右各留 211px 余量，超宽屏（21:9）用 cover 缩放也能铺满。

为什么暮色压暗不在这里做
------------------------
压暗是在引擎里给 `Sprite.color` **乘**一个深青靛蓝实现的，不是烘进贴图。
乘算保留笔触和明暗层次（纸白底变暮蓝、墨线山峦按比例压暗），比叠一层半透明
黑蒙层通透得多 —— 后者会把画面压平。放在引擎里做，调色也不必重新跑生成器。

用法::

    python gen_art.py --only title
"""

import os

import numpy as np

import inkwash as ik

# 引擎里要用 cover 缩放铺满，这张图宽高比决定了超宽屏的余量。
# 改这个值必须同步改 TitleScreen.ts 里的 COVER_W / COVER_H。
CROP_W = 2200

# 长卷原图在仓库里的位置（美术组交付件，不是本生成器的产物）
SCROLL_SRC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "assets", "Textures", "scroll.png")

# 暗角色：花青再压暗一档，比纯黑偏蓝，和青绿山水同色系
VIGNETTE_INK = (0.039, 0.078, 0.125)

# 暗角最大不透明度。再高就把山峦压没了 —— 首页整体偏暗时最先该动这个值
VIGNETTE_MAX = 0.60

# 柔光最大不透明度
GLOW_MAX = 0.88


def title_scroll(src=SCROLL_SRC, width=CROP_W):
    """
    从长卷原图居中裁一条。

    用 left/right 两条余量而不是直接把原图缩到屏幕宽 —— 缩放会让纸纹变糊，
    而且超宽屏上没得裁、只能拉伸。
    """
    import numpy as np
    from PIL import Image

    if not os.path.exists(src):
        raise FileNotFoundError(
            f"找不到长卷原图：{src}\n"
            "它由美术组交付，不在生成器的产物里；缺了这张图首页背景就没法出。")

    im = Image.open(src).convert("RGB")
    w, h = im.size
    if width > w:
        raise ValueError(f"裁切宽度 {width} 超过原图宽度 {w}")

    x0 = (w - width) // 2
    crop = im.crop((x0, 0, x0 + width, h))
    layer = np.zeros((h, width, 4), np.float32)
    layer[..., :3] = np.asarray(crop, np.float32) / 255.0
    layer[..., 3] = 1.0
    return layer


def _radial(h, w, normalize_to):
    """
    归一化椭圆半径场。

    返回 (h, w) 数组：中心 0，沿 `normalize_to` 指定的方向到 1。
    用椭圆而不是正圆 —— 贴图会被拉伸到 16:9，正圆会被拉成椭圆，
    不如一开始就按屏幕比例算，让渐变落在该落的地方。
    """
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = (xx - (w - 1) * 0.5) / max(1.0, (w - 1) * 0.5)
    ny = (yy - (h - 1) * 0.5) / max(1.0, (h - 1) * 0.5)
    r = np.sqrt(nx * nx + ny * ny)
    return r / normalize_to


def title_vignette(size=512):
    """
    径向暗角：中心全透，四边压暗。

    归一化用 sqrt(2)（对角线到 1），所以四角最暗、四边中点约一半 —— 这正是
    暗角该有的形状。若按四边中点归一，四角就会先到 1 再被裁平，暗角变成方块。
    """
    h = w = int(size)
    r = _radial(h, w, np.sqrt(2.0))

    # 0.30 以内完全不压，保证中央的灵脉瀑布和标题区亮度不受影响
    alpha = VIGNETTE_MAX * ik.smoothstep(r, 0.30, 1.05)
    return ik.fill(VIGNETTE_INK, alpha.astype(np.float32))


def title_glow(size=256):
    """
    径向柔光，白色 —— 引擎里按需染色。

    走高斯衰减而不是线性：线性衰减的边缘一圈能看出明显的"边"，
    高斯到位图边缘时已经接近 0，叠在画面里看不出接缝。

    白而不带色是有意的：标题要月白、选中项要青碧、灵炁光点要更亮，
    三处色相不同，染色交给引擎省得生成三张。
    """
    h = w = int(size)
    r = _radial(h, w, 1.0)

    alpha = GLOW_MAX * np.exp(-np.square(r * 2.6))
    return ik.fill((1.0, 1.0, 1.0), alpha.astype(np.float32))


def title_panel(size=(590, 360), fade_x=45, fade_y=25):
    """
    面板的柔边底衬 —— 一块四边晕开的实心矩形（纯白 + alpha，颜色交给引擎染）。

    为什么要单独出一张：菜单面板贴图 `panel_paper.png` 的纸面本身是**半透明**的
    （GDD 要的「半透明水墨质感」），直接铺在暮色山水上，背后山峦会透上来把深墨字
    压得看不清；但要是拿 `Graphics` 垫一块实心矩形，边缘是硬的，跟整幅水墨画的气质
    冲突。这张图两头兼顾 —— 中间够实、四边晕开。

    为什么横纵的晕开宽度要分开
    --------------------------
    贴图会被拉到「比纸面大一圈」，横纵多出来的边距不一样（屏幕只有 720 高，
    纵向留不出那么多），而**晕开的宽度必须正好铺满那一圈**：宽了会在纸面底下就
    淡没了（纸面边缘露底），窄了会在纸面外留下一圈硬边。
    一开始用高斯模糊做各向同性的晕开，横纵比例对不上，结果就是左右虚、上下发死。
    现在改成横纵两条独立的 smoothstep 斜坡相乘——各向异性是直接写出来的，不用再凑。

    改这里要和 `TitleSubPanels.ts` 的 `BACKING_PAD_X` / `BACKING_PAD_Y` 配着调：
    贴图的 fade 换算过去应该正好等于那两个 pad。
    """
    w, h = size
    alpha = _ramp(w, fade_x)[None, :] * _ramp(h, fade_y)[:, None]
    return ik.fill((1.0, 1.0, 1.0), alpha.astype(np.float32))


def _ramp(n, fade):
    """一条 0 → 1 的边缘斜坡：两端各 `fade` 像素内用 smoothstep 过渡，中间恒为 1。"""
    x = np.arange(n, dtype=np.float32)
    f = max(1.0, float(fade))
    t = np.minimum(x / f, (n - 1 - x) / f)
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def build(out_dir, seed=5000):
    """生成全部首页素材，返回 {文件名: 图层}。seed 对这三个都是解析式的，用不上。"""
    return {
        "title_scroll.png": title_scroll(),
        "title_vignette.png": title_vignette(),
        "title_glow.png": title_glow(),
        "title_panel.png": title_panel(),
    }
