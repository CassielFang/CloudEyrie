# art-source/ —— 美术原始素材与程序化占位生成器

> **这个目录刻意放在 `assets/` 之外。** Cocos 会导入 `assets/` 下所有图片并生成
> `.meta`，这些高分辨率素材全部导入会白白吃掉显存。确定要进引擎的版本，
> 由人挑选后另存到 `assets/Textures/`。

---

## ⚠️ 先说清楚这是什么

`ui/` `scene/` `fx/` `char/` 下的素材是**程序化生成的占位图**，由 `_tools/` 里的
Python 脚本画出来，不是美术组画的。

**它们能做的**：定比例、定配色、定构图层次、把玩法和关卡先调通。

**它们做不到的**：骨骼动画、多帧动作（待机/行走/攻击/受击）、真正的笔触细节。
角色和敌人尤其明显 —— 每张只是一帧静止的剪影。

正式资产仍须美术组手绘。等正式素材到位，`_tools/` 整个目录可以删掉。

---

## 画风依据

全部出自 `docs/Cloud Eyrie.md` §7「美术视觉设计」：

| 出处 | 要求 | 落在哪 |
|---|---|---|
| §7.1 | 宋韵青绿山水 + 水墨淡彩晕染 | 全部；调色板见下 |
| §7.1 | 远景淡墨山峦、云雾流动 | `scene/bg_far_mountains.png`、`cloud_mist_*.png` |
| §7.1 | 中景林木、岩石、古建筑 | `scene/bg_mid_forest.png` |
| §7.1 | 近景草丛、花枝、碎石 | `scene/bg_near_grass.png` |
| §7.2 | 莹翳通体雪白、生半透明鹿角、尾带灵雾 | `char/yingyi_entity.png` |
| §7.2 | 灵雾形态水墨粒子、边缘晕染虚化 | `char/yingyi_mist.png` |
| §7.2 | 浊湮浓黑水墨、颗粒流动感 | `char/yangzhuo.png`、`char/yinzhuo.png`、`fx/corruption_pool.png` |
| §7.3 | UI 极简、石碑卷轴意象、半透明水墨 | `ui/` 全部 |
| §3.2 / §2.3 | 三形态规则与莹翳设定 | `ui/icon_form_*.png`、`char/yingyi_*.png` |
| §4.2 | 阳浊实体 / 阴浊半透明黑雾 | `char/yangzhuo.png` vs `char/yinzhuo.png` |

资产编号（#1–#31）对应 `docs/大赛规划v2.0（17天版）.md` 第 326–377 行的美术资产清单。

---

## 调色板

定义在 `_tools/inkwash.py` 顶部，改配色改那里一处即可。

**墨分五色** `INK` —— 焦 `burnt` / 重 `heavy` / 浓 `medium` / 淡 `light` / 清 `pale`

**青绿矿物色** `MINERAL` —— 石青 `azurite`、轻石青、石绿 `malachite`、轻石绿、花青 `indigo`、赭石 `ochre`

**灵炁** `SPIRIT` —— 核心 `core`（近白青）/ 辉光 `glow`（青碧）/ 玉色 / 暗部 / 灵合暖金 `merge`

**浊湮** `CORRUPT` —— 浓黑 `deep` / 中 `mid` / 翳散 `haze` / 灰烬 `ash`

**宣纸** `PAPER` —— 生宣 `xuan` / 绢本 / 旧纸 `aged` / 暗部

> **一条硬约束**：本作底色是浅色宣纸，**近白色的效果在画面上等于没画**。
> 特效主体一律用 `SPIRIT["glow"]`（青碧）而非 `SPIRIT["core"]`（近白），
> 白色只留在最内一层做「核」。`fx/slash_light.png` 就是按这条改过的。

---

## 目录与尺寸

### `title/` —— 首页专用（3 张）

给 `assets/Scene/Title.scene` 用的，`python gen_art.py --only title` 生成。
和别的类别不同，这三张**不是整批随机生成的**（都是解析式的），所以 `--seed` 对它们无效。

| 文件 | 尺寸 | 说明 |
|---|---|---|
| `title_scroll.png` | 2200×1000 | 从 `assets/Textures/scroll.png`（4000×1000）居中裁的中段。留了左右余量给超宽屏按 cover 铺满 |
| `title_vignette.png` | 512×512 | 径向暗角，压四边收视线。引擎里拉伸到可视区尺寸 |
| `title_glow.png` | 256×256 | 径向柔光（导入后会被裁到 242×242）。一图三用：标题辉光 / 选中项辉光 / 灵炁光点 |

**暮色压暗不在生成器里做**——是在引擎里给 `Sprite.color` 乘一个深青靛蓝（见 `TitleScreen.ts` 的 `BG_TINT`）。
乘算保留笔触和明暗层次，比叠半透明黑蒙层通透；放在引擎里也方便调色，不用重跑生成器。

### `ui/` —— 界面（15 张）

| 文件 | 尺寸 | 说明 |
|---|---|---|
| `spirit_bar_track.png` | 2048×192 | 灵炁条槽底。淡墨横笔 + 两端收口 |
| `spirit_bar_fill.png` | 2048×192 | 灵炁条填充。**沿 X 方向均匀**，可按百分比任意裁切 |
| `spirit_bar_tip.png` | 128×192 | 笔锋光点，跟着百分比跑 |
| `phase_arc_lit.png` / `_dim.png` | 256×256 | Boss 阶段弧线亮/暗两态，三段由引擎摆三次 |
| `panel_paper.png` | 1024×1024 | 宣纸九宫格面板，切图边距 **72px** |
| `panel_scroll.png` | 1024×640 | 完整卷轴，**定尺不做九宫格**（两端的轴拉长会变擀面杖） |
| `panel_stele.png` | 768×1024 | 石碑面板 |
| `btn_stele.png` / `_hover.png` / `_pressed.png` | 512×192 | 石碑按钮三态，切图边距 **24px**。三态形状一致，只改明度与灵光 |
| `icon_form_entity/mist/merge.png` | 256×256 | 三形态图标 |
| `prompt_frame.png` | 640×160 | 操作提示的水墨底框 |

### `scene/` —— 场景（11 张）

| 文件 | 尺寸 | 说明 |
|---|---|---|
| `bg_far_mountains.png` | 4096×2048 | 远景三层山 + 云雾，**左右可平铺** |
| `cloud_mist_a.png` / `_b.png` | 4096×1024 | 云雾带，两层不同速度滚动即「云雾流动」 |
| `bg_mid_forest.png` | 4096×2048 | 中景林木 + 岩石 + 古祠残壁 |
| `bg_near_grass.png` | 4096×1024 | 近景草丛 + 碎石 + 花枝（只有下缘一条带） |
| `boss_valley.png` | 4096×2048 | 青丘谷地，压低山线加大留白 |
| `spring_platform.png` | 512×384 | 灵泉石台，触碰恢复 50 点灵炁 |
| `realm_barrier.png` | 512×768 | 灵界屏障，半透明 |
| `realm_switch_off.png` / `_on.png` | 256×256 | 灵界机关两态，**几何完全一致**只改亮度 |
| `ground_tileset.png` | 1024×512 | 地面 tileset，**横向可平铺** |

### `fx/` —— 特效（11 张）

| 文件 | 尺寸 | 说明 |
|---|---|---|
| `slash_light.png` | 512×512 | 轻击挥砍弧线 |
| `slash_heavy.png` | 512×768 | 蓄力重击光柱（竖构图，横弧表现不出重量） |
| `dash_trail.png` | 768×256 | 踏云闪水墨拖尾，左淡右浓 |
| `switch_particles.png` | 1024×1024 | 形态切换粒子表，**4×4 = 16 帧**，行优先 |
| `merge_burst.png` | 768×768 | 灵合爆发（暖金） |
| `corruption_pool.png` | 768×384 | 浊湮水洼，颗粒横向流动 |
| `spirit_orb.png` | 128×128 | 灵炁弹丸（对应 `combat/MistShot.ts`） |
| `purify_ring.png` | 768×768 | 净化光环 |
| `block_spark.png` | 384×384 | 格挡闪光 |
| `block_counter.png` | 512×512 | 完美格挡反制（青+金交叉双弧，与轻击区分） |
| `hit_feedback.png` | 384×384 | 受击反馈 |

> 特效**全是单帧**。带旋转、缩放、拖尾的动画要靠引擎粒子系统驱动 ——
> 那部分（规划里的「特效系统框架（粒子）」）目前仍是 ❌。

### `char/` —— 角色与敌人（5 张）

| 文件 | 尺寸 | 说明 |
|---|---|---|
| `yingyi_entity.png` | 512×512 | 莹翳实体态。雪白躯体 + 半透明鹿角 + 灵雾尾 |
| `yingyi_mist.png` | 512×512 | 莹翳灵雾态。保留轮廓但被噪声打散 + 灵炁辉光 |
| `yangzhuo.png` | 384×384 | 阳浊。实体化浊影兽，青禾普攻可伤 |
| `yinzhuo.png` | 384×384 | 阴浊。**无实体轮廓**，须先用莹翳灵炁显形 |
| `foxfire.png` | 128×128 | 狐火弹丸 |

> **朝向约定：所有角色一律朝右绘制。**
> 与 `FacingFlip.applyFacingFlip(node, facing, naturalFacing=1)` 的约定一致
> （立绘朝右 = `1`）。传错会出现「攻击打到背后」，本项目已栽过一次，
> 见 `CLAUDE.md` 与 `docs/进度追踪.md` 的踩坑记录。

---

## 重新生成

```bash
cd art-source/_tools
python gen_art.py                    # 全部生成
python gen_art.py --only ui fx       # 只生成指定类别
python gen_art.py --seed 1234        # 换一套随机（同 seed 必然复现同一套图）
python gen_art.py --sheet ui         # 额外出联系表到 art-source/_preview/
```

依赖 Pillow / numpy / scipy。本机用 `/d/anaconda3/python.exe`。

**调参改哪**：

- 配色 → `inkwash.py` 顶部的调色板
- 笔法 / 山水构件 → `inkwash.py`（`ink_wash`、`ink_stroke`、`mountain_layer`、`cun_strokes`、`mist_band`）
- 某个具体资产 → 对应 `gen_*.py` 里的那个函数

同一 seed 必然复现同一张图，所以可以放心改参数、对比前后差异。

---

## 已知限制与坑

### 画不出正式美术

骨骼动画、多帧动作、真正的笔触细节都做不了。角色尤其 —— 只有一帧静止剪影，
不能直接用于有动作反馈的战斗。

### 中景层的地面是块硬邦邦的灰板

`bg_mid_forest.png` 底部那条水平灰带读起来偏平。实际用起来它多半会被近景层和
地面碰撞体挡住，暂时没继续打磨。

### 性能：局部绘制是必须的，不是优化

`inkwash.py` 里所有「小元素」（树、石、皴、草叶）都在**局部小画布**上绘制再
`over_region()` 贴回。这不是为了快一点，是为了能跑完：

`ellipse_mask` / `polygon_mask` 的内部超采样画布是按传入 `shape` 开的。在
4096×2048 的中景层上画一个 120px 的树冠，会开一张 8192×4096 的中间图再降采样 ——
180 个树冠足以让这张图永远跑不完。同理 `_cheap_noise()` 把颗粒/位移场限制在
768 长边以内。

**加新元素时请沿用 `local_stroke()` / `over_region()` 的写法**，不要直接在
全幅 `shape` 上调 `ellipse_mask`。

### 飞白（`dry_brush`）的方向必须跟笔画一致

`dry_brush` 的噪声是**有方向**的：

- `direction="h"` 横丝，给横向笔画
- `direction="v"` 竖丝，给竖向笔画
- `direction="iso"` 各向同性，给**走向不明或成环**的笔画（如边框）

方向错了，高频那侧会横切笔画，一笔被剁成一串断线。边框是四向合围，
用单一横丝会同时毁掉左右两条竖边 —— 必须用 `"iso"`。

另外**频率要跟着画幅走**（`streak` 参数给的是像素宽度，格数由它反推）。
写死成常数的话，在 768px 画幅上一格就是 128px —— 那是大色块不是飞白，
切下去整段消失。

### 九宫格面板的边框不能用飞白

`panel_paper.png` / `btn_stele*.png` 的边框会被引擎沿轴向拉伸，飞白一旦被拉长
就成条纹。这两处的 `dry` 设成 0 或很低，质感交给 `ink_wash` 的颗粒。

---

## `_tools/` 文件说明

| 文件 | 作用 |
|---|---|
| `inkwash.py` | 水墨绘制核心库（笔、墨、色、纸、山水构件） |
| `gen_ui.py` | UI 组件生成器 |
| `gen_scene.py` | 场景资产生成器 |
| `gen_fx.py` | 特效素材生成器 |
| `gen_char.py` | 角色与敌人 sprite 生成器 |
| `gen_title.py` | 首页素材生成器（裁长卷中段 + 两张程序化贴图） |
| `gen_art.py` | 命令行入口 |
| `_preview/` | 联系表（校对用，可随时删） |
