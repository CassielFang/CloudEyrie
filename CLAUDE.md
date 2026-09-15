# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

《云岫》(CloudEyrie / Yunxiu) —— 2D 横版动作解谜 + 情感叙事向独立游戏，对标《NEVA》。核心机制是「灵炁共生」：主角青禾与灵伴莹翳（代码里叫 Yingyi，设计文档早期称「白駠」）共享同一条灵炁资源条，通过三种形态切换（实体随行 / 灵雾 / 灵合）来解谜与战斗。

技术栈：**Cocos Creator 3.8.8 + TypeScript**，启用 2D 物理（Box2D）、Spine/dragon-bones 动画、自定义渲染管线。项目完全在 Cocos Creator 编辑器内开发与运行。

## 开发与运行

- **没有 CLI 构建 / lint / 测试命令**。`package.json` 无 scripts，仓库内无测试。代码通过 Cocos Creator 3.8.8 编辑器打开、预览与构建。
- 改 `.ts` 脚本后由编辑器自动编译；改 `.scene` / `.prefab` 只能在编辑器里操作（或按 Cocos 序列化格式手改，风险高，通常不推荐）。
- `*.meta` 文件由编辑器自动生成并维护（记录资源 UUID 与导入配置），**不要手改或删除**。
- 唯一的场景是 `assets/Scene/main.scene`，内含一个常驻 `GameManager` 节点（`director.addPersistRootNode`）和一个 `Canvas`。

## 架构

`assets/Scripts/` 下按功能分目录。日志 `logs/B/2026_08_22.md` 记录了团队的脚本分层约定：所有 TS 文件分三类——**Component**（用 `@ccclass` 标注、必须挂到 Node 上由引擎驱动完整生命周期）、**普通 TS 工具类**、**Data/Config 配置类**。

### `core/` —— 全局系统（引擎无关，全部为单例）

- `EventBus.ts`：发布/订阅事件总线，模块级单例 `eventBus`（`on` / `off` / `emit` / `clear`）。跨系统解耦统一走它，事件名如 `spirit-energy-changed`、`spirit-energy-depleted`。
- `GameConfig.ts`：**数值调参的唯一来源**。模块级可变单例 `gameConfig`（`gameConfig.spirit.*` / `gameConfig.tide.*`）是运行时读值入口；`@ccclass('GameConfig')` 组件挂载在常驻 GameManager 节点上，用 `@property` 暴露全部参数（Inspector 可调），`onLoad` 时把 Inspector 值同步进 `gameConfig` 并广播 `game-config-ready`。默认值即 week1 v1 参数表，改参在 Inspector 里做，不要在 Controller 硬编码。
- `SpiritEnergySystem.ts`：灵炁共享池（模块级单例 `spiritEnergySystem`）。v1 模型：实体态按动作消耗，恢复分战斗/非战斗两档 × 灵脉潮汐倍率，灵泉内速率恢复。惰性读取 `gameConfig`（勿缓存 `max`），`setInCombat` / `setTideRegenMult` / `setInSpring` 控制恢复档位，数值变更经 EventBus 广播。
- `GameManager.ts`：`static getInstance()` + `onLoad` 防重复创建 + 跨场景常驻。当前是全局初始化入口，内含 EventBus / 灵炁系统的冒烟测试代码。
- `SceneManager.ts`：对 `director.loadScene` 的薄封装（模块级单例 `sceneManager`）。

**单例约定**：工具类用模块级 `export const xxx = new Xxx()`（EventBus、SpiritEnergySystem、SceneManager）；需要挂节点/参与生命周期的用 `@ccclass` + 静态 `getInstance()`（GameManager）。

### `character/` —— 角色

- `QingheController.ts`：青禾玩家控制器的「实体外壳」——物理（`RigidBody2D`/`BoxCollider2D`）、输入读取、近战攻击（子节点 `AttackHitBox` 碰撞器开关判定）。**不含形态移动逻辑**，而是委托给 `forms/` 状态类。
- `CompanionStateMachine.ts`：灵伴三形态状态机的「中枢」——管当前形态、状态转换规则、切换硬直、灵合冷却/休眠、强制切雾，经 `companion-form-changed` 事件广播。持有 `Map<CompanionForm, ICompanionForm>`，每帧由 QingheController 调 `tick(dt, ctx)` 委托「移动 + 灵炁消耗」给当前形态状态类。
- `forms/`：**状态模式**——`ICompanionForm` 接口 + `FormContext` 共享上下文（刚体/输入/朝向/着地）+ `EntityForm`/`MistForm`/`MergeForm` 三个形态状态类，各自内聚移动与灵炁消耗。加新形态 = 加一个状态类并在中枢 map 注册，不碰现有代码。
- `YingyiController.ts`、`CharacterInput.ts`：**当前是空壳**（仅 `start` / `update` 占位）。

### `combat/` `enemy/` `puzzle/` `ui/` `audio/`

预留目录，目前只有 `.meta` 占位，尚未实现。敌人 AI 采用行为树方案，设计见 `logs/B/《云岫》敌人行为树设计文档/`（阳浊/阴浊两类敌人，黑板书 `IsVisible` 显形状态等）。

## 操作与关键玩法事实

- 青禾：A/D 或 ←/→ 移动，Space 跳跃（二段跳），J 攻击，K 冲刺。
- 灵炁为唯一资源（初始上限 100），三种灵伴形态各有每秒消耗与触发条件，见 `GameConfig.spirit` 与 `Cloud Eyrie.md` 3.2 节。
- 战斗定位「青禾输出 + 莹翳辅助」；敌人分阳浊（物理可伤）与阴浊（需莹翳灵炁显形后才能补刀）。

## 约定

### Git（见 `gitrules.md`）

- Commit message 格式：`<type>: <内容>`，type 用 `feat` / `fix` / `docs` / `refactor` / `perf` / `chore` 等常规前缀。
- 流程：开发前 `git pull --rebase origin main` → 多次 commit → 推送前再次 `git pull --rebase origin main` → `git push origin main`。

### 编码风格（见 `.editorconfig`）

- 4 空格缩进、LF 行尾、UTF-8；`*.json` / `*.meta` 用 2 空格；`*.ts` 结尾加换行并去掉行尾空格。

## 设计文档位置

- `Cloud Eyrie.md`：完整 GDD（世界观、剧情四幕、玩法机制、战斗/解谜/美术/音频）。
- `yunxiu-full-plan.html`、`yunxiu-phase1-tasks.html`：完整计划与一期任务拆解。
- `logs/`：团队开发日志，按成员 A/B/C/D 分子目录；`logs/B/2026_08_*.md` 记录了脚本分层约定等决策，行为树设计文档也在 B 目录下。
