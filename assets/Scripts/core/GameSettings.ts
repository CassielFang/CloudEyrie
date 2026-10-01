import { sys, log, warn } from 'cc';

import { eventBus } from './EventBus';
import { ALL_ACTIONS, Binding, DEFAULT_BINDINGS, GameAction } from './InputActions';

/**
 * 玩家设置的唯一持有者与持久化入口。
 *
 * 存两样东西：**音量**（给 `AudioManager` 读）和**键位绑定**（给 `InputSystem` 读）。
 * 两者都从 `settings-changed` 事件通知——`InputSystem` 与 `AudioManager` 都是订阅方，
 * 谁都不需要知道对方存在。
 *
 * 设计上的两点取舍
 * ----------------
 * 1. **默认值不落盘**：`bindings` 只存**被玩家改过的**动作。没改过的动作读的时候回落到
 *    `DEFAULT_BINDINGS`。这样以后调整默认键位，老玩家的存档不会把旧默认值钉死。
 * 2. **坏存档不能卡死游戏**：读盘全程 try/catch，字段缺失/类型不对/JSON 坏掉一律回落
 *    默认值并打 warn。设置坏了大不了回到出厂状态，不该让游戏起不来。
 */

export type AudioChannel = 'master' | 'bgm' | 'sfx';

export interface GameSettingsData {
    version: number;
    audio: Record<AudioChannel, number>;
    /** 只存被改过的动作，其余回落默认表 */
    bindings: Partial<Record<GameAction, Binding[]>>;
}

/** `settings-changed` 事件的负载 */
export interface SettingsChangedEvent {
    /** 哪些部分变了 */
    audio: boolean;
    bindings: boolean;
}

const STORAGE_KEY = 'yunxiu.settings';
/** 存档结构版本。字段含义变了才 +1，并在 `load()` 里处理旧版。 */
const VERSION = 1;

const DEFAULT_AUDIO: Record<AudioChannel, number> = {
    master: 0.8,
    bgm: 0.7,
    sfx: 0.8,
};

// ============================================================ 存储后端

/**
 * 极薄的存储后端。
 *
 * ⚠️ **当前只实现了 Web**：`sys.localStorage` 在**原生平台是没有实现的**
 * （引擎 `cocos/core/platform/sys.ts` 只在有 `window.localStorage` 时接上，
 * 否则降级成 warn stub；`pal/` 下根本没有 localStorage 的实现）。
 * 也就是说**打包成原生 App 后，设置不会持久化**。
 * 真要上原生得在 `native` 分支里接 `native.fileUtils` 的
 * `getWritablePath()` / `writeStringToFile` / `getStringFromFile`。
 * 现在先显式留空，而不是假装它能用。
 */
const storage = {
    read(): string | null {
        if (sys.isBrowser) {
            try {
                return sys.localStorage.getItem(STORAGE_KEY);
            }
            catch (e) {
                // 隐私模式 / 站点数据被禁会抛
                warn('[GameSettings] 读取本地存储失败，用默认设置：', e);
                return null;
            }
        }
        // TODO(原生/小游戏)：接 native.fileUtils 读写文件
        return null;
    },

    write(text: string): void {
        if (sys.isBrowser) {
            try {
                sys.localStorage.setItem(STORAGE_KEY, text);
            }
            catch (e) {
                warn('[GameSettings] 写入本地存储失败，本次修改不会保留：', e);
            }
            return;
        }
        // TODO(原生/小游戏)：接 native.fileUtils 写文件
    },
};

// ============================================================ 主体

export class GameSettings {

    private data: GameSettingsData;

    constructor() {
        this.data = this.freshData();
        this.load();
    }

    private freshData(): GameSettingsData {
        return {
            version: VERSION,
            audio: { ...DEFAULT_AUDIO },
            bindings: {},
        };
    }

    // ------------------------------------------------ 音量

    public getVolume(channel: AudioChannel): number {
        return this.data.audio[channel];
    }

    public setVolume(channel: AudioChannel, value: number): void {
        const v = clamp01(value);
        if (this.data.audio[channel] === v) {
            return;
        }
        this.data.audio[channel] = v;
        this.save();
        this.notify(true, false);
    }

    public resetAudio(): void {
        this.data.audio = { ...DEFAULT_AUDIO };
        this.save();
        this.notify(true, false);
    }

    // ------------------------------------------------ 键位

    /** 取某个动作的绑定。玩家没改过就回落到默认表。 */
    public getBindings(action: GameAction): Binding[] {
        const custom = this.data.bindings[action];
        const source = custom && custom.length > 0 ? custom : DEFAULT_BINDINGS[action];
        return source.map((b) => ({ ...b }));
    }

    /** 整张绑定表（InputSystem 建反查表用） */
    public getAllBindings(): Record<GameAction, Binding[]> {
        const out = {} as Record<GameAction, Binding[]>;
        for (const action of ALL_ACTIONS) {
            out[action] = this.getBindings(action);
        }
        return out;
    }

    /** 改一条绑定。整条动作的绑定会被固化进存档（不再回落默认）。 */
    public setBinding(action: GameAction, index: number, binding: Binding): boolean {
        const current = this.getBindings(action);
        if (index < 0 || index >= current.length) {
            warn(`[GameSettings] setBinding 越界：${action}[${index}]`);
            return false;
        }
        current[index] = binding;
        this.data.bindings[action] = current;
        this.save();
        this.notify(false, true);
        return true;
    }

    /** 全部恢复默认（把覆盖项清空即可，读的时候自然回落到默认表） */
    public resetBindings(): void {
        this.data.bindings = {};
        this.save();
        this.notify(false, true);
    }

    // ------------------------------------------------ 持久化

    private notify(audio: boolean, bindings: boolean): void {
        const payload: SettingsChangedEvent = { audio, bindings };
        eventBus.emit<SettingsChangedEvent>('settings-changed', payload);
    }

    public save(): void {
        try {
            storage.write(JSON.stringify(this.data));
        }
        catch (e) {
            warn('[GameSettings] 序列化设置失败：', e);
        }
    }

    /** 读档。任何异常都回落默认值，**绝不抛**。 */
    public load(): void {
        const raw = storage.read();
        if (!raw) {
            return;
        }
        try {
            const parsed = JSON.parse(raw) as Partial<GameSettingsData>;
            this.data = this.sanitize(parsed);
            log('[GameSettings] 已载入本地设置');
        }
        catch (e) {
            warn('[GameSettings] 设置文件损坏，已重置为默认值：', e);
            this.data = this.freshData();
        }
    }

    /** 逐字段校验，坏的字段单独回落，不因为一个字段坏掉就丢整份设置 */
    private sanitize(raw: Partial<GameSettingsData>): GameSettingsData {
        const out = this.freshData();

        if (typeof raw.version === 'number' && raw.version > VERSION) {
            // 存档比当前代码新（用户降级了版本）——保守起见整份丢掉，
            // 硬读可能把不认识的字段当已知字段用
            warn(`[GameSettings] 存档版本 ${raw.version} 高于当前 ${VERSION}，重置为默认值`);
            return out;
        }

        const audio = raw.audio as Partial<Record<AudioChannel, number>> | undefined;
        if (audio && typeof audio === 'object') {
            for (const ch of ['master', 'bgm', 'sfx'] as AudioChannel[]) {
                const v = audio[ch];
                if (typeof v === 'number' && Number.isFinite(v)) {
                    out.audio[ch] = clamp01(v);
                }
            }
        }

        const bindings = raw.bindings;
        if (bindings && typeof bindings === 'object') {
            for (const action of ALL_ACTIONS) {
                const list = (bindings as Record<string, unknown>)[action];
                if (Array.isArray(list) && list.length > 0 && list.every(isBinding)) {
                    out.bindings[action] = list as Binding[];
                }
            }
        }

        return out;
    }
}

// ============================================================ 工具

function clamp01(v: number): number {
    if (!Number.isFinite(v)) {
        return 0;
    }
    return Math.min(1, Math.max(0, v));
}

function isBinding(v: unknown): v is Binding {
    if (!v || typeof v !== 'object') {
        return false;
    }
    const b = v as { kind?: unknown; key?: unknown; button?: unknown };
    if (b.kind === 'key') {
        return typeof b.key === 'number';
    }
    if (b.kind === 'gamepad' || b.kind === 'mouse') {
        return typeof b.button === 'number';
    }
    return false;
}

/** 模块级单例。构造时就把存档读进来，早于任何场景运行。 */
export const gameSettings = new GameSettings();
