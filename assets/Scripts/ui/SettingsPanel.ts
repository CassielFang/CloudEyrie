import {
    Color, EventKeyboard, EventTouch, Graphics, KeyCode, Label, Node,
    Sprite, SpriteFrame, UITransform, Vec3, error, resources, warn,
} from 'cc';

import { audioManager } from '../audio/AudioManager';
import { eventBus } from '../core/EventBus';
import { SettingsChangedEvent } from '../core/GameSettings';
import { ACTION_LABELS, ALL_ACTIONS, GameAction, bindingLabel, key, sameBinding } from '../core/InputActions';
import { inputSystem } from '../core/InputSystem';
import { COLOR_PANEL_INK, PANEL_BACK_KEY } from './ScreenStage';
import { PanelDeps } from './PanelDeps';

/**
 * 设置页的内容：音量 / 键位两个页签。
 *
 * 按项目的脚本分层约定，这是个**普通工具类**（不是 Component）：由 `TitleSubPanels`
 * 在 `buildSettings()` 里 new 出来，节点挂在它给的 Body 下，生命周期跟着面板走，
 * 引擎回调一个都不注册。
 *
 * 这一页只做一件事：**把已经存在的链路接到界面上**。音量走 `audioManager`（落盘与广播
 * 由 `gameSettings` 负责），键位走 `inputSystem`。UI 不直接碰 `gameSettings`，也不自己
 * 缓存任何状态 —— 每次渲染都从单例现读，所以切页签整个重建节点也不会丢状态。
 *
 * 交互一律鼠标（点页签 / 拖滑条 / 点键位格）。键盘只有两种：`PANEL_BACK_KEY`（E），
 * 以及改键时按下的那个键。
 * 见 `handleKeyDown`。
 *
 * ⚠️ 最要命的一点：改键期间 `inputSystem` 处于**捕获模式**，此时它不记录任何按键。
 * 忘了退出 = 游戏里按键全没反应。所以 `dispose()` 必须被调用（面板关闭 / 重建 / 场景卸载
 * 三处，见 `TitleSubPanels` 与 `TitleScreen.onDestroy`）。
 */

// ============================================================ 版式
// 面板局部坐标，原点在面板中心（PANEL_W=1000 / PANEL_H=620）。
// 上下墨线在 ±249 —— 九宫格切边（72px）不参与拉伸、按贴图原始像素画，
// 所以墨线落在距边 54~67px 处，不是按比例算出来的 37px。内容别越线。

const TAB_LABELS = ['音　量', '键　位'];
const TAB_X = [-110, 110];
const TAB_Y = 214;
const TAB_SIZE = 28;
const TAB_HIT_W = 200;
const TAB_HIT_H = 44;

/** 页签下的细横线；当前页签再压一小段亮色条标示选中 */
const RULE_Y = 186;
const RULE_W = 900;
const RULE_H = 2;
const MARK_W = 150;
const MARK_H = 4;

/**
 * 三行音量。行距给到 115 —— 这一页只有三行，行距小了会在下半边留一大块空白
 * （按钮固定在 `FOOT_Y`，两个页签不跳位，所以只能把行摊开）。
 */
const VOL_ROW_Y = [115, 0, -115];
const CAPTION_RIGHT_X = -220;
const SLIDER_X = 55;
const VALUE_LEFT_X = 320;
const VOL_TEXT_SIZE = 26;
const SLIDER_W = 420;
/** 命中盒比可见的槽高得多（6px 的线太难抓），点与拖都以它为准 */
const SLIDER_HIT_H = 44;
const TRACK_H = 6;
const KNOB_SIZE = 16;

/**
 * 键位页。**一趟 10 行（只列游戏内动作）、每行固定 2 个槽位**。
 *
 * 槽位列数固定而不是「有几个画几个」：方向键有 2 个绑定、其余只有 1 个 ——
 * 按实际数量画的话行与行参差不齐，读起来不像表格。列位固定、不足的留空。
 *
 * 菜单那三个动作（上移/下移/确认）**故意不列出来**：它们只在首页菜单里用，
 * 平时改不到，列出来只是占地方。它们仍在 `ALL_ACTIONS` 与存档里，`checkActionGroups`
 * 会盯着别漏（见那里的说明）。
 */
const KEY_ROW_TOP = 150;
const KEY_ROW_PITCH = 32;
const KEY_NAME_X = -252;
const KEY_NAME_W = 200;
const SLOT_X = [50, 190];
const SLOT_W = 124;
const SLOT_H = 22;
const KEY_TEXT_SIZE = 22;
const SLOT_TEXT_SIZE = 21;

/** 页脚。「恢复默认」按钮与改键提示共用这个位置，按状态二选一显示（不占两行） */
const FOOT_Y = -198;
const BTN_W = 220;
const BTN_H = 38;
const BTN_TEXT_SIZE = 24;
const FOOT_HINT_SIZE = 22;

const CAPTURE_HINT = '按下新键完成绑定，E 取消';

// ============================================================ 配色
// 面板底下垫了不透明的柔边底衬 + 纸面，字压的是浅色平面**而不是山水画**，
// 所以这里一律 outline=0 —— `makeLabel` 默认的描边 2 是给首页那种「浅色字压在
// 明暗不定的画上」用的，二十来号字配上去会糊出双层边、明显发脏。

const COLOR_TEXT = new Color(52, 76, 86, 255);
const COLOR_ACCENT = new Color(46, 116, 132, 255);
const COLOR_DIM = new Color(122, 144, 150, 255);
/** 唯一强调色，只给「正在改键 / 冲突」用 */
const COLOR_WARN = new Color(176, 88, 66, 255);
const COLOR_TRACK = new Color(120, 140, 146, 150);
const COLOR_FILL = new Color(96, 186, 206, 235);
const COLOR_KNOB = new Color(226, 248, 254, 255);
const COLOR_SLOT = new Color(206, 216, 218, 235);
const COLOR_SLOT_HOVER = new Color(224, 234, 236, 245);
const COLOR_SLOT_ACTIVE = new Color(238, 214, 190, 245);
const COLOR_RULE = new Color(140, 168, 176, 130);
const COLOR_BTN_INK = new Color(96, 120, 128, 235);
const COLOR_BTN_HOVER = new Color(122, 148, 156, 245);
const COLOR_BTN_EDGE = new Color(150, 178, 184, 235);
const COLOR_BTN_TEXT = new Color(238, 246, 248, 255);

/** 键位页会列出来的动作。数组顺序即显示顺序 */
const GROUP_GAME: GameAction[] = [
    GameAction.MoveLeft,
    GameAction.MoveRight,
    GameAction.MoveUp,
    GameAction.MoveDown,
    GameAction.Jump,
    GameAction.Dash,
    GameAction.Attack,
    GameAction.Block,
    GameAction.FormSwitch,
    GameAction.FormMerge,
];

/**
 * **故意不在设置页列出来**的动作（首页菜单的三个键）。
 *
 * 单独立一张表是为了让 `checkActionGroups()` 能发现「新加了动作却忘了归类」——
 * 那种情况的表象是「设置页里根本没有这一项」，不报错、很难发现。
 */
const GROUP_HIDDEN: GameAction[] = [
    GameAction.MenuUp,
    GameAction.MenuDown,
    GameAction.MenuConfirm,
];

/** 音量三行。存取直接绑到 `audioManager` 的方法上，渲染时按通道取值 */
const VOL_ROWS: { caption: string; get: () => number; set: (v: number) => void }[] = [
    {
        caption: '主音量',
        get: () => audioManager.getMasterVolume(),
        set: (v) => audioManager.setMasterVolume(v),
    },
    {
        caption: '音　乐',
        get: () => audioManager.getChannelVolume('bgm'),
        set: (v) => audioManager.setChannelVolume('bgm', v),
    },
    {
        caption: '音　效',
        get: () => audioManager.getChannelVolume('sfx'),
        set: (v) => audioManager.setChannelVolume('sfx', v),
    },
];

type Tab = 'audio' | 'bindings';

interface SliderRow {
    get: () => number;
    set: (v: number) => void;
    box: UITransform;
    fill: UITransform;
    knob: Node;
    value: Label;
}

interface CellRow {
    action: GameAction;
    index: number;
    label: Label;
    slot: Sprite;
}

export class SettingsPanel {

    private tab: Tab = 'audio';
    private disposed = false;

    /** 页签栏（切页签不重建，只换选中态） */
    private tabs: { label: Label; mark: Node }[] = [];
    /** 当前页签的内容根。切页签整个 destroy 重建 —— 状态全在单例里，重建即恢复 */
    private page: Node | null = null;

    private footBtn: Node | null = null;
    private footHint: Label | null = null;

    private sliders: SliderRow[] = [];
    private cells: CellRow[] = [];
    /**
     * 正在拖的滑条。
     *
     * `ratio` 是鼠标算出来的**连续**比例，视觉每帧按它画（跟手）；`written` 是上一次
     * 落盘用的整数百分比 —— 落盘要限频（`setVolume` 每次都同步写 localStorage），
     * 但**视觉不能被这个量化拖慢**，否则把手一格一格跳。
     */
    private dragging: { row: SliderRow; ratio: number; written: number } | null = null;
    private capture: { action: GameAction; index: number } | null = null;

    private whiteFrame: SpriteFrame | null = null;

    constructor(private body: Node, private deps: PanelDeps) {
        this.buildTabs();

        // 条状 UI 全靠 white.png 染色（同 ui/DebugHud.ts 的做法）。
        // 异步回调可能晚于 dispose（面板被反复开关），回来先查一遍。
        resources.load('white/spriteFrame', SpriteFrame, (err, frame) => {
            if (this.disposed) {
                return;
            }
            if (err || !frame) {
                warn('[SettingsPanel] resources/white.png 加载失败，设置页内容不显示：', err);
                return;
            }
            this.whiteFrame = frame;
            this.switchTab(this.tab);
        });

        eventBus.on<SettingsChangedEvent>('settings-changed', this.onSettingsChanged);
    }

    // ======================================================== 对外

    /**
     * 键盘事件转发口。返回 true = 本面板已消费，`TitleScreen` 不要再处理
     * （具体就是别再拿这个返回键去关面板）。
     *
     * 捕获中吃下所有键：`PANEL_BACK_KEY`（E）取消，其余落绑定。非捕获时一律不消费 ——
     * 关面板仍由 `TitleScreen` 读原始按键处理，保持既有语义不变。
     */
    public handleKeyDown(e: EventKeyboard): boolean {
        if (this.disposed || !this.capture) {
            return false;
        }
        const code = e.keyCode;
        if (code === PANEL_BACK_KEY) {
            this.endCapture();
            this.refreshSlots();
            return true;
        }
        this.commitCapture(code);
        return true;
    }

    /**
     * 拆掉对外部的订阅、退出捕获模式。**幂等**，可以重复调。
     *
     * 不销毁任何节点 —— 节点归 `TitleSubPanels` 的 body 管。
     *
     * ⚠️ **必须在面板关闭 / 重建 / 场景卸载时调用**：捕获模式没退出的话，
     * `InputSystem` 会一直不记录按键，表现是「游戏里按键全部没反应」。
     */
    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.endCapture();
        this.dragging = null;
        eventBus.off<SettingsChangedEvent>('settings-changed', this.onSettingsChanged);
    }

    // ======================================================== 页签

    private buildTabs(): void {
        for (let i = 0; i < TAB_LABELS.length; i += 1) {
            const node = this.makeNode(`Tab${i}`, this.body);
            node.addComponent(UITransform).setContentSize(TAB_HIT_W, TAB_HIT_H);
            node.setPosition(TAB_X[i], TAB_Y, 0);

            const label = this.deps.makeLabel(node, 'Label', TAB_LABELS[i], TAB_SIZE, COLOR_DIM, 0);

            // 选中标记：压在自己页签正下方那条横线上（局部坐标，所以减掉 TAB_Y）
            const mark = this.makeLine('Mark', node, MARK_W, MARK_H, COLOR_PANEL_INK);
            mark.setPosition(0, RULE_Y - TAB_Y, 0);

            // 命中盒靠 UITransform 就够，不需要 Sprite（同 TitleScreen 的菜单项）
            node.on(Node.EventType.MOUSE_DOWN, () => {
                this.switchTab(i === 0 ? 'audio' : 'bindings');
            }, this);

            this.tabs.push({ label, mark });
        }

        const rule = this.makeLine('Rule', this.body, RULE_W, RULE_H, COLOR_RULE);
        rule.setPosition(0, RULE_Y, 0);
    }

    private switchTab(tab: Tab): void {
        if (this.disposed) {
            return;
        }
        // 切页前先收掉未完成的改键：捕获模式挂在输入单例上，不跟着节点销毁
        this.endCapture();
        // 拖拽状态同理要清：下面就把整页 destroy 了，旧的滑条 UITransform 立刻失效，
        // 留着它会让之后的每一次鼠标移动都在已销毁的节点上求值（见 applyDrag）
        this.dragging = null;
        this.tab = tab;

        if (this.page && this.page.isValid) {
            this.page.destroy();
        }
        this.page = null;
        this.footBtn = null;
        this.footHint = null;
        this.sliders = [];
        this.cells = [];

        for (let i = 0; i < this.tabs.length; i += 1) {
            const on = (i === 0) === (tab === 'audio');
            this.tabs[i].label.color = on ? COLOR_ACCENT : COLOR_DIM;
            this.tabs[i].mark.active = on;
        }

        // 贴图没到就先不建内容 —— 槽、条、按钮全靠它染色（回调里会再来一次）
        if (!this.whiteFrame) {
            return;
        }

        const page = this.makeNode('Page', this.body);
        this.page = page;
        this.buildFoot(page);
        if (tab === 'audio') {
            this.buildAudioPage(page);
        }
        else {
            this.buildBindingsPage(page);
        }
        this.updateFoot();
    }

    // ======================================================== 音量页

    private buildAudioPage(page: Node): void {
        for (let i = 0; i < VOL_ROWS.length; i += 1) {
            this.buildSlider(page, VOL_ROW_Y[i], VOL_ROWS[i]);
        }
    }

    private buildSlider(page: Node, y: number, row: typeof VOL_ROWS[number]): void {
        const caption = this.columnLabel(page, 'Caption', row.caption, VOL_TEXT_SIZE,
            COLOR_TEXT, 200, Label.HorizontalAlign.RIGHT);
        caption.node.setPosition(CAPTION_RIGHT_X, y, 0);

        const value = this.columnLabel(page, 'Value', '', VOL_TEXT_SIZE,
            COLOR_ACCENT, 100, Label.HorizontalAlign.LEFT);
        value.node.setPosition(VALUE_LEFT_X, y, 0);

        // 命中盒：只有 UITransform、没有 Sprite，可见的槽是它的子节点
        const box = this.makeNode('Slider', page);
        const boxUt = box.addComponent(UITransform);
        boxUt.setContentSize(SLIDER_W, SLIDER_HIT_H);
        box.setPosition(SLIDER_X, y, 0);

        const track = this.makeBar('Track', box, SLIDER_W, TRACK_H, COLOR_TRACK);
        track.setPosition(0, 0, 0);

        const fill = this.makeBar('Fill', box, 0, TRACK_H, COLOR_FILL, 0);
        fill.setPosition(-SLIDER_W / 2, 0, 0);

        const knob = this.makeKnob(box);

        const ref: SliderRow = {
            get: row.get,
            set: row.set,
            box: boxUt,
            fill: fill.getComponent(UITransform) as UITransform,
            knob,
            value,
        };
        this.sliders.push(ref);
        this.paintSlider(ref, ref.get());

        // ⚠️ 拖动必须用**节点级 TOUCH 事件**，不能用全局 `input.on(MOUSE_MOVE)`。
        // 引擎的派发器链是「返回 false 就 break」（`Input._emitEvent`），而 UI 派发器
        // （`PointerEventDispatcher`）优先级更高：节点在 TOUCH_START 里**认领**了这个 touch 之后，
        // 事件就被它吞掉，全局监听器**一次都收不到** —— 表现就是「按下能跳值、拖动不跟手」。
        // 认领之后 TOUCH_MOVE 会**跳过命中测试**直接发给本节点，所以拖出滑条范围也照样跟手，
        // 松手也不必另挂全局监听。引擎自带的 Slider 就是这么做的。
        box.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            this.dragging = { row: ref, ratio: ref.get(), written: Math.round(ref.get() * 100) };
            this.applyDrag(e);   // 点哪跳哪，不必非得抓住把手
        }, this);
        box.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
            this.applyDrag(e);
        }, this);
        box.on(Node.EventType.TOUCH_END, () => {
            this.endDrag();
        }, this);
        box.on(Node.EventType.TOUCH_CANCEL, () => {
            this.endDrag();
        }, this);
    }

    /** 菱形把手：用 Graphics 画，跟首页分隔线上那枚菱形是同一套形状语言 */
    private makeKnob(parent: Node): Node {
        const n = this.makeNode('Knob', parent);
        const g = n.addComponent(Graphics);
        const h = KNOB_SIZE / 2;
        g.fillColor = COLOR_KNOB;
        g.moveTo(0, h);
        g.lineTo(h, 0);
        g.lineTo(0, -h);
        g.lineTo(-h, 0);
        g.close();
        g.fill();
        return n;
    }

    /**
     * 鼠标位置 → 比例。
     *
     * 用 `convertToNodeSpaceAR` 而不是直接拿 x 相减：面板以后挪了位置或加了缩放，
     * 前者自动跟着变，后者要跟着改。
     */
    private applyDrag(e: EventTouch): void {
        const drag = this.dragging;
        if (!drag) {
            return;
        }
        const row = drag.row;
        // 拖动期间节点可能已经被销毁（切了页签、面板被关掉）。组件销毁后 `node` 是 null，
        // 再调 convertToNodeSpaceAR 会**每一次移动都抛一次** —— 拖动看起来就像卡死，
        // 日志还会被刷屏。所以这里必须自己收尾。
        if (!row.box.isValid || !row.box.node) {
            this.dragging = null;
            return;
        }
        const ui = e.getUILocation();
        const local = row.box.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const ratio = clamp01(local.x / SLIDER_W + 0.5);
        drag.ratio = ratio;
        // 视觉按连续值画（跟手）；落盘按整数百分比限频
        this.paintSlider(row, ratio);
        const pct = Math.round(ratio * 100);
        if (pct !== drag.written) {
            drag.written = pct;
            row.set(pct / 100);
        }
    }

    /** 松手收尾：补一次精确值（拖动中落盘量化到 1%，这里把最后那零点几补上） */
    private endDrag(): void {
        const drag = this.dragging;
        this.dragging = null;
        if (!drag) {
            return;
        }
        const row = drag.row;
        if (row.fill.isValid && row.fill.node && row.knob.isValid) {
            row.set(drag.ratio);
            this.paintSlider(row, drag.ratio);
        }
    }

    /** 按给定比例画一条滑条。**不读存档** —— 拖动中的连续值要能直接画出来 */
    private paintSlider(row: SliderRow, value: number): void {
        const v = clamp01(value);
        row.fill.setContentSize(SLIDER_W * v, TRACK_H);
        row.knob.setPosition(-SLIDER_W / 2 + SLIDER_W * v, 0, 0);
        row.value.string = `${Math.round(v * 100)}%`;
    }

    private refreshSliders(): void {
        for (const row of this.sliders) {
            // 正在拖的那条由 applyDrag 逐帧画，别在这里按存档值把它拽回量化后的位置
            if (this.dragging && this.dragging.row === row) {
                continue;
            }
            // ⚠️ 一律查**组件自己**的 isValid，不要写 `row.fill.node.isValid`：
            // 组件被销毁后 `node` 被置成 null，读 `.isValid` 会直接抛错。
            if (row.fill.isValid && row.fill.node && row.knob.isValid) {
                this.paintSlider(row, row.get());
            }
        }
    }

    // ======================================================== 键位页

    private buildBindingsPage(page: Node): void {
        this.checkActionGroups();

        for (let i = 0; i < GROUP_GAME.length; i += 1) {
            this.buildActionRow(page, GROUP_GAME[i], KEY_ROW_TOP - i * KEY_ROW_PITCH);
        }

        this.refreshSlots();
    }

    private buildActionRow(page: Node, action: GameAction, y: number): void {
        const name = this.columnLabel(page, 'Name', ACTION_LABELS[action], KEY_TEXT_SIZE, COLOR_TEXT, KEY_NAME_W);
        name.node.setPosition(KEY_NAME_X, y, 0);

        const binds = inputSystem.getBindings(action);
        for (let i = 0; i < SLOT_X.length; i += 1) {
            if (i >= binds.length) {
                // 这个动作没这么多绑定：留空，保住列位
                continue;
            }
            const slot = this.makeBar('Slot', page, SLOT_W, SLOT_H, COLOR_SLOT);
            slot.setPosition(SLOT_X[i], y, 0);
            const sp = slot.getComponent(Sprite) as Sprite;
            const label = this.deps.makeLabel(slot, 'Text', '', SLOT_TEXT_SIZE, COLOR_ACCENT, 0);

            const cell: CellRow = { action, index: i, label, slot: sp };
            this.cells.push(cell);

            slot.on(Node.EventType.MOUSE_ENTER, () => {
                if (!this.isCapturing(cell)) {
                    sp.color = COLOR_SLOT_HOVER;
                }
            }, this);
            slot.on(Node.EventType.MOUSE_LEAVE, () => {
                if (!this.isCapturing(cell)) {
                    sp.color = COLOR_SLOT;
                }
            }, this);
            slot.on(Node.EventType.MOUSE_DOWN, () => {
                this.beginCapture(action, i);
            }, this);
        }
    }

    private isCapturing(cell: CellRow): boolean {
        return !!this.capture && this.capture.action === cell.action && this.capture.index === cell.index;
    }

    private refreshSlots(): void {
        for (const cell of this.cells) {
            // 查组件自己的 isValid，理由同 refreshSliders
            if (!cell.label.isValid || !cell.slot.isValid) {
                continue;
            }
            const cap = this.isCapturing(cell);
            const b = inputSystem.getBindings(cell.action)[cell.index];
            cell.label.string = cap ? '按新键…' : (b ? bindingLabel(b) : '');
            cell.label.color = cap ? COLOR_WARN : COLOR_ACCENT;
            cell.slot.color = cap ? COLOR_SLOT_ACTIVE : COLOR_SLOT;
        }
    }

    // ======================================================== 改键捕获

    private beginCapture(action: GameAction, index: number): void {
        if (this.disposed) {
            return;
        }
        this.endCapture();
        this.capture = { action, index };
        // 先挂起动作层：捕获期间按下的键不能同时被解析成游戏动作
        // （玩家为了把「跳跃」改成 K 而按的 K，不能顺手触发「踏云闪」）
        inputSystem.setCaptureMode(true);
        this.refreshSlots();
        this.updateFoot(CAPTURE_HINT);
    }

    private commitCapture(code: KeyCode): void {
        const cap = this.capture;
        if (!cap) {
            return;
        }
        // 同一动作内部的重复要拦。**跨动作重复是合法的**（↑/W 同时是「向上」与「菜单上移」），
        // 与 InputSystem.validateBindings 的口径一致。
        const binds = inputSystem.getBindings(cap.action);
        for (let i = 0; i < binds.length; i += 1) {
            if (i !== cap.index && sameBinding(binds[i], key(code))) {
                this.updateFoot('该键已用在本动作的另一格，换个键或按 E 取消');
                return;
            }
        }
        // 顺序要紧：先退捕获再落绑定。rebind 会广播 settings-changed 并**同步**回调刷新，
        // 若那时还处在捕获态，刷新会把「按新键…」的显示冲掉。
        this.endCapture();
        inputSystem.rebind(cap.action, cap.index, key(code));
        this.refreshSlots();
    }

    /**
     * 退出捕获模式。**必须与 `beginCapture` 成对**，否则动作层会永久失灵。
     *
     * 捕获结束的唯一出口，页脚的「按钮 ↔ 提示」二选一也挂在这里 ——
     * 不然按 E 取消之后提示会一直占着位置、按钮回不来。
     */
    private endCapture(): void {
        this.capture = null;
        inputSystem.setCaptureMode(false);
        this.updateFoot();
    }

    // ======================================================== 页脚

    private buildFoot(page: Node): void {
        const hint = this.columnLabel(page, 'FootHint', '', FOOT_HINT_SIZE, COLOR_WARN, 800,
            Label.HorizontalAlign.CENTER);
        hint.node.setPosition(0, FOOT_Y, 0);
        hint.node.active = false;
        this.footHint = hint;

        this.footBtn = this.makeButton(page, 0, FOOT_Y, BTN_W, BTN_H, '恢复默认', () => {
            this.onReset();
        });
    }

    /**
     * 按钮与改键提示二选一（共用 `FOOT_Y`，不占两行）。
     *
     * 用状态而不是定时器驱动：提示只在**捕获期间**出现，捕获一结束按钮就回来 ——
     * 不需要更新循环，也不会有「面板关了计时器还在跑」的问题。
     */
    private updateFoot(message = CAPTURE_HINT): void {
        const capturing = !!this.capture;
        if (this.footBtn && this.footBtn.isValid) {
            this.footBtn.active = !capturing;
        }
        // `footHint` 是 Label 组件：**不要写 `this.footHint.node.isValid`** ——
        // 场景卸载时 TitleScreen.onDestroy → dispose → endCapture 会走到这里，
        // 那时组件已销毁、`node` 是 null，读 `.isValid` 直接抛（实测刷了 5 次日志）。
        const hint = this.footHint;
        if (hint && hint.isValid && hint.node) {
            hint.node.active = capturing;
            if (capturing) {
                hint.string = message;
            }
        }
    }

    private onReset(): void {
        // 捕获中不让点：这时玩家的注意力在「按哪个键」上，误点会把刚改的键位全清掉
        if (this.capture) {
            return;
        }
        if (this.tab === 'audio') {
            audioManager.resetAudio();
            this.refreshSliders();
            return;
        }
        // 清掉覆盖项即可，读的时候自然回落到 DEFAULT_BINDINGS
        inputSystem.resetBindings();
        this.refreshSlots();
    }

    // ======================================================== 零件

    private makeNode(name: string, parent: Node): Node {
        const n = new Node(name);
        // ⚠️ 不设 layer 的节点 UI 相机看不见（节点在、就是不渲染）
        n.layer = parent.layer;
        parent.addChild(n);
        return n;
    }

    /**
     * `white.png` 染色的横条。`anchorX = 0` 时锚点在左端，改宽度即向右生长。
     *
     * ⚠️ 顺序固定「先赋 frame、再设锚点与尺寸」：`Sprite.spriteFrame` 赋值会把
     * contentSize 重置成贴图尺寸（white.png 是 8×8），反过来设就丢了。
     */
    private makeBar(name: string, parent: Node, w: number, h: number,
        color: Color, anchorX = 0.5): Node {
        const n = this.makeNode(name, parent);
        const ut = n.addComponent(UITransform);
        const sp = n.addComponent(Sprite);
        sp.spriteFrame = this.whiteFrame as SpriteFrame;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;
        sp.color = color;
        ut.setAnchorPoint(anchorX, 0.5);
        ut.setContentSize(w, h);
        return n;
    }

    /** 固定颜色的实心横线。用 Graphics 画 —— 不需要等贴图加载，也没有尺寸重置的坑 */
    private makeLine(name: string, parent: Node, w: number, h: number, color: Color): Node {
        const n = this.makeNode(name, parent);
        n.addComponent(UITransform);
        const g = n.addComponent(Graphics);
        g.fillColor = color;
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();
        return n;
    }

    /**
     * 定宽文本。`makeLabel` 出的是「节点贴着文字」的居中文本（overflow NONE），
     * 排成列时每行字数不同、左边会参差不齐 —— 要排成表格就得自己定宽 + 设对齐。
     * `anchorX` 跟着对齐走：左对齐取左端、右对齐取右端，调用方按对齐后的那一侧定位。
     */
    private columnLabel(parent: Node, name: string, text: string, size: number, color: Color,
        width: number, align = Label.HorizontalAlign.LEFT): Label {
        const label = this.deps.makeLabel(parent, name, text, size, color, 0);
        const ut = label.node.getComponent(UITransform) as UITransform;
        ut.setAnchorPoint(align === Label.HorizontalAlign.RIGHT ? 1 : 0, 0.5);
        ut.setContentSize(width, Math.round(size * 1.4));
        label.horizontalAlign = align;
        label.overflow = Label.Overflow.CLAMP;
        return label;
    }

    /** 双层条做的按钮：外层亮边 + 内层深墨底 + 浅色字 */
    private makeButton(parent: Node, x: number, y: number, w: number, h: number,
        text: string, onClick: () => void): Node {
        const edge = this.makeBar('ButtonEdge', parent, w + 4, h + 4, COLOR_BTN_EDGE);
        edge.setPosition(x, y, 0);
        const ink = this.makeBar('ButtonInk', edge, w, h, COLOR_BTN_INK);
        ink.setPosition(0, 0, 0);
        const inkSp = ink.getComponent(Sprite) as Sprite;
        this.deps.makeLabel(ink, 'Label', text, BTN_TEXT_SIZE, COLOR_BTN_TEXT, 0);

        edge.on(Node.EventType.MOUSE_ENTER, () => { inkSp.color = COLOR_BTN_HOVER; }, this);
        edge.on(Node.EventType.MOUSE_LEAVE, () => { inkSp.color = COLOR_BTN_INK; }, this);
        edge.on(Node.EventType.MOUSE_DOWN, () => { onClick(); }, this);
        return edge;
    }

    // ======================================================== 数据自检

    /**
     * 键位页的分组是手写的（顺序即版面顺序），这里盯两眼漏：
     *
     * 1. 显示表 + 隐藏表合起来必须覆盖 `ALL_ACTIONS` —— `InputActions` 里加了新动作
     *    却忘了归类的话，表现是「设置页里根本没有这一项」，不报错、很难发现。
     * 2. 动作的绑定数不能超过版面的槽位列数 —— 超了会被静默吃掉一条绑定。
     */
    private checkActionGroups(): void {
        for (const action of ALL_ACTIONS) {
            if (GROUP_GAME.indexOf(action) < 0 && GROUP_HIDDEN.indexOf(action) < 0) {
                error(`[SettingsPanel] 动作「${action}」没有归类，设置页里会看不到它`);
            }
        }
        for (const action of GROUP_GAME) {
            const count = inputSystem.getBindings(action).length;
            if (count > SLOT_X.length) {
                error(`[SettingsPanel] 动作「${action}」有 ${count} 个绑定，`
                    + `超过了版面的 ${SLOT_X.length} 个槽位，多的会被吃掉`);
            }
        }
    }

    // ======================================================== 回调
    // 箭头函数属性：`EventBus` 的回调不绑 target，写成普通方法的话 this 会是 undefined

    private onSettingsChanged = (e: SettingsChangedEvent): void => {
        if (this.disposed) {
            return;
        }
        if (e.audio) {
            this.refreshSliders();
        }
        if (e.bindings) {
            this.refreshSlots();
        }
    };
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) {
        return 0;
    }
    return Math.min(1, Math.max(0, v));
}
