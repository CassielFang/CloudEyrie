import {
    _decorator, Node, Sprite, Label, UITransform,
    UIOpacity, Color, Graphics, input, Input, EventKeyboard,
    EventMouse, screen, tween,
} from 'cc';
import { EDITOR } from 'cc/env';
const { ccclass } = _decorator;

import { sceneManager } from '../core/SceneManager';
import { GameAction } from '../core/InputActions';
import { inputSystem } from '../core/InputSystem';
import { SubPanelKind, TitleSubPanels } from './TitleSubPanels';
import { COLOR_GLOW, COLOR_SUB, COLOR_TITLE, PANEL_BACK_KEY, ScreenStage } from './ScreenStage';

/**
 * 游戏首页（`assets/Scene/Title.scene` 的唯一组件）。
 *
 * 场景里只放「背景 / 暗角 / 三个模板节点 / 这个组件」，标题、分隔线、菜单、
 * 子面板全部在 `onLoad` 里用代码搭 —— 沿用 `ui/DebugHud.ts` 定下的约定
 * （UI 用代码搭，不在 Inspector 连引用），改版式只要动这个文件顶部的常量。
 *
 * 三个模板节点是**取贴图的通道**：面板和光点的贴图不在 `assets/resources/` 下，
 * 没法 `resources.load`，所以先在场景里摆一个挂好 spriteFrame 的节点、设成
 * `active = false`，运行时 `instantiate` 克隆出来用。
 *
 * 阶段
 * ----
 * Prompt  标题淡入，「按任意键继续」呼吸闪烁 → 任意键 / 点击进入 Menu
 * Menu    五个菜单项错峰淡入，↑↓ 选择、Enter 确认、鼠标悬停即选中
 * Panel   子面板打开，菜单整体压暗；E 或点面板外返回 Menu
 */

enum Stage { Prompt, Menu, Panel }

const COLOR_ITEM = new Color(168, 196, 208, 255);
const COLOR_ITEM_SEL = new Color(236, 250, 255, 255);
const COLOR_RULE = new Color(150, 210, 225, 200);
const COLOR_DIAMOND = new Color(198, 242, 252, 240);

/** 版式（单位 = 设计像素，原点在画布中心，y 向上）。改这里就能挪位置。 */
const LAYOUT = {
    titleY: 168,
    ruleY: 96,
    ruleHalfLen: 180,
    subY: 62,
    menuTopY: -10,
    menuGap: 56,
    promptBottomMargin: 62,
};

const MENU_LABELS = ['开始游戏', '设　置', '成　就', '退　出', '制作组'];
const MENU_KINDS: (SubPanelKind | null)[] = [null, 'settings', 'achievements', null, 'credits'];

/**
 * 「开始游戏」要跳的场景名。
 *
 * ⚠️ 关卡现在是 `BossTest.scene`（从 `main.scene` 复制出来重做的版本）——
 * `main.scene` 还是旧的单屏灰盒。等关卡定型后应当把新关卡改名为 `main`
 * 并把这里改回去，现在先直连。
 */
const GAME_SCENE = 'BossTest';

/** 「退出」先去结束页（`assets/Scene/Ending.scene`），真正的退出动作在那边做 */
const ENDING_SCENE = 'Ending';

interface MenuItem {
    node: Node;
    label: Label;
    glow: UIOpacity | null;
    labelNode: Node;
}

@ccclass('TitleScreen')
export class TitleScreen extends ScreenStage {

    private stage = Stage.Prompt;
    /** 进入当前阶段后经过的秒数，用于错峰淡入 */
    private stageTime = 0;
    private time = 0;

    private contentRoot: Node | null = null;
    private titleNode: Node | null = null;
    private titleGlow: Node | null = null;
    private titleGlowOpacity: UIOpacity | null = null;
    private subNode: Node | null = null;
    private promptNode: Node | null = null;
    private promptOpacity: UIOpacity | null = null;
    private contentOpacity: UIOpacity | null = null;

    private menuItems: MenuItem[] = [];
    private selected = 0;
    /**
     * 刚进菜单的那一帧不吃菜单按键。
     *
     * 必须要有：Prompt 阶段的「任意键」是在**事件里当场处理**的（`onKeyDown`），
     * 而动作层的 `wasPressed` 要到**下一帧**才读得到。玩家按回车进菜单时，
     * 这一按会同时把 `MenuConfirm` 置位 —— 若不挡掉，同一帧就会把第一项也确认了，
     * 表现为「一按回车直接开始游戏、菜单一闪而过」。
     */
    private swallowMenuInput = false;

    private wispLayer: Node | null = null;

    private panels: TitleSubPanels | null = null;

    /** 每帧做颜色插值的临时对象，避免逐帧 new Color */
    private scratch = new Color();

    // ============================================================ 生命周期

    protected onLoad(): void {
        this.setupStage();
        this.wispLayer = this.makeNode('WispLayer', this.node);

        this.buildContent();
        this.buildWisps(this.wispLayer);
        this.loadFont();

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
    }

    protected onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        // 子面板的内容对象往 eventBus 上挂过订阅，而 eventBus 活得比场景久 ——
        // 不摘的话切场景后设置一变还会回调到已销毁的节点上。
        // 顺带兜住「面板还开着就切场景」时没收掉的改键捕获模式。
        if (this.panels) {
            this.panels.dispose();
        }
    }

    // ============================================================ 搭建

    private buildContent(): void {
        const root = this.makeNode('ContentRoot', this.node);
        this.contentRoot = root;
        this.contentOpacity = root.addComponent(UIOpacity);
        this.contentOpacity.opacity = 0;

        // ---- 标题背后的柔光（克隆光点模板，横向拉伸成一片光晕）----
        const glow = this.cloneTemplate('WispTemplate', 'TitleGlow', root);
        if (glow) {
            glow.active = true;
            this.fit(glow, 900, 460);
            glow.setPosition(0, LAYOUT.titleY - 20, 0);
            const sp = glow.getComponent(Sprite);
            if (sp) { sp.color = COLOR_GLOW; }
            this.titleGlow = glow;
            this.titleGlowOpacity = glow.getComponent(UIOpacity) ?? glow.addComponent(UIOpacity);
            this.titleGlowOpacity.opacity = 130;
        }

        // ---- 标题 ----
        const title = this.makeNode('Title', root);
        this.titleNode = title;
        this.makeLabel('TitleText', title, '云 岫', 130, COLOR_TITLE, 0);
        title.setPosition(0, LAYOUT.titleY, 0);

        // ---- 分隔线 + 菱形（Graphics 画，不用贴图）----
        const rule = this.makeNode('Rule', root);
        rule.addComponent(UITransform);
        rule.setPosition(0, LAYOUT.ruleY, 0);
        this.drawRule(rule, LAYOUT.ruleHalfLen);

        // ---- 英文副标题 ----
        const sub = this.makeNode('SubTitle', root);
        this.subNode = sub;
        this.makeLabel('SubText', sub, 'C L O U D   E Y R I E', 25, COLOR_SUB, 2);
        sub.setPosition(0, LAYOUT.subY, 0);

        // ---- 菜单 ----
        for (let i = 0; i < MENU_LABELS.length; i += 1) {
            this.menuItems.push(this.buildMenuItem(root, i));
        }

        // ---- 按任意键继续 ----
        const prompt = this.makeNode('Prompt', root);
        this.promptNode = prompt;
        this.makeLabel('PromptText', prompt, '按 任 意 键 继 续', 25, COLOR_SUB, 2);
        this.promptOpacity = prompt.addComponent(UIOpacity);

        this.layout();

        this.panels = new TitleSubPanels(this.node, {
            makeLabel: (parent, name, text, size, color, outline) =>
                this.makeLabel(name, parent, text, size, color, outline),
            clone: (templateName, name, parent) => this.cloneTemplate(templateName, name, parent),
        });
    }

    private buildMenuItem(parent: Node, index: number): MenuItem {
        const node = this.makeNode(`Menu${index}`, parent);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(320, LAYOUT.menuGap);
        node.setPosition(0, LAYOUT.menuTopY - index * LAYOUT.menuGap, 0);

        // 选中时背后透出的辉光
        const glow = this.cloneTemplate('WispTemplate', 'ItemGlow', node);
        let glowOpacity: UIOpacity | null = null;
        if (glow) {
            glow.active = true;
            this.fit(glow, 320, 96);
            const sp = glow.getComponent(Sprite);
            if (sp) { sp.color = COLOR_GLOW; }
            glowOpacity = glow.addComponent(UIOpacity);
            glowOpacity.opacity = 0;
        }

        const labelNode = this.makeNode('Text', node);
        const label = this.makeLabel('Label', labelNode, MENU_LABELS[index], 40, COLOR_ITEM, 2);
        const lo = labelNode.addComponent(UIOpacity);
        lo.opacity = 0;

        const item: MenuItem = { node, label, glow: glowOpacity, labelNode };

        // 鼠标：悬停即选中，点击即确认
        node.on(Node.EventType.MOUSE_ENTER, () => {
            if (this.stage === Stage.Menu) { this.select(index); }
        }, this);
        node.on(Node.EventType.MOUSE_DOWN, () => {
            if (this.stage === Stage.Menu) { this.select(index); this.confirm(); }
        }, this);

        // ⚠️ Prompt 阶段菜单是隐形的，**节点也必须失活**，光靠透明度 0 不够：
        // 引擎的 UI 派发器一旦被某个节点「处理」了事件，就会 `break` 掉整条派发链
        // （`PointerEventDispatcher.dispatchEventMouse`），活着的节点会把这一片的点击
        // 吞掉，全局的 `input.on(MOUSE_DOWN)` 收不到 —— 表现就是「按任意键继续」时
        // 点到**中间那条菜单带**（5 项首尾相接，320×280）毫无反应，其他地方正常。
        // 失活节点不吞事件：节点 active 一变，引擎就会 `eventProcessor.setEnabled(active)`
        //（`scene-graph/node.ts:2181`）。进菜单时由 `enterMenu()` 激活。
        node.active = false;

        return item;
    }

    // ============================================================ 布局

    /** 基类铺背景/暗角/内容缩放，这里再补上「按任意键继续」贴底。 */
    private layout(): void {
        this.layoutStage(this.contentRoot);
        if (this.promptNode) {
            const vis = this.visibleSize();
            this.promptNode.setPosition(0, -vis.height / 2 + LAYOUT.promptBottomMargin, 0);
        }
    }

    // ============================================================ 输入

    private onKeyDown(e: EventKeyboard): void {
        if (!this.ready) {
            return;
        }
        if (this.stage === Stage.Prompt) {
            this.enterMenu();
            return;
        }
        if (this.stage === Stage.Panel) {
            // 先问面板内容要不要这个键：设置页改键时 E 是「取消改键」，
            // 不先问一声就会被这里直接踢出面板。
            if (this.panels && this.panels.handleKeyDown(e)) {
                return;
            }
            // 面板的返回键是 **E 而不是 ESC**（理由见 `PANEL_BACK_KEY` 的定义）。
            // 仍读原始按键、不走动作层 —— 它是「取消/返回」这类系统级语义，没有重映射的必要。
            if (e.keyCode === PANEL_BACK_KEY) {
                this.closePanel();
            }
            return;
        }
        // 菜单阶段的选择/确认不在这里处理：改由 updateMenuInput() 每帧读动作层，
        // 这样键位重映射对菜单同样生效（见那里对 swallowMenuInput 的说明）。
    }

    /**
     * 菜单导航。走动作层而不是原始按键，重映射后菜单也跟着变。
     *
     * 每帧由 `update()` 调用；`wasPressed` 只在按下的那一帧为 true，所以长按不会连发。
     */
    private updateMenuInput(): void {
        if (!this.ready || this.stage !== Stage.Menu) {
            return;
        }
        if (this.swallowMenuInput) {
            // 刚进菜单的那一帧：挡掉，理由见字段声明处
            this.swallowMenuInput = false;
            return;
        }
        if (inputSystem.wasPressed(GameAction.MenuUp)) {
            this.select(this.selected - 1);
        }
        if (inputSystem.wasPressed(GameAction.MenuDown)) {
            this.select(this.selected + 1);
        }
        if (inputSystem.wasPressed(GameAction.MenuConfirm)) {
            this.confirm();
        }
    }

    private onMouseDown(e: EventMouse): void {
        if (!this.ready) {
            return;
        }
        // 菜单里点空白处不该误触发，只有 Prompt 阶段用「任意输入」推进
        if (this.stage === Stage.Prompt) {
            this.enterMenu();
            return;
        }
        // 面板阶段点面板外返回。Esc 只有键盘有，鼠标用户得给条退路。
        if (this.stage === Stage.Panel && this.panels && !this.panels.hitTest(e.getUILocation())) {
            this.closePanel();
        }
    }

    // ============================================================ 阶段切换

    private enterMenu(): void {
        this.stage = Stage.Menu;
        this.stageTime = 0;
        // 菜单项在 Prompt 阶段是失活的（理由见 buildMenuItem），进菜单才激活。
        // 激活后它们的 MOUSE_* 监听才会生效，也才会开始「吞」点击 —— 那正是菜单要的。
        for (const item of this.menuItems) {
            item.node.active = true;
        }
        this.requestFullScreen();
        // 按下「任意键」的那一下也会把 MenuConfirm 置位，挡掉下一帧的菜单读取
        this.swallowMenuInput = true;
        if (this.promptNode) {
            const op = this.promptOpacity;
            if (op) {
                tween(op).to(0.35, { opacity: 0 }).call(() => {
                    if (this.promptNode) { this.promptNode.active = false; }
                }).start();
            }
        }
    }

    private select(index: number): void {
        const n = this.menuItems.length;
        if (n === 0) {
            return;
        }
        // 循环选择，上下走到底会绕回去
        this.selected = ((index % n) + n) % n;
    }

    /**
     * Web 上请求全屏（「启动游戏后全屏」就是这个）。
     *
     * **必须落在用户交互里**：浏览器规定全屏只能由用户手势触发，否则报
     * `API can only be initiated by a user gesture`。所以不能放 `onLoad` ——
     * 放在 `enterMenu()` 里正好，它是玩家第一次按键/点击的回调。
     * （引擎内部有兜底：首次失败会在下一次**触摸**事件时自动重试。但别指望它 ——
     * 那个重试只认触摸，玩家第一次是按键盘的话根本不会触发。）
     *
     * 两种情况直接跳过：
     * - **原生**（Windows 构建）：`supportsFullScreen` 恒为 false，引擎在原生上硬编码 reject。
     * - **编辑器**：Game View 是 Electron `<webview>`，进不了全屏，调了只会白刷一条错误日志。
     *   浏览器预览不受影响（那时 `EDITOR` 为 false），所以全屏能在浏览器预览里验。
     *
     * 失败时引擎自己会打一条 error 日志（它内部 catch 了），这里不用再处理。
     */
    private requestFullScreen(): void {
        if (EDITOR || !screen.supportsFullScreen || screen.fullScreen()) {
            return;
        }
        void screen.requestFullScreen();
    }

    private confirm(): void {
        const item = this.menuItems[this.selected];
        if (!item) {
            return;
        }
        const kind = MENU_KINDS[this.selected];
        if (kind) {
            this.openPanel(kind);
            return;
        }
        if (this.selected === 0) {
            sceneManager.loadScene(GAME_SCENE);
            return;
        }
        this.quit();
    }

    private openPanel(kind: SubPanelKind): void {
        if (!this.panels) {
            return;
        }
        this.stage = Stage.Panel;
        this.stageTime = 0;
        this.panels.open(kind);
        if (this.contentOpacity) {
            tween(this.contentOpacity).to(0.3, { opacity: 90 }).start();
        }
    }

    private closePanel(): void {
        if (!this.panels || !this.panels.isOpen) {
            return;
        }
        this.panels.close();
        this.stage = Stage.Menu;
        this.stageTime = 0;
        if (this.contentOpacity) {
            tween(this.contentOpacity).to(0.3, { opacity: 255 }).start();
        }
    }

    /**
     * 「退出」不在这里真退，而是切到结束页 `Ending.scene`。
     *
     * 好处是切场景会把首页和关卡的资源、正在跑的逻辑全部卸干净，
     * 退出动作落在一个干净的空场景里执行 —— 不会在游戏逻辑还在跑的时候把进程掐掉。
     * 真正的退出代码在 `EndingScreen` 里。
     */
    private quit(): void {
        sceneManager.loadScene(ENDING_SCENE);
    }

    // ============================================================ 每帧

    protected update(dt: number): void {
        this.time += dt;
        this.stageTime += dt;

        this.layout();
        this.updateBackdrop(this.time);
        this.updateWisps(dt, this.time);
        this.updateContent(dt);
        this.updateMenuInput();
    }

    private updateContent(dt: number): void {
        if (!this.ready) {
            return;
        }
        // 入场：整体淡入
        if (this.contentOpacity && this.stage !== Stage.Panel && this.contentOpacity.opacity < 255) {
            this.contentOpacity.opacity = Math.min(255,
                this.contentOpacity.opacity + dt * 220);
        }

        // 标题缓慢浮动 + 背后柔光呼吸
        if (this.titleNode) {
            this.titleNode.setPosition(
                this.titleNode.position.x,
                LAYOUT.titleY + Math.sin(this.time * 0.8) * 6,
                0);
        }
        if (this.titleGlowOpacity) {
            this.titleGlowOpacity.opacity = 110 + Math.round(45 * (0.5 + 0.5 * Math.sin(this.time * 1.1)));
        }

        // 菜单项错峰淡入
        for (let i = 0; i < this.menuItems.length; i += 1) {
            const item = this.menuItems[i];
            const shown = this.stage !== Stage.Prompt;
            const k = shown ? Math.min(1, Math.max(0, (this.stageTime - i * 0.08) / 0.4)) : 0;
            const eased = 1 - (1 - k) * (1 - k);

            const lo = item.labelNode.getComponent(UIOpacity);
            if (lo) {
                lo.opacity = Math.round(255 * eased);
            }
            item.labelNode.setPosition(0, (1 - eased) * -14, 0);

            const isSel = i === this.selected;
            const targetScale = isSel ? 1.06 : 1.0;
            const cur = item.node.scale.x;
            const ns = cur + (targetScale - cur) * Math.min(1, dt * 14);
            item.node.setScale(ns, ns, 1);

            // 逐帧插值而不是 tween：快速连按时 tween 会互相打断，用插值更跟手
            const kin = Math.min(1, dt * 12);
            Color.lerp(this.scratch, item.label.color,
                isSel ? COLOR_ITEM_SEL : COLOR_ITEM, kin);
            item.label.color = this.scratch;

            if (item.glow) {
                const target = (isSel && shown) ? 235 * eased : 0;
                item.glow.opacity += (target - item.glow.opacity) * Math.min(1, dt * 10);
            }
        }

        // 「按任意键继续」呼吸
        if (this.stage === Stage.Prompt && this.promptOpacity) {
            this.promptOpacity.opacity = Math.round(150 + 95 * (0.5 + 0.5 * Math.sin(this.time * 2.2)));
        }
    }

}
