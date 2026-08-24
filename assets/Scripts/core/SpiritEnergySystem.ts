import { GameConfig } from './GameConfig';
import { eventBus } from './EventBus';

export interface SpiritEnergyChangedEvent {
    current: number;
    max: number;
    delta: number;
}

export class SpiritEnergySystem {

    private current: number;
    private readonly max: number;

    constructor() {
        this.max = GameConfig.spirit.max;
        this.current = this.max;
    }

    /**
     * 当前灵炁
     */
    public getCurrent(): number {
        return this.current;
    }

    /**
     * 最大灵炁
     */
    public getMax(): number {
        return this.max;
    }

    /**
     * 当前灵炁比率
     */
    public getRatio(): number {
        return this.max > 0 ? this.current / this.max : 0;
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
     * 恢复灵炁
     */
    public restore(amount: number): void {
        if (amount <= 0) {
            return;
        }
        this.setCurrent(this.current + amount);
    }

    /**
     * 灵炁是否已空
     */
    public isEmpty(): boolean {
        return this.current <= 0;
    }

    /**
     * 灵炁是否已满
     */
    public isFull(): boolean {
        return this.current >= this.max;
    }

    /**
     * 重置灵炁
     */
    public reset(): void {
        this.setCurrent(this.max);
    }

    /**
     * 设置当前灵炁
     * 设置后的灵炁一定在 [0, max] 之间
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
                delta
            }
        );

        if (this.current <= 0) {
            eventBus.emit('spirit-energy-depleted');
        }
    }

    /**
     * 自然恢复灵炁
     */
    public update(dt: number, canNaturalRegen: boolean): void {
        if (dt <= 0 || !canNaturalRegen || this.isFull()) {
            return;
        }
        this.restore(GameConfig.spirit.idleRegenPerSecond * dt);
    }

}

export const spiritEnergySystem = new SpiritEnergySystem();
