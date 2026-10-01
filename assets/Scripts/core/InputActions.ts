import { KeyCode } from 'cc';

/**
 * 输入动作层的**数据定义**（动作枚举、绑定类型、默认绑定表）。
 *
 * 这一层的目的：让业务代码不再认「D 键」，而是认「向右移动」这个**意图**。
 * 有了它，键位重映射、手柄、触屏才接得上——否则每个组件各判各的 `KeyCode`，
 * 想换个键得改三个文件。
 *
 * 动作的读写接口在 `InputSystem.ts`（`inputSystem.isDown(...)` 等）。
 */

/**
 * 游戏动作。
 *
 * ⚠️ **用字符串枚举，不要改成数字**：这张表会被持久化进设置存档
 * （`GameSettingsData.bindings` 以动作名为键）。数字枚举一旦重排或插入新项，
 * 所有人的存档绑定就整体错位了；字符串值改名才会失效，而改名是显式的、看得见的。
 */
export enum GameAction {
    // ---- 游戏内 ----
    MoveLeft = 'moveLeft',
    MoveRight = 'moveRight',
    MoveUp = 'moveUp',
    MoveDown = 'moveDown',
    Jump = 'jump',
    Dash = 'dash',
    Attack = 'attack',
    Block = 'block',
    /** 实体 ↔ 灵雾 */
    FormSwitch = 'formSwitch',
    /** 灵雾 → 灵合；灵合 → 实体 */
    FormMerge = 'formMerge',

    // ---- 菜单 ----
    MenuUp = 'menuUp',
    MenuDown = 'menuDown',
    MenuConfirm = 'menuConfirm',
}

/**
 * 一条绑定。
 *
 * 手柄与鼠标**只是预留**，本轮不实现——写成可辨识联合是为了以后加手柄时
 * 只需要在 InputSystem 里加一个分支，不用动数据结构，也不用迁移存档格式。
 */
export type Binding =
    | { kind: 'key'; key: KeyCode }
    | { kind: 'gamepad'; button: number }
    | { kind: 'mouse'; button: number };

/** 按键绑定（写起来短一点） */
export function key(k: KeyCode): Binding {
    return { kind: 'key', key: k };
}

/** 设置页显示用的中文名。填设置页时直接用，不要在 UI 里再手写一份。 */
export const ACTION_LABELS: Record<GameAction, string> = {
    [GameAction.MoveLeft]: '向左移动',
    [GameAction.MoveRight]: '向右移动',
    [GameAction.MoveUp]: '向上（飞行）',
    [GameAction.MoveDown]: '向下（飞行）',
    [GameAction.Jump]: '跳　跃',
    [GameAction.Dash]: '踏云闪',
    [GameAction.Attack]: '攻　击',
    [GameAction.Block]: '格　挡',
    [GameAction.FormSwitch]: '形态切换',
    [GameAction.FormMerge]: '灵合归一',
    [GameAction.MenuUp]: '菜单上移',
    [GameAction.MenuDown]: '菜单下移',
    [GameAction.MenuConfirm]: '菜单确认',
};

/**
 * 默认绑定表。
 *
 * ⚠️ **必须与引入动作层之前的按键逐一对应** —— 这是一次纯重构，默认手感不能变。
 * 对照表（迁移前的原始代码）：
 *   QingheController      A/← D/→ W/↑ S/↓ SPACE K
 *   CombatController      J（按下起手/按住蓄力/松开结算） L（按住格挡）
 *   CompanionStateMachine F G
 *   TitleScreen           ↑/W ↓/S ENTER/SPACE/J
 *
 * 几个动作**共用同一个键是正常的**（菜单和游戏在不同场景里消费，不会同时生效）——
 * 反向表是一对多的。`validateBindings()` 只在**同一个动作内部**查重。
 */
export const DEFAULT_BINDINGS: Record<GameAction, Binding[]> = {
    [GameAction.MoveLeft]: [key(KeyCode.KEY_A), key(KeyCode.ARROW_LEFT)],
    [GameAction.MoveRight]: [key(KeyCode.KEY_D), key(KeyCode.ARROW_RIGHT)],
    [GameAction.MoveUp]: [key(KeyCode.KEY_W), key(KeyCode.ARROW_UP)],
    [GameAction.MoveDown]: [key(KeyCode.KEY_S), key(KeyCode.ARROW_DOWN)],
    [GameAction.Jump]: [key(KeyCode.SPACE)],
    [GameAction.Dash]: [key(KeyCode.KEY_K)],
    [GameAction.Attack]: [key(KeyCode.KEY_J)],
    [GameAction.Block]: [key(KeyCode.KEY_L)],
    [GameAction.FormSwitch]: [key(KeyCode.KEY_F)],
    [GameAction.FormMerge]: [key(KeyCode.KEY_G)],
    [GameAction.MenuUp]: [key(KeyCode.ARROW_UP), key(KeyCode.KEY_W)],
    [GameAction.MenuDown]: [key(KeyCode.ARROW_DOWN), key(KeyCode.KEY_S)],
    [GameAction.MenuConfirm]: [key(KeyCode.ENTER), key(KeyCode.SPACE), key(KeyCode.KEY_J)],
};

/**
 * 全部动作的列表（遍历用）。
 *
 * 手写而不是 `Object.values(GameAction)` —— 后者要 es2017 的 lib，
 * 本项目 tsconfig 的 target 更低，编不过；而且手写能保证顺序稳定。
 * **加新动作时这里要一起加**，`validateBindings()` 会盯着漏掉的。
 */
export const ALL_ACTIONS: readonly GameAction[] = [
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
    GameAction.MenuUp,
    GameAction.MenuDown,
    GameAction.MenuConfirm,
];

/** 两个绑定是不是同一个（查重、UI 显示用） */
export function sameBinding(a: Binding, b: Binding): boolean {
    if (a.kind !== b.kind) {
        return false;
    }
    if (a.kind === 'key' && b.kind === 'key') {
        return a.key === b.key;
    }
    if (a.kind === 'gamepad' && b.kind === 'gamepad') {
        return a.button === b.button;
    }
    if (a.kind === 'mouse' && b.kind === 'mouse') {
        return a.button === b.button;
    }
    return false;
}

/** 绑定的可读文本，给设置页和日志用 */
export function bindingLabel(b: Binding): string {
    switch (b.kind) {
        case 'key': return keyLabel(b.key);
        case 'gamepad': return `手柄按钮 ${b.button}`;
        case 'mouse': return `鼠标按钮 ${b.button}`;
        default: return '未知';
    }
}

/** `KeyCode` → 可读文本。只覆盖项目用得到的键，其余的回落成原始数字。 */
function keyLabel(k: KeyCode): string {
    const special: Partial<Record<KeyCode, string>> = {
        [KeyCode.SPACE]: '空格',
        [KeyCode.ENTER]: '回车',
        [KeyCode.ESCAPE]: 'Esc',
        [KeyCode.ARROW_UP]: '↑',
        [KeyCode.ARROW_DOWN]: '↓',
        [KeyCode.ARROW_LEFT]: '←',
        [KeyCode.ARROW_RIGHT]: '→',
    };
    const hit = special[k];
    if (hit) {
        return hit;
    }
    // 字母键的 KeyCode 就是 ASCII 码（A=65…Z=90），换成字母更可读
    if (k >= KeyCode.KEY_A && k <= KeyCode.KEY_Z) {
        return String.fromCharCode(k);
    }
    if (k >= KeyCode.DIGIT_0 && k <= KeyCode.DIGIT_9) {
        return String.fromCharCode(k);
    }
    return `键码 ${k}`;
}
