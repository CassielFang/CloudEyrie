import { _decorator, Component, RigidBody2D, Vec2, log } from 'cc';
const { ccclass, property } = _decorator;

import { eventBus } from '../core/EventBus';
import { CompanionForm } from '../character/forms/ICompanionForm';

/** 一次伤害结算的数据 */
export interface DamageInfo {
    amount: number;
    /** 击退向量（世界方向，x 长度即击退距离） */
    knockback: Vec2;
    /** 伤害来源形态 */
    sourceForm: CompanionForm;
    /** 是否灵弹（后续阴浊显形区分用） */
    isMistShot?: boolean;
}

/**
 * 可受击组件：敌人 / Boss / 可破坏物统一挂载，只负责「血量 + 受击 + 死亡」。
 * 敌人 AI（行为树）不在此组件内。
 */
@ccclass('Damageable')
export class Damageable extends Component {

    @property({ displayName: '最大生命' })
    private maxHp = 100;

    /**
     * 免伤开关。Boss 第一阶段「未识破前青禾的攻击无效」靠它实现。
     *
     * 放在这个通用底座上而不是写 Boss 的子类：可受击物都可能需要无敌帧/阶段免伤，
     * 且 `CombatController` 的命中判定只认 `Damageable`，子类会被它按基类拿到。
     */
    public invulnerable = false;

    private hp = 100;
    private rigidBody: RigidBody2D | null = null;

    protected onLoad(): void {
        this.hp = this.maxHp;
        this.rigidBody = this.getComponent(RigidBody2D);
    }

    public getHp(): number {
        return this.hp;
    }

    public getMaxHp(): number {
        return this.maxHp;
    }

    /** 剩余血量比例 [0,1]，阶段阈值判定与 UI 用 */
    public getHpRatio(): number {
        return this.maxHp > 0 ? Math.max(0, this.hp) / this.maxHp : 0;
    }

    public isDead(): boolean {
        return this.hp <= 0;
    }

    /**
     * 覆盖血量上限，并把当前血量重置为满。
     * Boss 这类数值由 `gameConfig` 驱动的对象用（`maxHp` 只是 Inspector 默认值）。
     */
    public setMaxHp(value: number): void {
        this.maxHp = Math.max(1, value);
        this.hp = this.maxHp;
    }

    public takeDamage(info: DamageInfo): void {
        if (!this.node.active || this.hp <= 0) {
            return;
        }
        if (this.invulnerable) {
            return;
        }

        this.hp -= info.amount;

        log(`[Damageable] ${this.node.name} 受击 ${info.amount}，剩余 ${Math.max(0, this.hp)}/${this.maxHp}`);

        if (this.hp <= 0) {
            this.hp = 0;
            this.die();
            return;
        }

        // 击退：挂了 onDamaged 的（敌人 AI）自己接管。
        // 它要的是「整段受击硬直内的位移总量」，而不是这里写死的一次速度覆盖 ——
        // AI 每帧都会写水平速度，继续在这里写等于白写。
        if (this.onDamaged) {
            this.onDamaged(this, info);
            return;
        }

        // 未被接管时的默认行为：有刚体则覆盖水平速度（竖直分量保留）
        if (this.rigidBody && info.knockback.lengthSqr() > 0) {
            const v = this.rigidBody.linearVelocity;
            this.rigidBody.linearVelocity = new Vec2(info.knockback.x, v.y);
        }
    }

    /**
     * 死亡前的自定义处理（敌人 AI 可挂上，播放死亡表现后自行停用节点）。
     * 未设置时维持原行为：立即停用节点。
     */
    public onDeath: ((self: Damageable) => void) | null = null;

    /**
     * 受击回调（仅在未致死时触发）。挂上后**接管击退**：本组件不再覆写水平速度，
     * 由接收方自己决定击退曲线。敌人 AI 用它驱动受击硬直（含完美格挡反制）。
     */
    public onDamaged: ((self: Damageable, info: DamageInfo) => void) | null = null;

    private die(): void {
        eventBus.emit('enemy-died', { node: this.node, name: this.node.name });
        if (this.onDeath) {
            this.onDeath(this);
            return;
        }
        this.node.active = false;
    }
}
