import { gameConfig } from './GameConfig';
import { eventBus } from './EventBus';

export interface SpiritEnergyChangedEvent {
    current: number;
    max: number;
    delta: number;
}

/**
 * 灵炁共享池（模块级单例）
 *
 * v1 模型：实体形态不按秒持续扣灵炁，而是按动作消耗（轻击/重击/踏云闪等），
 * 灵炁在实体态自动恢复。恢复分战斗 / 非战斗两档，并受灵脉潮汐倍率影响；
 * 站在灵泉内额外以固定速率恢复。
 *
 * 注意：max 等数值惰性读取 gameConfig，避免在 GameConfig 组件同步前缓存旧值。
 */
export class SpiritEnergySystem {

    private current: number;

    /** 是否处于战斗状态（决定恢复速率档位） */
    private inCombat = false;
    /**
     * 当前正在威胁玩家的来源集合（每只敌人 AI 是一个来源）。
     * 用集合而不是布尔：同屏多只敌人时，一只回巡逻 / 死亡不能把另一只的「战斗中」也抹掉。
     */
    private combatSources = new Set<object>();
    /** 手动覆盖（自测与调试用）：非 null 时优先于 combatSources */
    private combatOverride: boolean | null = null;
    /** 灵脉潮汐恢复倍率（默认 1，高潮 2、低潮 0.5） */
    private tideRegenMult = 1.0;
    /** 是否站在灵泉范围内 */
    private inSpring = false;

    constructor() {
        this.current = gameConfig.spirit.initial;
    }

    /** 最大灵炁（惰性读取，勿缓存） */
    public get max(): number {
        return gameConfig.spirit.max;
    }

    /** 当前灵炁 */
    public getCurrent(): number {
        return this.current;
    }

    /** 当前灵炁比率 [0, 1] */
    public getRatio(): number {
        return this.max > 0 ? this.current / this.max : 0;
    }

    /**
     * 手动设置战斗状态：**会覆盖**所有来源上报的状态（自测 / 调试用）。
     * 敌人 AI 请用 setCombatSource，不要用这个。
     */
    public setInCombat(value: boolean): void {
        this.combatOverride = value;
        this.refreshInCombat();
    }

    /**
     * 上报/撤销一个战斗威胁来源（敌人 AI 用，传 `this` 即可）。
     * 只要有任意一个来源存在就算战斗中；来源销毁时必须传 false 退订，
     * 否则会永久停在战斗恢复档。
     */
    public setCombatSource(source: object, active: boolean): void {
        if (active) {
            this.combatSources.add(source);
        } else {
            this.combatSources.delete(source);
        }
        this.refreshInCombat();
    }

    /** 当前战斗来源数量（调试用） */
    public getCombatSourceCount(): number {
        return this.combatSources.size;
    }

    private refreshInCombat(): void {
        this.inCombat = this.combatOverride ?? this.combatSources.size > 0;
    }

    public isInCombat(): boolean {
        return this.inCombat;
    }

    public setTideRegenMult(value: number): void {
        this.tideRegenMult = value;
    }

    public setInSpring(value: boolean): void {
        this.inSpring = value;
    }

    /**
     * 是否可以消耗指定数量的灵炁
     */
    public canConsume(amount: number): boolean {
        if (amount < 0) {
            return false;
        }
        return this.current >= amount;
    }

    /**
     * 消耗灵炁
     * 返回 true 表示消耗成功，false 代表灵炁不足，不消耗
     */
    public consume(amount: number): boolean {
        if (!this.canConsume(amount)) {
            return false;
        }
        else if (amount === 0) {
            return true;
        }
        this.setCurrent(this.current - amount);
        return true;
    }

    /**
     * 受到伤害（敌人命中玩家）：扣除灵炁，最低到 0。
     * 与 consume 不同：允许「扣穿」——不足部分直接清零，而不是整次拒绝。
     */
    public damage(amount: number): void {
        if (amount <= 0) {
            return;
        }
        this.setCurrent(this.current - amount);
    }

    /**
     * 恢复灵炁（不会超过上限）
     */
    public restore(amount: number): void {
        if (amount <= 0) {
            return;
        }
        this.setCurrent(this.current + amount);
    }

    /** 灵炁是否已空 */
    public isEmpty(): boolean {
        return this.current <= 0;
    }

    /** 灵炁是否已满 */
    public isFull(): boolean {
        return this.current >= this.max;
    }

    /** 重置为满（灵泉/复活回满） */
    public reset(): void {
        this.setCurrent(this.max);
    }

    /** 重置为游戏开始时的初始值 */
    public resetToInitial(): void {
        this.setCurrent(gameConfig.spirit.initial);
    }

    /**
     * 设置当前灵炁（自动夹在 [0, max] 之间），并广播变化事件
     */
    public setCurrent(value: number): void {
        const previous = this.current;
        this.current = Math.max(0, Math.min(this.max, value));

        if (this.current === previous) {
            return;
        }

        const delta = this.current - previous;

        eventBus.emit<SpiritEnergyChangedEvent>(
            'spirit-energy-changed',
            {
                current: this.current,
                max: this.max,
                delta,
            }
        );

        if (this.current <= 0) {
            eventBus.emit('spirit-energy-depleted');
        }
    }

    /**
     * 每帧更新：自然恢复（战斗/非战斗档位 × 潮汐倍率）+ 灵泉恢复
     */
    public update(dt: number): void {
        if (dt <= 0) {
            return;
        }

        const spirit = gameConfig.spirit;

        // 自然恢复
        if (!this.isFull()) {
            const base = this.inCombat ? spirit.regenInCombat : spirit.regenOutOfCombat;
            const rate = base * this.tideRegenMult;
            if (rate > 0) {
                this.restore(rate * dt);
            }
        }

        // 灵泉恢复（站在范围内，恢复到 capRatio 上限）
        if (this.inSpring) {
            const cap = spirit.max * spirit.springRestoreCapRatio;
            if (this.current < cap) {
                this.restore(spirit.springRestoreRate * dt);
            }
        }
    }

}

export const spiritEnergySystem = new SpiritEnergySystem();
