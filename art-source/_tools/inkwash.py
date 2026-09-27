# -*- coding: utf-8 -*-
"""
水墨淡彩绘制核心库 —— 《云岫》美术基调
======================================

风格依据 `docs/Cloud Eyrie.md` §7.1：

    宋韵青绿山水 + 水墨淡彩晕染；画面通透柔和。

本模块只提供「画材」——笔、墨、色、纸，不含任何具体资产。
具体资产由分册生成器调用：`gen_ui` / `gen_scene` / `gen_fx` / `gen_char`。

数据约定
--------
一律用 numpy float32 数组：

    遮盖度 / 墨量   0.0 ~ 1.0     （0 = 全透，1 = 全遮），形状 (h, w)
    图像层          RGBA，形状 (h, w, 4)，**straight alpha**（非预乘）
    颜色            RGB float32，0.0 ~ 1.0

不要传 uint8，也不要用预乘 alpha —— `over()` 按 straight alpha 合成。

随机性
------
所有随机都走显式传入的 `rng`（`np.random.Generator`）。
**同一 seed 必然复现同一张图**：调参时改参数或换 seed，不要靠重跑碰运气。

坐标
----
数组索引即像素，`arr[y, x]`，原点在左上。与 PIL 一致。
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

# ============================================================ 调色板
#
# 取自传统「墨分五色」与青绿山水的矿物颜料名，方便美术组对色。

# 墨 —— 焦 / 重 / 浓 / 淡 / 清 五阶
INK = {
    "burnt":  (0.078, 0.078, 0.071),   # 焦墨：最重的点景、题款
    "heavy":  (0.157, 0.157, 0.145),   # 重墨：近景树干、轮廓
    "medium": (0.322, 0.325, 0.306),   # 浓墨：中景主体
    "light":  (0.545, 0.549, 0.522),   # 淡墨：远景山峦
    "pale":   (0.741, 0.745, 0.722),   # 清墨：最远的雾外山影
}

# 青绿 —— 矿物色，山水的主色相
MINERAL = {
    "azurite":    (0.294, 0.463, 0.545),   # 石青
    "azurite_lt": (0.478, 0.639, 0.694),   # 轻石青
    "malachite":  (0.400, 0.553, 0.435),   # 石绿
    "malachite_lt": (0.573, 0.702, 0.573), # 轻石绿
    "indigo":     (0.235, 0.325, 0.420),   # 花青
    "ochre":      (0.663, 0.463, 0.318),   # 赭石：山脚、土坡
}

# 宣纸 / 绢
PAPER = {
    "xuan":   (0.949, 0.933, 0.894),   # 生宣
    "silk":   (0.925, 0.914, 0.878),   # 绢本
    "aged":   (0.878, 0.855, 0.800),   # 旧纸
    "shadow": (0.784, 0.769, 0.722),   # 纸的暗部
}

# 灵炁 —— 要「清亮」，与浊湮的浓黑形成 GDD §7.2 要求的强对比
SPIRIT = {
    "core":  (0.847, 0.972, 0.949),    # 核心近白青
    "glow":  (0.529, 0.851, 0.804),    # 辉光青碧
    "jade":  (0.612, 0.867, 0.741),    # 玉色
    "deep":  (0.310, 0.643, 0.612),    # 灵炁暗部
    "merge": (0.933, 0.812, 0.510),    # 灵合暖金
    "merge_deep": (0.804, 0.596, 0.286),
}

# 浊湮 —— 浓黑水墨 + 颗粒流动感
CORRUPT = {
    "deep": (0.055, 0.051, 0.063),
    "mid":  (0.145, 0.133, 0.161),
    "haze": (0.239, 0.224, 0.259),
    "ash":  (0.376, 0.361, 0.400),
}


# ============================================================ 基础工具

def smoothstep(x, lo=0.0, hi=1.0):
    """标准 smoothstep，把 [lo, hi] 平滑映射到 [0, 1]。"""
    t = np.clip((x - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def norm01(a):
    """线性拉伸到 [0, 1]；全平输入返回全 0。"""
    a = np.asarray(a, np.float32)
    lo, hi = float(a.min()), float(a.max())
    if hi - lo < 1e-6:
        return np.zeros_like(a)
    return (a - lo) / (hi - lo)


def gblur(arr, radius):
    """
    对 (h, w) 或 (h, w, 4) 的 float32 数组做高斯模糊。

    走 scipy 而不是 PIL：PIL 的 `GaussianBlur` 不接受 'F' 模式，而 4 通道 float
    根本没有对应的 PIL 模式。
    """
    if radius <= 0:
        return arr.astype(np.float32, copy=False)
    sigma = float(radius)
    if arr.ndim == 3:
        return ndimage.gaussian_filter(arr, sigma=(sigma, sigma, 0)).astype(np.float32)
    return ndimage.gaussian_filter(arr, sigma=sigma).astype(np.float32)


def _resize(arr, size, resample=Image.BICUBIC):
    return np.asarray(Image.fromarray(arr.astype(np.float32)).resize(size, resample), np.float32)


def resize(arr, size, resample=Image.BICUBIC):
    """缩放 float32 数组到 `size` = (宽, 高)。"""
    return _resize(arr, size, resample)


# ============================================================ 噪声
#
# 全部走「随机相位、整数频率的正弦叠加」——这样天生横向/纵向可平铺，
# 视差层要求左右无缝，用普通 value noise 会在接缝处露馅。

def fbm(h, w, rng, octaves=5, base_cells=2, gain=0.5, lacunarity=2.0):
    """分形布朗噪声，值域约 [0, 1]，**可平铺**。"""
    total = np.zeros((h, w), np.float32)
    amp, norm, cells = 1.0, 0.0, float(base_cells)
    for _ in range(octaves):
        total += amp * value_noise(h, w, int(round(cells)), rng)
        norm += amp
        amp *= gain
        cells *= lacunarity
    return total / max(norm, 1e-6)


def value_noise(h, w, cells, rng):
    """单层可平铺 value noise：生成 (cells+1)² 网格并令首尾相等，再双三次放大。"""
    cells = max(1, int(cells))
    g = rng.random((cells + 1, cells + 1)).astype(np.float32)
    g[-1, :] = g[0, :]          # 纵向缝合
    g[:, -1] = g[:, 0]          # 横向缝合
    return _resize(g, (w, h), Image.BICUBIC)


def ridged_fbm(h, w, rng, octaves=6, base_cells=2, gain=0.55, lacunarity=2.0):
    """
    脊状分形噪声 —— 山脊线用。

    每层取 `1 - |noise|`，把噪声的零交叉点变成尖脊，比普通 fbm 更像山。
    值域 [0, 1]。
    """
    total = np.zeros((h, w), np.float32)
    amp, norm, cells = 1.0, 0.0, float(base_cells)
    for _ in range(octaves):
        n = value_noise(h, w, int(round(cells)), rng) * 2.0 - 1.0
        total += amp * (1.0 - np.abs(n))
        norm += amp
        amp *= gain
        cells *= lacunarity
    return total / max(norm, 1e-6)


def ridged_1d(w, rng, octaves=7, base=2, roughness=0.55):
    """
    一维分形山脊线 —— 山峦轮廓。

    返回长度 w 的数组，值域 [0, 1]（0 = 谷底，1 = 峰顶）。横向可平铺。
    """
    xs = np.arange(w, dtype=np.float32) / np.float32(w)
    # 频率取整数 → 一个周期正好铺满 w → 天然无缝
    y = np.zeros(w, np.float32)
    amp, norm, k = 1.0, 0.0, float(base)
    for _ in range(octaves):
        ki = max(1, int(round(k)))
        ph = rng.random() * 2.0 * np.pi
        n = np.sin(2.0 * np.pi * ki * xs + ph)
        # 叠一个二次谐波，让脊线不那么"正弦味"
        n = 0.75 * n + 0.25 * np.sin(2.0 * np.pi * ki * 2 * xs + ph * 1.7)
        y += amp * (1.0 - np.abs(n))          # ridged：|n| 的谷变成尖脊
        norm += amp
        amp *= roughness
        k *= 2.0
    return norm01(y / max(norm, 1e-6))


def peaks_1d(w, rng, count=5, width=(0.03, 0.12), height=(0.35, 1.0)):
    """在 1D 轮廓上叠若干高斯峰 —— 让山峦有明确的主峰，而不是一团匀称的波浪。"""
    xs = np.arange(w, dtype=np.float32) / np.float32(w)
    y = np.zeros(w, np.float32)
    for _ in range(count):
        cx = rng.random()
        sw = rng.uniform(*width)
        hh = rng.uniform(*height)
        d = np.abs(xs - cx)
        d = np.minimum(d, 1.0 - d)            # 环绕距离，保持可平铺
        y += hh * np.exp(-(d / sw) ** 2)
    return y


# ============================================================ 图层

def new_layer(w, h):
    """全透明 RGBA 图层。"""
    return np.zeros((h, w, 4), np.float32)


def fill(color, alpha, shape=None):
    """
    由「单色 + 遮盖度图」造一层 RGBA。

    `alpha` 可以是标量，也可以是 (h, w) 数组；给了数组时 `shape` 可省。
    """
    alpha = np.asarray(alpha, np.float32)
    if alpha.ndim == 0:
        if shape is None:
            raise ValueError("alpha 为标量时必须给 shape")
        alpha = np.full(shape, float(alpha), np.float32)
    h, w = alpha.shape
    rgb = np.asarray(color, np.float32).reshape(1, 1, 3)
    out = np.empty((h, w, 4), np.float32)
    out[..., :3] = rgb
    out[..., 3] = np.clip(alpha, 0.0, 1.0)
    return out


def over(dst, src):
    """src 叠在 dst 之上（straight alpha），返回新层，不改原数组。"""
    sa, da = src[..., 3:4], dst[..., 3:4]
    oa = sa + da * (1.0 - sa)
    num = src[..., :3] * sa + dst[..., :3] * da * (1.0 - sa)
    rgb = np.where(oa > 1e-6, num / np.maximum(oa, 1e-6), 0.0)
    return np.concatenate([rgb, oa], axis=-1).astype(np.float32)


def over_region(dst, src, x0, y0):
    """
    把一小块 RGBA 叠到大图的指定位置（**就地修改 dst**）。

    皴有几百笔，每笔都占几十像素。若每笔都在整幅画布上光栅化，成本是
    O(笔数 × 画幅)，一张远景要跑几分钟；贴小图把它降到 O(笔数 × 笔的面积)。
    """
    dh, dw = dst.shape[:2]
    sh, sw = src.shape[:2]
    x1, y1 = min(dw, x0 + sw), min(dh, y0 + sh)
    if x0 >= x1 or y0 >= y1:
        return dst
    sx0, sy0 = max(0, -x0), max(0, -y0)
    sub = src[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)]
    dst[y0:y1, x0:x1] = over(dst[y0:y1, x0:x1], sub)
    return dst


def clip_bbox(shape, bbox):
    """
    把 bbox 夹到画布内，返回整数 (x0, y0, x1, y1)；完全落在画外则返回 None。

    配合 `ellipse_mask` / `polygon_mask` 做局部绘制用 —— 见 `local_stroke` 的说明。
    """
    h, w = shape
    x0 = int(max(0, np.floor(bbox[0])))
    y0 = int(max(0, np.floor(bbox[1])))
    x1 = int(min(w, np.ceil(bbox[2])))
    y1 = int(min(h, np.ceil(bbox[3])))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return x0, y0, x1, y1


def local_stroke(shape, rng, points, widths, color, pad=6, **kw):
    """
    在小画布上画一笔，返回 (RGBA 小块, x0, y0)。

    配合 `over_region()` 使用。
    """
    h, w = shape
    pts = np.asarray(points, np.float64)
    x0 = int(max(0, np.floor(pts[:, 0].min() - pad)))
    x1 = int(min(w, np.ceil(pts[:, 0].max() + pad)))
    y0 = int(max(0, np.floor(pts[:, 1].min() - pad)))
    y1 = int(min(h, np.ceil(pts[:, 1].max() + pad)))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None, 0, 0
    sub_pts = pts - np.array([x0, y0], np.float64)
    return ink_stroke((y1 - y0, x1 - x0), rng, sub_pts, widths, color, **kw), x0, y0


def tint(layer, color, strength=1.0, preserve_lum=0.0):
    """
    给已有一层换色 —— 「青禾灵雾态」这类靠换色实现的效果会用到。

    strength=1 完全替换色相；preserve_lum 保留原图明暗起伏的比例。
    """
    out = layer.copy()
    c = np.asarray(color, np.float32).reshape(1, 1, 3)
    if preserve_lum > 0.0:
        lum = layer[..., :3].mean(axis=2, keepdims=True)
        ref = max(float(lum.mean()), 1e-6)
        c = c * (1.0 - preserve_lum + preserve_lum * lum / ref)
    out[..., :3] = layer[..., :3] * (1.0 - strength) + c * strength
    return out


def glow_layer(color, alpha, radius, boost=1.0):
    """把遮盖度图糊开成一层柔光 —— 灵炁、灵合光效都用它。"""
    soft = gblur(np.clip(alpha, 0.0, 1.0), radius) * boost
    return fill(color, np.clip(soft, 0.0, 1.0))


def save(layer, path):
    """落 PNG（RGBA，straight alpha）。自动建目录。"""
    import os
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    a = np.clip(layer, 0.0, 1.0)
    img = Image.fromarray((a * 255.0 + 0.5).astype(np.uint8), mode="RGBA")
    img.save(path, optimize=True)
    return path


def to_pil(layer):
    """RGBA float 层 → PIL 图（预览 / 拼图用）。"""
    return Image.fromarray((np.clip(layer, 0, 1) * 255 + 0.5).astype(np.uint8), mode="RGBA")


def flatten(layer, bg=(1.0, 1.0, 1.0)):
    """合成到不透明底色上 —— 存预览图用，方便肉眼比对。"""
    base = fill(bg, 1.0, layer.shape[:2])
    return over(base, layer)


def contact_sheet(items, cols=4, cell=360, pad=10, card=(0.90, 0.89, 0.86), seed=1):
    """
    把若干图层铺成一张联系表 —— 校对用。

    `items` 可以是 [图层, ...] 或 [(名字, 图层), ...]（名字只用于对齐打印）。

    合成走真正的 alpha 叠加，并把每张放在一张浅色卡上：
    半透明的组件（灵炁条、光效）直接铺在纸上会看不清边缘，垫张卡才判断得出
    它到底"有没有画出来"。
    """
    layers = [it[1] if isinstance(it, tuple) else it for it in items]
    n = len(layers)
    rows = (n + cols - 1) // cols
    W, H = cols * cell, rows * cell
    rng = np.random.default_rng(seed)
    sheet = np.concatenate([paper_texture(W, H, rng),
                            np.ones((H, W, 1), np.float32)], axis=2)

    for i, lay in enumerate(layers):
        im = to_pil(lay).convert("RGBA")
        im.thumbnail((cell - pad * 2, cell - pad * 2))
        a = np.asarray(im, np.float32) / 255.0
        tile = fill(card, 1.0, a.shape[:2])
        r, c = divmod(i, cols)
        y0, x0 = r * cell + pad, c * cell + pad
        sheet[y0:y0 + a.shape[0], x0:x0 + a.shape[1]] = over(
            sheet[y0:y0 + a.shape[0], x0:x0 + a.shape[1]], a)
    return sheet


# ============================================================ 遮罩

def _safe_supersample(w, h, supersample, budget=8192):
    """
    大画幅下把超采样压回去。

    4096 宽的远景层开 4× 就是 16384×8192 的中间图，单张 128MB —— 直接撑爆。
    超采样只影响边缘质量，画幅越大越看不出来，所以按长边预算削减。
    """
    return max(1, min(int(supersample), max(1, budget // max(w, h, 1))))


def polygon_mask(shape, points, supersample=4, feather=0.0):
    """
    多边形 → 抗锯齿遮盖度图。超采样后降采样，边缘不会有锯齿。

    `points` 为 [(x, y), ...]。
    """
    h, w = shape
    ss = _safe_supersample(w, h, supersample)
    img = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(img).polygon([(x * ss, y * ss) for x, y in points], fill=255)
    m = _resize(np.asarray(img, np.float32) / 255.0, (w, h), Image.LANCZOS)
    return gblur(m, feather) if feather > 0 else m


def ellipse_mask(shape, cx, cy, rx, ry, supersample=4, feather=0.0, angle=0.0):
    """椭圆遮盖度图。`angle` 单位度。"""
    h, w = shape
    ss = _safe_supersample(w, h, supersample)
    img = Image.new("L", (w * ss, h * ss), 0)
    box = [((cx - rx) * ss, (cy - ry) * ss), ((cx + rx) * ss, (cy + ry) * ss)]
    d = ImageDraw.Draw(img)
    if abs(angle) < 1e-6:
        d.ellipse(box, fill=255)
    else:
        # PIL 没有旋转椭圆，画在临时图上再转
        pad = int(max(rx, ry) * ss * 2)
        tmp = Image.new("L", (pad * 2, pad * 2), 0)
        ImageDraw.Draw(tmp).ellipse(
            [pad - rx * ss, pad - ry * ss, pad + rx * ss, pad + ry * ss], fill=255)
        tmp = tmp.rotate(angle, resample=Image.BICUBIC)
        img.paste(tmp, (int(cx * ss) - pad, int(cy * ss) - pad), tmp)
    m = _resize(np.asarray(img, np.float32) / 255.0, (w, h), Image.LANCZOS)
    return gblur(m, feather) if feather > 0 else m


def warp(mask, dx, dy):
    """按位移场扰动遮罩 —— 水墨的「不规整边缘」全靠它。"""
    h, w = mask.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    return ndimage.map_coordinates(mask, [yy + dy, xx + dx], order=1,
                                   mode="nearest").astype(np.float32)


NOISE_BUDGET = 768
"""
噪声场的分辨率上限（长边）。

`fbm` 是按全幅算的：一次 4096×2048 的 5 层 fbm 要处理 4000 万像素。画一整片山
只调一次无所谓，但 `bg_mid_forest` 里每棵树、每块石头都要糊一次 —— 180 次全幅
fbm 直接把一张中景层拖到跑不完。

颗粒和位移场都是「细节」而不是「结构」，降到 768 再放大，肉眼看不出差别，
成本降一个数量级。
"""


def _cheap_noise(h, w, rng, octaves=5, cells_at_full=20):
    """
    低成本噪声：在缩小的画布上生成再放大。

    `cells_at_full` 是按全幅尺寸给出的格数，会按缩放比例折算回去 ——
    这样颗粒的**视觉尺度**与画幅无关，2048 和 4096 上看起来一样粗。
    """
    long_side = max(h, w)
    if long_side <= NOISE_BUDGET:
        return fbm(h, w, rng, octaves=octaves, base_cells=cells_at_full)

    k = NOISE_BUDGET / long_side
    sh, sw = max(8, int(h * k)), max(8, int(w * k))
    cells = max(2, int(round(cells_at_full * k)))
    return _resize(fbm(sh, sw, rng, octaves=octaves, base_cells=cells), (w, h))


def warp_field(h, w, rng, amount, scale=3.0, seed_octaves=3):
    """造一对位移场，配合 `warp()` 使用。`amount` 单位像素。"""
    if amount <= 0:
        z = np.zeros((h, w), np.float32)
        return z, z
    dx = (_cheap_noise(h, w, rng, seed_octaves, max(2, int(scale))) - 0.5) * 2 * amount
    dy = (_cheap_noise(h, w, rng, seed_octaves, max(2, int(scale))) - 0.5) * 2 * amount
    return dx.astype(np.float32), dy.astype(np.float32)


# ============================================================ 笔

def taper(n, w_max, profile=(0.0, 1.0, 0.35), power=1.0):
    """
    生成 n 个采样点的半宽序列 —— 笔锋的起、行、收。

    `profile` = (起笔宽度比, 最宽处位置, 收笔宽度比)，都相对 w_max。
    默认起笔藏锋、中段饱满、收笔略提 —— 是「一撇」不是「一根管子」。
    """
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)
    start, peak_at, end = profile
    peak_at = float(np.clip(peak_at, 1e-3, 1.0 - 1e-3))
    rise = start + (1.0 - start) * smoothstep(t, 0.0, peak_at)
    fall = 1.0 - (1.0 - end) * smoothstep(t, peak_at, 1.0)
    return (w_max * np.minimum(rise, fall) ** power).astype(np.float32)


def stroke_mask(shape, points, widths, supersample=4):
    """中心线 + 半宽序列 → 描边遮盖度图（含收锋）。"""
    h, w = shape
    pts = np.asarray(points, np.float64)
    wid = np.asarray(widths, np.float64)
    if len(pts) < 2:
        return np.zeros((h, w), np.float32)

    d = np.gradient(pts, axis=0)
    ln = np.hypot(d[:, 0], d[:, 1])
    ln[ln < 1e-6] = 1e-6
    nx, ny = -d[:, 1] / ln, d[:, 0] / ln      # 法线

    left = np.stack([pts[:, 0] + nx * wid / 2, pts[:, 1] + ny * wid / 2], axis=1)
    right = np.stack([pts[:, 0] - nx * wid / 2, pts[:, 1] - ny * wid / 2], axis=1)
    poly = np.concatenate([left, right[::-1]], axis=0)
    return polygon_mask(shape, poly, supersample=supersample)


def dry_brush(mask, rng, amount=0.5, streak=6.0, stretch=8.0, direction="h"):
    """
    飞白 —— 笔速快时纸面吃不住墨留下的丝状空隙。

    `amount`    飞白强度 0~1
    `streak`    丝的**宽度**（px，垂直于笔画方向）
    `stretch`   丝的长宽比
    `direction` 丝的走向：

        "h"   横丝，给横向笔画用
        "v"   竖丝，给竖向笔画用
        "iso" 各向同性，给**走向不明或成环**的笔画用（如边框）

    两个坑，都踩过：

    1. **方向必须跟笔画一致**。否则高频方向横切笔画，一笔会被剁成一串断线。
       边框是四向合围，用单一横丝会同时毁掉左右两条竖边，必须用 "iso"。
    2. **频率必须高、且跟着画幅走**。噪声格数写死成常数（比如 6）的话，
       在 768px 画幅上一格就是 128px —— 那是大色块不是飞白，一切就是整段消失。
       所以按 `streak` 反推格数：格数 = 画幅 / 丝宽。
    """
    if amount <= 0:
        return mask
    h, w = mask.shape
    s = max(1.0, float(stretch))
    st = max(1.0, float(streak))

    if direction == "iso" or s <= 1.0:
        cells = max(4, int(round(h / st)))
        n = fbm(h, w, rng, octaves=3, base_cells=cells)
    elif direction == "v":
        # 纵向平滑、横向高频 → 竖丝
        n = fbm(max(2, int(h / s)), w, rng, octaves=3,
                base_cells=max(4, int(round(w / st))))
    else:
        # 横向平滑、纵向高频 → 横丝
        n = fbm(h, max(2, int(w / s)), rng, octaves=3,
                base_cells=max(4, int(round(h / st))))

    n = _resize(n, (w, h), Image.BICUBIC)
    keep = smoothstep(n, 0.5 - amount * 0.5, 0.5 + amount * 0.5)
    return mask * keep


def ink_wash(mask, rng, density=1.0, blur=1.0, warp_amt=0.0,
             granulate=0.0, edge_darken=0.0, scale=3.0, grain_scale=0):
    """
    把一块几何遮罩变成「墨块」。

    依次做四件事，对应水墨的实际物理过程：
      1. 扰动边界  —— 墨沿纸纤维洇开，边缘从来不齐
      2. 高斯糊开  —— 洇染的软边
      3. 颗粒调制  —— 积墨不匀，`granulate` 控制起伏幅度
      4. 边缘积墨  —— 水渍干后边缘比中间深，`edge_darken` 控制强度

    `grain_scale` 是颗粒的空间频率（格数）。给 0 时按画幅自动取 —— 固定值在
    2048 和 4096 上看起来会是两种完全不同的质感，必须跟着画幅走。

    返回 (h, w) 的墨量图（后续交给 `fill()` 上色）。
    """
    m = mask.astype(np.float32)
    h, w = m.shape
    if warp_amt > 0:
        dx, dy = warp_field(h, w, rng, warp_amt, scale=scale)
        m = warp(m, dx, dy)
    if blur > 0:
        m = gblur(m, blur)
    if granulate > 0:
        gs = grain_scale if grain_scale > 0 else max(8, min(h, w) // 96)
        g = _cheap_noise(h, w, rng, octaves=5, cells_at_full=gs)
        m = m * (1.0 - granulate + granulate * (0.35 + 0.65 * g))
    if edge_darken > 0:
        # 边界 = 模糊后的梯度峰值
        grad = np.hypot(*np.gradient(gblur(m, max(blur, 1.0) * 2.0)))
        m = m + edge_darken * norm01(grad) * m
    return np.clip(m * density, 0.0, 1.0).astype(np.float32)


# ============================================================ 一笔

def ink_stroke(shape, rng, points, widths, color, alpha=1.0, dry=0.0,
               dry_stretch=8.0, dry_direction="h", blur=0.0, granulate=0.0,
               edge_darken=0.0, supersample=4):
    """
    一笔 —— 描边 → 飞白 → 洇边 → 上色。

    单根线条永远不像水墨（像矢量图）。至少要带一点 `dry` 或 `granulate`，
    笔才"活"。

    `dry_direction` 见 `dry_brush()`：笔画走向不明或成环时传 "iso"。
    """
    m = stroke_mask(shape, points, widths, supersample=supersample)
    if dry > 0:
        m = dry_brush(m, rng, dry, stretch=dry_stretch, direction=dry_direction)
    if blur > 0 or granulate > 0 or edge_darken > 0:
        m = ink_wash(m, rng, blur=blur, granulate=granulate, edge_darken=edge_darken)
    return fill(color, np.clip(m * alpha, 0.0, 1.0))


# ============================================================ 山水

def below_profile(shape, top):
    """
    脊线之下全部填满 —— 山体的几何本体。

    `top` 是长度 w 的数组（每列的脊线 y）。向量化，4096 宽也是瞬时。
    """
    h, w = shape
    yy = np.arange(h, dtype=np.float32)[:, None]
    return (yy >= np.asarray(top, np.float32)[None, :]).astype(np.float32)


def depth_ramp(shape, top):
    """
    山体「入深」比例图：脊线上为 0，山脚为 1。

    罩染、渐变都要按这个走 —— 不按画幅高度走，否则山一高颜色就串了。
    """
    h, w = shape
    yy = np.arange(h, dtype=np.float32)[:, None]
    t = np.asarray(top, np.float32)[None, :]
    return np.clip((yy - t) / np.maximum(h - t, 1.0), 0.0, 1.0)


def cun_strokes(shape, rng, top, count=60, length=(24, 80), alpha=0.45,
                color=None, dry=0.5, spread=0.55, tilt=0.35, bend=0.25,
                cluster=(3, 6), cluster_spread=0.03):
    """
    皴 —— 山石坡面上的短笔，顺山势而下。

    这是山水分不出「山」和「三角铁片」的关键：没有皴，山体就是一坨平涂。

    笔**成簇**而非逐笔独立撒点：同簇的几笔近平行、起笔位置彼此错开，这才是
    「披麻皴」的样子。独立随机撒点得到的是杂乱毛发。

    `spread`  皴在山体上的分布深度（占山高的比例）
    `tilt`    顺坡倾斜
    `bend`    弧度（直笔像划痕，弧笔才像皴）
    `cluster` 每簇的笔数区间

    注意斜率必须**夹住**：脊线在尖峰处的斜率能到 20px/px，直接乘进横向位移会把
    一笔皴拉成横贯整个山体的长划痕。
    """
    h, w = shape
    out = new_layer(w, h)
    if count <= 0:
        return out
    color = color if color is not None else INK["medium"]
    top = np.asarray(top, np.float32)
    slope = np.clip(np.gradient(top), -2.0, 2.0)
    lo, hi = min(cluster), max(cluster)

    drawn = 0
    while drawn < count:
        # 一簇的基准位（脊线上一点，往下扎进山体）
        cx = int(rng.integers(2, max(3, w - 2)))
        ridge_y = float(top[cx])
        cy = ridge_y + rng.uniform(0.0, spread) * max(h - ridge_y, 1.0)
        base_slope = float(slope[cx])
        per = int(rng.integers(lo, hi + 1))

        for _ in range(per):
            if drawn >= count:
                break
            drawn += 1
            ln = rng.uniform(*length)
            n = max(5, int(ln / 3))
            t = np.linspace(0.0, 1.0, n)
            # 簇内抖动：起笔位置与斜率都只在小范围偏移，几笔才「同向」
            jx = cx + rng.normal(0.0, cluster_spread * w)
            jy = cy + rng.normal(0.0, 8.0)
            sl = base_slope + rng.normal(0.0, 0.25)
            bd = bend * rng.uniform(-1.0, 1.0)
            dx = tilt * sl * ln * t + bd * ln * (t ** 2)
            pts = np.stack([jx + dx, jy + ln * t], axis=1)
            wid = taper(n, rng.uniform(1.5, 3.6), profile=(0.15, 0.30, 0.05))
            # 局部小画布渲染再贴回 —— 见 local_stroke 的说明
            sub, ox, oy = local_stroke((h, w), rng, pts, wid, color,
                                       alpha=alpha * rng.uniform(0.45, 1.0),
                                       dry=dry, blur=0.8, granulate=0.35)
            if sub is not None:
                over_region(out, sub, ox, oy)
    return out


def mountain_layer(shape, rng, top, ink="light", density=0.75, blur=6.0,
                   granulate=0.35, edge_darken=0.35, warp_amt=0.0,
                   color=None, color_amt=0.0, vertical_fade=0.0,
                   contour=0.0, contour_ink=None, contour_alpha=0.85,
                   cun=0, cun_length=(24, 80), cun_alpha=0.4, cun_spread=0.55,
                   cun_tilt=0.35, cun_bend=0.25):
    """
    一层山 —— 墨块 + 青绿罩染 + 脊线轮廓 + 皴。

    `top`          长度 w 的脊线数组（`ridged_1d` + `peaks_1d` 的产物）
    `ink`          墨阶（`INK` 的键），山体的主调
    `color`        罩染的矿物色。(顶色, 底色) 可给一对做垂直渐变
    `vertical_fade` 越大，山脚越淡 —— 让它融进下方的云雾里
    `contour`      脊线轮廓的笔宽（px），0 = 不画
    `cun`          皴的笔数

    层内顺序固定：先墨块打底，再罩染，最后落轮廓与皴 ——
    顺序反了轮廓会被罩染糊掉。
    """
    h, w = shape
    top = np.asarray(top, np.float32)
    body = below_profile(shape, top)

    if vertical_fade > 0:
        yy = np.arange(h, dtype=np.float32)[:, None]
        body = body * (1.0 - vertical_fade * smoothstep(yy / max(h, 1), 0.25, 1.0))

    m = ink_wash(body, rng, density=density, blur=blur, warp_amt=warp_amt,
                 granulate=granulate, edge_darken=edge_darken)
    layer = fill(INK[ink], m)

    # 罩染 —— 沿入深方向在顶色/底色之间插值
    if color is not None and color_amt > 0:
        if isinstance(color, (list, tuple)) and len(color) == 2 and \
                isinstance(color[0], (list, tuple)):
            ct, cb = np.asarray(color[0], np.float32), np.asarray(color[1], np.float32)
        else:
            ct = cb = np.asarray(color, np.float32)
        ramp = depth_ramp(shape, top)[..., None]
        cmap = ct.reshape(1, 1, 3) * (1.0 - ramp) + cb.reshape(1, 1, 3) * ramp
        layer = over(layer, np.concatenate([cmap, (m * color_amt)[..., None]], axis=2))

    # 脊线轮廓：沿脊线走一笔
    if contour > 0:
        step = max(1, int(w / 900))
        xs = np.arange(0, w, step)
        pts = np.stack([xs, top[xs]], axis=1).astype(np.float64)
        wid = np.full(len(xs), float(contour), np.float32)
        wid *= (0.7 + 0.6 * fbm(1, len(xs), rng, octaves=3, base_cells=8)[0])
        layer = over(layer, ink_stroke((h, w), rng, pts, wid,
                                       contour_ink or INK["medium"],
                                       alpha=contour_alpha, dry=0.45,
                                       blur=1.2, granulate=0.25,
                                       edge_darken=0.3))

    if cun > 0:
        layer = over(layer, cun_strokes(shape, rng, top, count=cun,
                                        length=cun_length, alpha=cun_alpha,
                                        color=INK[ink] if ink in ("heavy", "burnt")
                                        else INK["medium"],
                                        spread=cun_spread,
                                        tilt=cun_tilt, bend=cun_bend))
    return layer


def mist_band(shape, rng, y, height, color=None, density=0.75, stretch=7.0,
              softness=None, seed_scale=4):
    """
    一条云雾 —— 横向拉长的柔白噪声。

    它的作用是**留白**：把两层山隔开，画面才有「深远」。GDD §7.1 的
    「云雾流动」就是几层这样的带子以不同速度滚动。
    """
    h, w = shape
    color = color if color is not None else PAPER["xuan"]
    softness = softness if softness is not None else height * 0.5

    yy = np.arange(h, dtype=np.float32)[:, None]
    band = np.exp(-((yy - y) / max(softness, 1.0)) ** 2)

    n = fbm(max(2, int(h / stretch)), w, rng, octaves=5, base_cells=seed_scale)
    n = _resize(n, (w, h), Image.BICUBIC)
    n = smoothstep(n, 0.30, 0.80)

    m = np.clip(band * n, 0.0, 1.0) ** 0.85
    return fill(color, m * density)


# ============================================================ 纸

def paper_texture(w, h, rng, base="xuan", fiber=0.035, blotch=0.05, vignette=0.10):
    """
    宣纸底 —— 不透明 RGB 底色，返回 (h, w, 3)。

    两层结构：低频的「云斑」（纸浆厚薄不匀）+ 高频的「纤维」。
    """
    c = np.asarray(PAPER[base], np.float32)
    cloud = fbm(h, w, rng, octaves=4, base_cells=3)
    grain = fbm(h, w, rng, octaves=3, base_cells=24)
    mod = 1.0 + blotch * (cloud - 0.5) * 2.0 + fiber * (grain - 0.5) * 2.0

    out = c.reshape(1, 1, 3) * mod[..., None]
    if vignette > 0:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.hypot((xx / w - 0.5) * 2.0, (yy / h - 0.5) * 2.0) / 1.414
        out *= (1.0 - vignette * smoothstep(r, 0.35, 1.0))[..., None]
    return np.clip(out, 0.0, 1.0)


def stain(layer, rng, color="aged", amount=0.14, count=14, scale=(0.08, 0.30)):
    """在已有层上加水渍 / 陈年黄斑 —— 卷轴、石碑这类「旧物」用。"""
    h, w = layer.shape[:2]
    out = layer
    for _ in range(count):
        cx, cy = rng.random() * w, rng.random() * h
        rx = rng.uniform(*scale) * w
        ry = rx * rng.uniform(0.4, 1.0)
        m = ellipse_mask((h, w), cx, cy, rx, ry, feather=rx * 0.35)
        m = ink_wash(m, rng, density=rng.uniform(0.4, 1.0) * amount,
                     blur=rx * 0.06, warp_amt=rx * 0.10, granulate=0.5)
        out = over(out, fill(PAPER[color], m))
    return out
