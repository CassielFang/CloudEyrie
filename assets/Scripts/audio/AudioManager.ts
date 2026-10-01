import { AudioClip, AudioSource, log, warn } from 'cc';

import { eventBus } from '../core/EventBus';
import { AudioChannel, gameSettings, SettingsChangedEvent } from '../core/GameSettings';

/**
 * 音频管理器的**音量接口**。
 *
 * ⚠️ **本轮只做音量，不做播放。**
 * 项目现在一个音频文件都没有（`assets/` 下零个 `.mp3/.wav/.ogg`），
 * `playBgm` / `playSfx` 是**空实现**，等美术/音频组交素材时再填。
 * 但音量这条链路是**完整的、真的**：设置页拖动滑条 → `setChannelVolume` →
 * 落盘 → 广播 → `getEffectiveVolume()` 返回主音量 × 分组音量。
 *
 * 为什么音量要自己封装
 * --------------------
 * 引擎没有全局/分组音量：`AudioSource` 只有单实例 `volume`，引擎自带的
 * `audio-manager.ts` 只管频道抢占与全局暂停，**不做音量聚合**；
 * v2 时代的 `audioEngine.setVolume` 在 3.x 已被移除。
 * 所以「主音量 × BGM/音效」这套必须自己算、自己往每个 AudioSource 上刷。
 */

/** 可独立调节的音轨分组（不含 master，master 是总开关） */
export type AudioBus = 'bgm' | 'sfx';

/** 播 BGM 的选项。填播放时用得上，先定好形状。 */
export interface BgmOptions {
    loop?: boolean;
    fadeIn?: number;
}

/** 播音效的选项 */
export interface SfxOptions {
    /** 相对音量，会在分组音量之上再乘一道 */
    volume?: number;
}

export class AudioManager {

    constructor() {
        // 设置一变就把有效音量刷下去（现在没有 AudioSource 可刷，是空转；
        // 接上播放后这一句就自动生效，不用再改这里）
        eventBus.on<SettingsChangedEvent>('settings-changed', this.onSettingsChanged);
    }

    // ============================================================ 音量（真的）

    public getMasterVolume(): number {
        return gameSettings.getVolume('master');
    }

    public setMasterVolume(v: number): void {
        gameSettings.setVolume('master', v);
    }

    public getChannelVolume(bus: AudioBus): number {
        return gameSettings.getVolume(bus);
    }

    public setChannelVolume(bus: AudioBus, v: number): void {
        gameSettings.setVolume(bus, v);
    }

    /** 实际生效的音量 = 主音量 × 分组音量。播放时用这个值，不要直接用分组值。 */
    public getEffectiveVolume(bus: AudioBus): number {
        return this.getMasterVolume() * this.getChannelVolume(bus);
    }

    /**
     * 把一个 AudioSource 的音量刷成它所在分组的有效音量。
     * 接上播放后，每次新建/复用 AudioSource 都要调一次。
     */
    public applyToSource(source: AudioSource | null, bus: AudioBus, scale = 1): void {
        if (!source || !source.isValid) {
            return;
        }
        source.volume = this.getEffectiveVolume(bus) * scale;
    }

    /** 把有效音量刷到**所有**在播的 AudioSource 上。设置变更时自动调用。 */
    public applyVolumes(): void {
        // 现在没有任何 AudioSource —— 接上播放后在这里遍历在管的声道：
        //   for (const it of this.bgmSources) this.applyToSource(it, 'bgm');
        //   for (const it of this.sfxPool)    this.applyToSource(it, 'sfx');
        log('[AudioManager] applyVolumes（当前无音频素材，空转）');
    }

    // 箭头函数属性：EventBus 回调不绑 target，普通方法的 this 会是 undefined
    private onSettingsChanged = (e: SettingsChangedEvent): void => {
        if (e.audio) {
            this.applyVolumes();
        }
    };

    // ============================================================ 播放（空实现）
    //
    // 接口先定下来，等有音频素材时只填这几个方法体，调用方不用改。
    // 实现时记得：
    //   - 用 getEffectiveVolume() 而不是分组值直接当 volume
    //   - BGM 单声道独占（切歌要先停旧的），音效用池子而不是每次新建 AudioSource
    //   - AudioSource 需要一个 Node，做持久节点（director.addPersistRootNode）
    //     才能跨场景不断

    /** TODO(音频素材接入)：播放背景音乐，单声道独占 */
    public playBgm(clip: AudioClip | null, opts: BgmOptions = {}): void {
        if (!clip) {
            return;
        }
        warn(`[AudioManager] playBgm 尚未实现（clip=${clip.name}, loop=${opts.loop ?? true}）`);
    }

    /** TODO(音频素材接入)：停止背景音乐 */
    public stopBgm(): void {
        // 空
    }

    /** TODO(音频素材接入)：播放一次性音效 */
    public playSfx(clip: AudioClip | null, opts: SfxOptions = {}): void {
        if (!clip) {
            return;
        }
        warn(`[AudioManager] playSfx 尚未实现（clip=${clip.name}, vol=${opts.volume ?? 1}）`);
    }
}

/** 模块级单例，与 `eventBus` / `spiritEnergySystem` / `inputSystem` 同风格 */
export const audioManager = new AudioManager();
