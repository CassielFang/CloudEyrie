# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

《云岫》(CloudEyrie / Yunxiu) —— 2D 横版动作解谜 + 情感叙事向独立游戏，对标《NEVA》。核心机制是「灵炁共生」：主角青禾与灵伴莹翳（代码里叫 Yingyi，设计文档早期称「白駠」）共享同一条灵炁资源条，通过三种形态切换（实体随行 / 灵雾 / 灵合）来解谜与战斗。

技术栈：**Cocos Creator 3.8.8 + TypeScript**，启用 2D 物理（Box2D）、Spine/dragon-bones 动画、自定义渲染管线。项目完全在 Cocos Creator 编辑器内开发与运行。

## 开发与运行

- **没有 CLI 构建 / lint / 测试命令**。`package.json` 无 scripts，仓库内无测试。代码通过 Cocos Creator 3.8.8 编辑器打开、预览与构建。
- 改 `.ts` 脚本后由编辑器自动编译；改 `.scene` / `.prefab` 只能在编辑器里操作（或按 Cocos 序列化格式手改，风险高，通常不推荐）。
- `*.meta` 文件由编辑器自动生成并维护（记录资源 UUID 与导入配置），**不要手改或删除**。
- 两个场景：`assets/Scene/Title.scene`（游戏首页）→ 点「开始游戏」→ `assets/Scene/main.scene`（关卡）。
  main.scene 内含一个常驻 `GameManager` 节点（`director.addPersistRootNode`）和一个 `Canvas`；**Title.scene 故意不放 GameManager**
  （`GameManager.instance` 是进程内静态单例，两边都放会让 main 的副本自杀、且 GameConfig 的 Inspector 值取自先加载的那个）。
- ⚠️ **游戏代码里别在编辑器预览时关窗口**：`window.close()` 和 `game.end()` 是同一条路
  （`game.end()` → `systemInfo.close()` → `_onClose` → `systemInfo.exit()` → `window.close()`），
  在 Game View 的 Electron `<webview>` 里会把预览视图真的销毁、编辑器卡死只能强制重启（踩过两次）。
  **挡它要用 `EDITOR`（`cc/env`），不是 `PREVIEW`**：Game View 跑的是 **editor target**，
  那里 `EDITOR=true` 而 `PREVIEW=false`。用 `EDITOR` 挡的还有「编辑器里请求全屏」（Game View 里
  `supportsFullScreen` 居然是 true，不挡就会真发出去）。浏览器预览走 preview target，`EDITOR` 为 false。
- ⚠️ **预览运行时无法保存场景**：`Ctrl+S` 会"看起来成功"但文件根本不写。必须先**停止预览**再保存，然后重新运行预览。
  （改 `.ts` 后也**必须重启预览**才生效——编辑器会自动重编译，但运行中的预览不热重载。
  另外编辑器重编译有延迟，改完 `.ts` 立刻重启预览会跑的还是旧代码，必要时 `refresh_assets` 后等几秒。）
- ⚠️ **启动场景不随仓库走**：预览的启动场景存在 `profiles/v2/packages/preview.json`，而 `profiles/` 被 `.gitignore` 忽略
  ——**每台机器要各自在「预览」面板里把 Start Scene 选成 Title**。构建时的场景列表同理，只能在「构建发布」面板里勾选排序。
- 灰盒占位素材在 `assets/Textures/placeholder/`；其中 `white` / `mist_shot` / `hit_spark` 三张在
  `assets/resources/` 下有副本（只有 `resources/` 下的资源能被 `resources.load` 运行时加载）——**改图要两边一起改**。

## 架构

`assets/Scripts/` 下按功能分目录。日志 `logs/B/2026_08_22.md` 记录了团队的脚本分层约定：所有 TS 文件分三类——**Component**（用 `@ccclass` 标注、必须挂到 Node 上由引擎驱动完整生命周期）、**普通 TS 工具类**、**Data/Config 配置类**。

### `core/` —— 全局系统（引擎无关，全部为单例）

- `EventBus.ts`：发布/订阅事件总线，模块级单例 `eventBus`（`on` / `off` / `emit` / `clear`）。跨系统解耦统一走它，事件名如 `spirit-energy-changed`、`spirit-energy-depleted`。
- `GameConfig.ts`：**数值调参的唯一来源**。模块级可变单例 `gameConfig`（`gameConfig.spirit.*` / `gameConfig.tide.*`）是运行时读值入口；`@ccclass('GameConfig')` 组件挂载在常驻 GameManager 节点上，用 `@property` 暴露全部参数（Inspector 可调），`onLoad` 时把 Inspector 值同步进 `gameConfig` 并广播 `game-config-ready`。默认值即 week1 v1 参数表，改参在 Inspector 里做，不要在 Controller 硬编码。
- `SpiritEnergySystem.ts`：灵炁共享池（模块级单例 `spiritEnergySystem`）。v1 模型：实体态按动作消耗，恢复分战斗/非战斗两档 × 灵脉潮汐倍率，灵泉内速率恢复。惰性读取 `gameConfig`（勿缓存 `max`），`setInCombat` / `setTideRegenMult` / `setInSpring` 控制恢复档位，数值变更经 EventBus 广播。
- `GameManager.ts`：`static getInstance()` + `onLoad` 防重复创建 + 跨场景常驻。当前是全局初始化入口，内含 EventBus / 灵炁系统的冒烟测试代码。
- `SceneManager.ts`：对 `director.loadScene` 的薄封装（模块级单例 `sceneManager`）。
- `FacingFlip.ts`：`applyFacingFlip(node, facing, naturalFacing)` —— 按朝向水平翻转节点。
  美术目前只提供**单侧朝向**的素材，左右靠镜像表示，**这是临时方案**，骨骼动画接入后整个文件删掉。
  `naturalFacing` 表示**素材本身画的是朝哪边**（青禾立绘 = 朝右 = `1`）；
  传错会导致"攻击打到背后"（立绘朝向与判定盒方向相反）。所有需要镜像的地方都走这里，别再各写一份。

**单例约定**：工具类用模块级 `export const xxx = new Xxx()`（EventBus、SpiritEnergySystem、SceneManager）；需要挂节点/参与生命周期的用 `@ccclass` + 静态 `getInstance()`（GameManager）。

### `character/` —— 角色

- `QingheController.ts`：青禾玩家控制器的「实体外壳」——物理（`RigidBody2D`/`BoxCollider2D`）、输入读取、近战攻击（子节点 `AttackHitBox` 碰撞器开关判定）。**不含形态移动逻辑**，而是委托给 `forms/` 状态类。
- `CompanionStateMachine.ts`：灵伴三形态状态机的「中枢」——管当前形态、状态转换规则、切换硬直、灵合冷却/休眠、强制切雾，经 `companion-form-changed` 事件广播。持有 `Map<CompanionForm, ICompanionForm>`，每帧由 QingheController 调 `tick(dt, ctx)` 委托「移动 + 灵炁消耗」给当前形态状态类。
- `forms/`：**状态模式**——`ICompanionForm` 接口 + `FormContext` 共享上下文（刚体/输入/朝向/着地）+ `EntityForm`/`MistForm`/`MergeForm` 三个形态状态类，各自内聚移动与灵炁消耗。加新形态 = 加一个状态类并在中枢 map 注册，不碰现有代码。
- `YingyiController.ts`、`CharacterInput.ts`：**当前是空壳**（仅 `start` / `update` 占位）。

### `combat/` —— 战斗（已实现）

- `CombatController.ts`：挂在青禾节点，独占 `J`（轻击三连 / 蓄力重击）与 `L`（格挡）输入，驱动子节点 `AttackHitBox` 的命中判定，结算伤害与灵炁消耗。由 `QingheController.update` 每帧 `tick(dt, ctx)` 调用，**先于**形态 tick，避免门控延迟一帧。
- `Damageable.ts`：可受击组件（敌人 / Boss / 可破坏物统一挂载），只管「血量 + 受击 + 死亡」，敌人 AI 不含在内。
- `MistShot.ts`：灵雾态灵弹，沿方向飞行，命中 `Damageable` 后自毁。
- `HitSpark.ts`：命中火花，短命灰盒特效（放大 + 淡出后自毁），不参与任何伤害结算。

**运行时新建碰撞体的硬约束（改之前务必读）**：

- `BoxCollider2D` 的 `size` / `offset` setter **只存值，不重建 Box2D 夹具**。
  设完**必须调 `col.apply()`**，否则物理世界里一直是字段默认的 `Size(1,1)`
  —— 一个 1×1 像素的碰撞体，角色直接穿过去。场景里序列化好的碰撞体没这问题，
  **只有运行时 `new Node()` + `addComponent` 的才会踩**。
- 更坑的是 **`col.size` 和 `col.worldAABB` 都会骗人**：两者都是从 JS 字段算的，
  夹具是 1×1 也照样报「3200×80」。所以排查碰撞**不能用几何读数**，
  要用行为判据（例如每秒打一次角色 y，看它是否稳住）。

命中判定的两个硬约束（改之前务必读）：
- **`AttackHitBox` 的 `BoxCollider2D.offset` 必须保持 `(0,0)`** —— 左右镜像只翻**节点位置**，offset 不跟着翻。
  `CombatController.onLoad` 会把 offset 折进节点位置并归零做兜底，但别在 Inspector 里设 offset。
- **`AttackHitBox` 的 `RigidBody2D` 类型必须是 `Animated`，且 `allowSleep = false`** ——
  `Static` 的 fixture 不跟随节点移动；`Dynamic` 会休眠而休眠后 Box2D 不评估接触。
  两者都会导致**攻击"时灵时不灵"**。

### `ui/` —— 界面

- `TitleScreen.ts`：首页（`assets/Scene/Title.scene` 的唯一组件）。背景暗角 / 标题 / 菜单 / 灵炁光点 / 子面板调度全在这里，
  版式常量集中在文件顶部。三段状态机：`Prompt`（按任意键继续）→ `Menu`（五项竖排）→ `Panel`（子面板打开）。
  **进菜单时会请求全屏**（`TitleScreen.requestFullScreen()`）——浏览器要求全屏必须由用户交互触发，
  所以放在 `enterMenu()`（玩家第一次按键/点击的回调）里，不能放 `onLoad`；原生上
  `screen.supportsFullScreen` 恒为 false，会自己跳过。
  **子面板的返回键是 E 不是 ESC**（`PANEL_BACK_KEY`）：Web 全屏时 ESC 归浏览器管（退出全屏）。
- `TitleSubPanels.ts`：首页的设置 / 成就 / 制作组三个面板的**框架**，**普通工具类**（非 Component），由 TitleScreen new 出来。
  只管底板、宣纸、标题、返回提示、开关与命中判定；具体内容归各自的文件（见下）。
  面板贴图（宣纸九宫格 / 卷轴）在场景里以**隐藏模板节点**的形式存在，代码克隆出来用——
  它们不在 `resources/` 下，没法 `resources.load`。
  - **设置页已实现**（见 `SettingsPanel.ts`）；**成就页仍是占位**（成就系统还没写）。
  - ⚠️ 制作组名单在 `CREDITS` 常量里（已填 8 人）。其中「䴰」(U+4D30) **不在 `font.ttf` 里**，
    所以那一列名字改用系统字体（`label.font = null`）—— 挂毛笔体会静默掉字、把名字写错。
    加名字前先确认字形在不在，字体文件补上后把那句删掉即可。
- `SettingsPanel.ts`：设置页内容（音量 / 键位两个页签），同样是**普通工具类**，由 `TitleSubPanels` new。
  它只是把 `audioManager` / `inputSystem` 已有的链路接到界面上，自己不存状态。
  改键要配 `inputSystem.setCaptureMode()`（用完必须退出，否则整个动作层失灵）；
  接口与踩过的坑见 `docs/设置页接口.md`。`PanelDeps.ts` 是它和面板框架共用的依赖注入接口（单独放以免两个文件互相 import）。
- `DebugHud.ts`：左上角调试 HUD，显示**灵炁条 / 当前形态 / 敌人血量**这三样测试中最"看不见"的数据。
  整个 UI 在 `onLoad` 里用代码搭（挂到 `Canvas/DebugHud` 即可，无需在 Inspector 连引用），
  血条底图从 `assets/resources/white.png` 运行时加载。**正式 UI 做好后整个文件删掉。**

### `enemy/` —— 敌人

- `EnemyAI.ts`：小怪 FSM（巡逻 → 发现 → 追击 → 攻击 → 死亡）+ 一层优先级更高的受击硬直。
  ⚠️ **它不是行为树**，是手写扁平状态机 —— 设计文档里画的是行为树，落地的是 FSM。
  全 private、无基类，**Boss 无法继承，只能另写并抄它的模式**。
  数值全部来自 `gameConfig.enemy`（全局单例，**不给单实例配**）。
- `boss/`：`BossP1AI.ts`（九尾狐 P1「幻影」）+ `BossClone.ts`（分身标记）。
  Boss 的真身永远是挂 `BossP1AI` 的根节点，另两个是程序化建的诱饵。
  开打时机由 `world/LevelDirector` 决定（`autoStart` 要关掉）。

### `fx/` —— 序列帧播放（美术组给的视频素材）

- `SequencePlayer.ts`：播 `assets/Resources/video_fx/` 下的图集序列。
  **滑动窗口页缓存**——只驻留播放头附近的页，播过的 `decRef`。九段素材合计
  15.8 亿像素（原规格），全量常驻显存不可能，必须流式。
- `StageTransition.ts`：全屏转场叠层（压暗 → 播动画 → 推进阶段）。**不复用 `ui/ScreenStage`**
  （那是整页场景组件，契约不同）。

### `world/` —— 关卡与镜头

- `ParallaxBackground.ts`：视差卷轴背景。核心一行 `node.x = cameraX * (1 - factor)`。
  图层宽度由相机行程反推：`viewW + factor × 行程`，少给会在关卡末尾露空。
- `CameraFollow.ts`：直接移动 `Canvas/Camera` 实现横版跟随（**不是**移动世界根节点，
  那样会和玩家刚体打架）。代价是 HUD 会被推走，所以屏幕固定的东西要挂 `ScreenFixed`。
- `ScreenFixed.ts`：把节点钉在屏幕上，反向补偿相机位移。
- `LevelDirector.ts`：按「关卡总览」的段落顺序推进，并搭出关卡几何与道具。

### `puzzle/` `audio/`

`audio/` 已有 `AudioManager.ts`；`puzzle/` 仍是空目录。敌人设计见
`logs/B/《云岫》敌人行为树设计文档/`。灵界屏障 / 机关 / 灵泉的**贴图**已在
`assets/Resources/场景小物件/`，但触发逻辑还没写。

## 素材流水线（美术组的视频 → 引擎）

美术组交来的是**视频**（`assets/Resources/视频合集/`），引擎要的是**图集序列**。
三步，都在 `art-source/_tools/`：

```bash
cd art-source/_tools
python gen_video_fx.py --export      # 视频 → PNG 序列（抠背景 / 接循环 / 主体等大）
python pack_atlas.py --scale 0.5     # 序列 → 图集页 + 索引，落到 assets/Resources/video_fx/
python extract_arrow.py              # 特例：从攻击动画里抽独立抛射物（见该文件注释）
```

关键约定：

- **原始序列永远留在 `art-source/_video_out/`**，缩放放在打包阶段（`--scale`）。
  换倍率只需重跑 `pack_atlas.py`，不必回视频重新抽帧。
- `SequencePlayer` 在运行时按 `manifest.json` 取帧，播放器不关心布局。
- ⚠️ **`--scale` 一改，`BossP1AI.artScale` 要成比例改** —— 它乘的是打包后的帧尺寸。
  倍率 1.0 时帧是 768²，取 0.6；倍率 0.5 时帧是 384²，要取 1.2。
- ⚠️ **别按原规格全量导入**：723 页、5.89GB 会把编辑器的 WebGL 上下文搞崩。
- ⚠️ **`.webm` 不被识别为 `cc.VideoClip`**（只认 `.mp4`），而 Web 上能带 alpha 的
  只有 VP9/WebM —— 所以**透明视频这条路走不通**，全屏过场只能用 PNG 序列。

## 操作与关键玩法事实

- 青禾：A/D 或 ←/→ 移动，Space 跳跃（二段跳），K 踏云闪（冲刺，**需已起跳**），J 轻击 / 蓄力重击（按住），L 格挡（按住）。
- 灵伴形态切换：F 实体 ↔ 灵雾，G 灵雾 → 灵合 / 灵合 → 实体。
- 完整自测步骤与各动作的预期数值见 `logs/B/功能自测清单.md`。
- 灵炁为唯一资源（初始上限 100），三种灵伴形态各有每秒消耗与触发条件，见 `GameConfig.spirit` 与 `Cloud Eyrie.md` 3.2 节。
- 战斗定位「青禾输出 + 莹翳辅助」；敌人分阳浊（物理可伤）与阴浊（需莹翳灵炁显形后才能补刀）。

## 约定

### Git（见 `gitrules.md`）

- Commit message 格式：`<type>: <内容>`，type 用 `feat` / `fix` / `docs` / `refactor` / `perf` / `chore` 等常规前缀。
- 流程：开发前 `git pull --rebase origin main` → 多次 commit → 推送前再次 `git pull --rebase origin main` → `git push origin main`。

### 文字与字体

- 游戏字体是 `assets/resources/font.ttf`（`chengrongguangke`，毛笔行楷），运行时用 `resources.load('font', Font)` 挂到 `Label.font`。
- ⚠️ **这份字体缺少「炁」(U+7081)** —— 游戏的核心名词「灵炁」用它会掉字。
  首页文案已避开该字；**写任何要挂这个字体的 UI 文案前先确认没有「炁」**，否则得改用系统字体或换字体文件。

### 编码风格（见 `.editorconfig`）

- 4 空格缩进、LF 行尾、UTF-8；`*.json` / `*.meta` 用 2 空格；`*.ts` 结尾加换行并去掉行尾空格。

## 设计文档位置

项目文档统一在 `docs/`：

- `docs/Cloud Eyrie.md`：完整 GDD（世界观、剧情四幕、玩法机制、战斗/解谜/美术/音频）。
- `docs/大赛规划v2.0（17天版）.md`：2026 数智链大赛参赛雏形的 17 天排期与验收标准（**当前主计划**）。
- `docs/进度追踪.md`：**逐日进度对照**（D1–D17 实际状态）、当前可玩内容、主要缺口与建议下一步。开工前先看这份。
- `docs/计划-代码对照.md`：计划术语 ↔ 代码命名对照表、战斗数值对照、**已知的坑**。
- `docs/组会纪要/`：工作室会议纪要。
- `docs/旧版计划/`：`yunxiu-full-plan.html`、`yunxiu-phase1-tasks.html`（已被 v2.0 取代，留档）。
- `docs/gitrules.md`：Git 提交规范。

其它目录：

- `logs/`：团队开发日志，按成员 A/B/C/D 分子目录；`logs/B/2026_08_*.md` 记录了脚本分层约定等决策，行为树设计文档也在 B 目录下。`logs/B/功能自测清单.md` 是当前功能的自测步骤与预期数值。
- `art-source/`：美术组交来的**原始素材**（打印级分辨率，如 A4 竖版立绘）。**不要放进 `assets/`**——Cocos 会把 `assets/` 下所有图都导入并生成 meta，造成重复占显存。进引擎的游戏分辨率版本在 `assets/Textures/`。
