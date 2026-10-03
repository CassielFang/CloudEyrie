import {
    director, Director, game, Game, input, Input, EventKeyboard, log, warn, error,
} from 'cc';

import { eventBus } from './EventBus';
import { gameSettings, SettingsChangedEvent } from './GameSettings';
import {
    ALL_ACTIONS, Binding, GameAction, sameBinding, bindingLabel,
} from './InputActions';

/**
 * 输入动作层 —— 把物理按键翻译成游戏意图。
 *
 * 业务代码读这个，不再读 `KeyCode`：
 *
 *     inputSystem.isDown(GameAction.MoveRight)
 *     inputSystem.wasPressed(GameAction.Jump)
 *
 * **绑定表的真相源是 `gameSettings`**（它负责读档与回落默认值），本类只做一层
 * 运行时缓存 + 反查索引，收到 `settings-changed` 就重新拉取。`rebind()` 也是写穿到
 * `gameSettings`，由它落盘后广播回来。
 *
 * ============================ 三条硬规矩（改之前务必读）============================
 *
 * **1. `wasPressed` / `wasReleased` 在 `Director.EVENT_END_FRAME` 清除，不是 `BEGIN_FRAME`。**
 *    引擎里 `dispatchImmediately = !NATIVE`（`cocos/input/input.ts:113`）：Web 端事件在
 *    **两帧之间**直接派发；Native 端排队、在 `BEGIN_FRAME` 之后冲刷。若在 `BEGIN_FRAME` 清，
 *    Web 端上一帧末尾到达的按下会被本帧开头抹掉 → 丢输入。放 `END_FRAME` 才两边都对。
 *    推论：**不要在 `END_FRAME` 里读输入**，也别在自己的 `END_FRAME` 处理器里依赖这些边沿
 *    ——清除是最后一步。
 *
 * **2. `wasPressed` 是「读」不是「消费」。**
 *    同一帧里多个读者都会看到 true。旧写法（事件里直接改快照 + 消费后清零）是「先读的拿走」。
 *    目前同一动作只有一个消费者，所以没影响 —— 以后加暂停菜单时要留意，
 *    需要排他语义就用 `consumePressed()`。
 *
 * **3. 只在 `QingheController` 一处读 `inputSystem`，其余全部读 `ctx.input` 快照。**
 *    形态状态类（`EntityForm` 等）会改写 `ctx.input.jump/dash`。若它们绕过快照直接读
 *    `inputSystem.wasPressed()`，就会出现两个真相源，边沿语义立刻失效。
 *
 * ============================ 其它已知边界 ============================
 *
 * - **`held` 按物理键记，不按动作记**：`isDown(MoveLeft)` 是「任一绑定键按着」。
 *   按动作记的话「按 A → 再按 ← → 松开 A」会把整个动作误清成未按
 *   （这是迁移前就存在的老 bug，按物理键记正好顺手修掉）。
 * - **跨场景 / 失焦要 `reset()`**：单例的状态活得比场景久。按住 D 切场景、或 Alt+Tab
 *   收不到 keyup，都会让主角一直走。已自动挂 `EVENT_AFTER_SCENE_LAUNCH` 与 `GAME_HIDE`。
 * - **暂停期间会丢松手边沿**：`director.pause()` 下 `END_FRAME` 照发而组件不跑，暂停中到达的
 *   KEY_UP 会被清掉、消费者永远看不到。项目现在没有暂停菜单，先记着；做暂停时要么让消费者
 *   对 `reset()` 敏感，要么补 `consumeReleased()`。
 * - **手柄（未实现）**：`{kind:'gamepad'}` 的 `held` 以后建议走轮询（`getButton`），
 *   部分平台只在变化时发事件、长按状态会失真，别沿用按键这条边沿路径。
 * - **鼠标（未实现）**：UI 派发器 priority 高于全局（`input.ts:342`），鼠标绑定会比
 *   `Node.EventType.MOUSE_DOWN` 晚触发，UI 按钮可能「既被 UI 处理、又被动作层触发」。
 * - **捕获模式（设置页改键用）**：见 `setCaptureMode`。它是唯一一个会让**整个动作层
 *   停止记录按键**的状态，用完必须退出，否则游戏里所有按键都会没反应。
 */

export class InputSystem {

    /** 物理键按住状态（按**键**记，不按动作记，见文件头说明） */
    private readonly keysDown = new Set<number>();
    /** 本帧按下的物理键，`END_FRAME` 清 */
    private readonly keysPressed = new Set<number>();
    /** 本帧松开的物理键，`END_FRAME` 清 */
    private readonly keysReleased = new Set<number>();

    /** 反查表：一个键可能同时映射多个动作（↑/W 既是 MoveUp 又是 MenuUp），所以是**数组** */
    private readonly keyToActions = new Map<number, GameAction[]>();

    /** 绑定表缓存，真相源在 `gameSettings` */
    private bindings: Record<GameAction, Binding[]>;

    /** 自检开关。排查键位问题时手动置 true */
    private static readonly DEBUG_VALIDATE = true;

    /**
     * 捕获模式（设置页改键用）。开启期间**动作层停止记录任何按键**。
     *
     * 为什么必须挡住：玩家为了把「跳跃」改成 K 而按下的那个 K，如果照记不误，
     * 同一帧就会被解析成「踏云闪」——「改键的那一下同时触发了另一个动作」。
     * （`docs/设置页接口.md` 第 2 节记着这个坑。）
     *
     * ⚠️ **用完必须 `setCaptureMode(false)`**。开着的时候 `keysDown` 永远是空的，
     * 等于整个动作层哑掉；关闭设置面板却忘了退出捕获，表现就是「游戏里按键全没反应」。
     */
    private capturing = false;

    constructor() {
        this.bindings = gameSettings.getAllBindings();
        this.rebuildReverseIndex();

        // 模块级 eager 构造：ES 模块只求值一次且被缓存，所以这些监听器只注册一次、
        // 切场景不会累积，天然无泄漏；注册也早于任何场景运行，不会漏掉首帧按键。
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        director.on(Director.EVENT_END_FRAME, this.clearEdges, this);
        director.on(Director.EVENT_AFTER_SCENE_LAUNCH, this.reset, this);
        game.on(Game.EVENT_HIDE, this.reset, this);

        eventBus.on<SettingsChangedEvent>('settings-changed', this.onSettingsChanged);

        if (InputSystem.DEBUG_VALIDATE) {
            this.validateBindings();
        }
    }

    // ============================================================ 查询

    /** 动作是否被按住 */
    public isDown(action: GameAction): boolean {
        for (const b of this.bindings[action] ?? []) {
            if (b.kind === 'key' && this.keysDown.has(b.key)) {
                return true;
            }
        }
        return false;
    }

    /** 动作是否在本帧被按下（边沿）。**是读不是消费**，同帧多个读者都会看到 true。 */
    public wasPressed(action: GameAction): boolean {
        for (const b of this.bindings[action] ?? []) {
            if (b.kind === 'key' && this.keysPressed.has(b.key)) {
                return true;
            }
        }
        return false;
    }

    /** 动作是否在本帧被松开（边沿） */
    public wasReleased(action: GameAction): boolean {
        for (const b of this.bindings[action] ?? []) {
            if (b.kind === 'key' && this.keysReleased.has(b.key)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 读后即清 —— 给「一次性、排他」的语义用（阶段推进之类）。
     * 普通玩法**不要用**，会抢掉同帧其它消费者的输入。
     */
    public consumePressed(action: GameAction): boolean {
        const hit = this.wasPressed(action);
        if (hit) {
            for (const b of this.bindings[action] ?? []) {
                if (b.kind === 'key') {
                    this.keysPressed.delete(b.key);
                }
            }
        }
        return hit;
    }

    // ============================================================ 绑定

    public getBindings(action: GameAction): readonly Binding[] {
        return this.bindings[action] ?? [];
    }

    /**
     * 改一条绑定。写穿到 `gameSettings`（由它落盘并广播），本类随即重新拉取。
     * `index` 越界返回 false。
     */
    public rebind(action: GameAction, index: number, binding: Binding): boolean {
        return gameSettings.setBinding(action, index, binding);
    }

    /** 全部恢复默认键位 */
    public resetBindings(): void {
        gameSettings.resetBindings();
    }

    // 必须是箭头函数属性：EventBus 的回调不绑 target，普通方法里的 this 会是 undefined
    // （项目里 CombatController.onFormChangedHandler 等也是这个写法）
    private onSettingsChanged = (e: SettingsChangedEvent): void => {
        if (e.bindings) {
            this.bindings = gameSettings.getAllBindings();
            this.rebuildReverseIndex();
        }
    };

    private rebuildReverseIndex(): void {
        this.keyToActions.clear();
        for (const action of ALL_ACTIONS) {
            for (const b of this.bindings[action] ?? []) {
                if (b.kind !== 'key') {
                    continue;
                }
                const list = this.keyToActions.get(b.key);
                if (list) {
                    // 用 indexOf 而不是 includes：includes 要 es2016 的 lib，本项目 target 更低
                    if (list.indexOf(action) < 0) {
                        list.push(action);
                    }
                }
                else {
                    this.keyToActions.set(b.key, [action]);
                }
            }
        }
    }

    // ============================================================ 事件

    private onKeyDown(event: EventKeyboard): void {
        // 捕获态（设置页改键）：一个键都不记。理由见 `capturing` 字段的说明。
        if (this.capturing) {
            return;
        }
        const k = event.keyCode as number;
        // 浏览器按住不放会重复发 keydown，但引擎已经用 `event.repeat` 过滤过
        // （web 端 `pal/input/web/keyboard-input.js` 的 `_handleKeyboardDown`），
        // 这里再挡一次是为了不依赖引擎实现，也免得小游戏端行为不一致。
        if (this.keysDown.has(k)) {
            return;
        }
        this.keysDown.add(k);
        this.keysPressed.add(k);
    }

    private onKeyUp(event: EventKeyboard): void {
        if (this.capturing) {
            // 同理要挡：捕获期间没往 keysDown 里加过，这里删是删不存在的键；
            // 更糟的是会把「松手」记进 keysReleased，退出捕获后让消费者看到一次假松手。
            return;
        }
        const k = event.keyCode as number;
        this.keysDown.delete(k);
        this.keysReleased.add(k);
    }

    /** `END_FRAME`：清掉本帧边沿。**必须是最后一步**，别在它之后再读。 */
    private clearEdges(): void {
        this.keysPressed.clear();
        this.keysReleased.clear();
    }

    /**
     * 清空全部输入状态。切场景、失焦时调，防止「按住某键切场景 → 主角自己走」。
     *
     * 顺手把捕获模式也放掉：设置页若因异常没走到 `dispose()`（切场景、Alt+Tab 导致
     * 面板没了），这是最后一道保险 —— 捕获模式挂着不放等于整个动作层失灵。
     */
    public reset(): void {
        this.clearState();
        this.capturing = false;
    }

    /** 只清按键状态，不动捕获模式（内部用） */
    private clearState(): void {
        this.keysDown.clear();
        this.keysPressed.clear();
        this.keysReleased.clear();
    }

    // ============================================================ 捕获模式

    /** 是否处于改键捕获态。设置页用它决定要不要把按键当成「玩家在选新键」。 */
    public get isCapturing(): boolean {
        return this.capturing;
    }

    /**
     * 进出改键捕获态。**离开设置页时务必调 `setCaptureMode(false)`**，
     * 理由见 `capturing` 字段——忘了退出的后果是游戏内按键全失灵。
     *
     * 进出都清一次按键状态：玩家为了改键按住不放的那个键（比如按住 D 去改「向右移动」）
     * 会留在 `keysDown` 里，不清掉的话退出捕获后主角会自己往右走。
     *
     * 注意这里调的是 `clearState()` 而不是 `reset()` —— 后者会把 `capturing` 一起放掉，
     * 那刚进来的这一下就白设了。
     */
    public setCaptureMode(on: boolean): void {
        if (this.capturing === on) {
            return;
        }
        this.capturing = on;
        this.clearState();
    }

    // ============================================================ 自检

    /**
     * 绑定表自检。抓的是那些**不报错、只在特定场景表现为「按键没反应」**的问题：
     * 动作没有绑定、同一动作内绑定重复、反查表缺项。
     *
     * 跨动作重复是**合法的**（↑/W 同时映射 MoveUp 与 MenuUp），只在同一动作内部查重。
     */
    public validateBindings(): boolean {
        let ok = true;
        for (const action of ALL_ACTIONS) {
            const list = this.bindings[action];
            if (!list || list.length === 0) {
                error(`[InputSystem] 动作「${action}」没有任何绑定，永远不会触发`);
                ok = false;
                continue;
            }
            for (let i = 0; i < list.length; i += 1) {
                for (let j = i + 1; j < list.length; j += 1) {
                    if (sameBinding(list[i], list[j])) {
                        error(`[InputSystem] 动作「${action}」内部有重复绑定：` +
                            `${bindingLabel(list[i])}（第 ${i} 和 ${j} 条）`);
                        ok = false;
                    }
                }
            }
            for (const b of list) {
                if (b.kind === 'key') {
                    const back = this.keyToActions.get(b.key);
                    if (!back || back.indexOf(action) < 0) {
                        error(`[InputSystem] 反查表缺项：${action} 的 ${bindingLabel(b)}`);
                        ok = false;
                    }
                }
            }
        }
        if (ok) {
            log(`[InputSystem] 绑定表自检通过（${ALL_ACTIONS.length} 个动作）`);
        }
        return ok;
    }
}

/**
 * 模块级单例。**eager 构造**，不是 lazy init：
 * 注册发生在脚本 bundle 加载时、早于任何场景运行，不会漏掉「第一次查询之前到达的按键」；
 * 而 lazy init 会有一个「首个 KEY_DOWN 因为没有监听器而丢失」的窗口。
 */
export const inputSystem = new InputSystem();
