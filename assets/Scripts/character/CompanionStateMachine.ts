import { _decorator, Component, log } from 'cc';
const { ccclass } = _decorator;

import { eventBus } from '../core/EventBus';
import { GameAction } from '../core/InputActions';
import { inputSystem } from '../core/InputSystem';
import { spiritEnergySystem } from '../core/SpiritEnergySystem';
import { gameConfig } from '../core/GameConfig';
import { CompanionForm, FormContext, ICompanionForm } from './forms/ICompanionForm';
import { EntityForm } from './forms/EntityForm';
import { MistForm } from './forms/MistForm';
import { MergeForm } from './forms/MergeForm';

export interface CompanionFormChangedEvent {
    previous: CompanionForm;
    current: CompanionForm;
    reason: 'manual' | 'forced';
}

/**
 * 灵伴三形态状态机（挂载在青禾节点上）
 *
 * 只负责「跨形态的规则」：当前形态、状态转换、成本、冷却、休眠、强制切雾。
 * 各形态自身的移动/消耗内聚在 forms/ 下的状态类里（状态模式），
 * 由 QingheController 每帧调用 tick(dt, ctx) 驱动。
 *
 * 转换规则（week1 3.2）：
 * - 实体 ↔ 灵雾：手动，消耗 10 / 5
 * - 灵雾 → 灵合：手动，需灵炁 ≥ mergeMinSpirit，消耗 30
 * - 灵合 → 实体：手动，消耗 15
 * - 灵合 → 灵雾：手动解除（10）或灵炁过低强制
 * - 任意形态 → 灵雾：灵炁 < forcedMistThreshold 强制
 */
@ccclass('CompanionStateMachine')
export class CompanionStateMachine extends Component {

    private form: CompanionForm = CompanionForm.Entity;

    private states: Map<CompanionForm, ICompanionForm> = new Map();
    private currentState!: ICompanionForm;

    /** 切换硬直剩余（期间禁止手动切换） */
    private switchLockRemaining = 0;
    /** 灵合冷却剩余（离开灵合后禁止再次进入） */
    private mergeCooldownRemaining = 0;
    /** 灵合后休眠剩余（休眠期间无法召唤灵伴） */
    private mergeSleepRemaining = 0;

    protected onLoad(): void {
        this.states.set(CompanionForm.Entity, new EntityForm());
        this.states.set(CompanionForm.Mist, new MistForm());
        this.states.set(CompanionForm.Merge, new MergeForm());
        this.currentState = this.states.get(CompanionForm.Entity)!;
    }

    /**
     * 形态切换的按键读取。
     *
     * 由 `QingheController.update` 每帧驱动 —— 动作层没有「事件回调」这种入口，
     * 边沿要在帧内轮询（`wasPressed` 只在按下的那一帧为 true，锁存在 END_FRAME 清）。
     */
    private pollSwitchKeys(): void {
        if (inputSystem.wasPressed(GameAction.FormSwitch)) {
            // 实体 ↔ 灵雾
            if (this.form === CompanionForm.Entity) {
                this.trySwitchTo(CompanionForm.Mist);
            }
            else if (this.form === CompanionForm.Mist) {
                this.trySwitchTo(CompanionForm.Entity);
            }
        }
        if (inputSystem.wasPressed(GameAction.FormMerge)) {
            // 灵雾 → 灵合；灵合 → 实体
            if (this.form === CompanionForm.Mist) {
                this.trySwitchTo(CompanionForm.Merge);
            }
            else if (this.form === CompanionForm.Merge) {
                this.trySwitchTo(CompanionForm.Entity);
            }
        }
    }

    public getCurrentForm(): CompanionForm {
        return this.form;
    }

    public isSwitchLocked(): boolean {
        return this.switchLockRemaining > 0;
    }

    /** 手动切换到目标形态（受硬直、冷却、灵炁约束） */
    public trySwitchTo(target: CompanionForm): boolean {
        return this.applySwitch(target, 'manual');
    }

    /**
     * 每帧形态逻辑（由 QingheController 驱动）：
     * 计时器衰减 + 移动 + 持续消耗 + 强制切雾
     */
    public tick(dt: number, ctx: FormContext): void {
        // 切换键先读：它走的是形态机自己的硬直/冷却，和下面的移动是两码事
        this.pollSwitchKeys();

        this.switchLockRemaining = Math.max(0, this.switchLockRemaining - dt);
        this.mergeCooldownRemaining = Math.max(0, this.mergeCooldownRemaining - dt);
        this.mergeSleepRemaining = Math.max(0, this.mergeSleepRemaining - dt);

        // 移动（委托给当前形态状态）
        this.currentState.update(dt, ctx);

        // 持续消耗
        const drain = this.currentState.drainPerSecond();
        if (drain > 0) {
            spiritEnergySystem.consume(drain * dt);
        }

        // 灵炁过低强制切灵雾
        this.checkForcedMist();
    }

    private applySwitch(target: CompanionForm, reason: 'manual' | 'forced'): boolean {
        if (target === this.form) {
            return false;
        }

        const spirit = gameConfig.spirit;

        if (reason === 'manual') {
            if (this.switchLockRemaining > 0) {
                log('[Companion] 切换硬直中，无法切换');
                return false;
            }

            const result = this.resolveManualSwitch(target);
            if (!result.allowed) {
                log('[Companion] ', result.reason);
                return false;
            }
            if (!spiritEnergySystem.consume(result.cost)) {
                log('[Companion] 灵炁不足，切换失败');
                return false;
            }
        }

        const previous = this.form;
        this.form = target;
        this.currentState = this.states.get(target)!;

        if (reason === 'manual') {
            this.switchLockRemaining = spirit.switchLockDuration;
        }

        // 离开灵合：进入冷却 + 休眠
        if (previous === CompanionForm.Merge) {
            this.mergeCooldownRemaining = spirit.mergeCooldown;
            this.mergeSleepRemaining = spirit.mergeSleepDuration;
        }

        eventBus.emit<CompanionFormChangedEvent>('companion-form-changed', {
            previous,
            current: this.form,
            reason,
        });
        log(`[Companion] 形态切换 ${previous} -> ${this.form} (${reason})`);
        return true;
    }

    /** 解析手动切换：返回是否允许 + 原因 + 灵炁消耗 */
    private resolveManualSwitch(target: CompanionForm): { allowed: boolean; reason: string; cost: number } {
        const spirit = gameConfig.spirit;

        switch (target) {
            case CompanionForm.Mist:
                if (this.form === CompanionForm.Entity) {
                    return { allowed: true, reason: '', cost: spirit.switchEntityToMist };
                }
                if (this.form === CompanionForm.Merge) {
                    return { allowed: true, reason: '', cost: spirit.switchMergeToMist };
                }
                return { allowed: false, reason: '无法切到灵雾', cost: 0 };

            case CompanionForm.Entity:
                if (this.form === CompanionForm.Mist) {
                    return { allowed: true, reason: '', cost: spirit.switchMistToEntity };
                }
                if (this.form === CompanionForm.Merge) {
                    return { allowed: true, reason: '', cost: spirit.switchMergeToEntity };
                }
                return { allowed: false, reason: '无法切到实体', cost: 0 };

            case CompanionForm.Merge:
                if (this.form !== CompanionForm.Mist) {
                    return { allowed: false, reason: '只能从灵雾进入灵合', cost: 0 };
                }
                if (this.mergeCooldownRemaining > 0 || this.mergeSleepRemaining > 0) {
                    return { allowed: false, reason: '灵合冷却/休眠中', cost: 0 };
                }
                if (spiritEnergySystem.getCurrent() < spirit.mergeMinSpirit) {
                    return { allowed: false, reason: `灵炁不足 ${spirit.mergeMinSpirit}，无法灵合`, cost: 0 };
                }
                return { allowed: true, reason: '', cost: spirit.switchMistToMerge };

            default:
                return { allowed: false, reason: '未知形态', cost: 0 };
        }
    }


    private checkForcedMist(): void {
        if (this.form === CompanionForm.Mist) {
            return;
        }
        if (spiritEnergySystem.getCurrent() < gameConfig.spirit.forcedMistThreshold) {
            this.applySwitch(CompanionForm.Mist, 'forced');
        }
    }

}
