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

    public takeDamage(info: DamageInfo): void {
        if (!this.node.active || this.hp <= 0) {
            return;
        }

        this.hp -= info.amount;

        // 击退：有刚体则覆盖水平速度（竖直分量保留）
        if (this.rigidBody && info.knockback.lengthSqr() > 0) {
            const v = this.rigidBody.linearVelocity;
            this.rigidBody.linearVelocity = new Vec2(info.knockback.x, v.y);
        }

        log(`[Damageable] ${this.node.name} 受击 ${info.amount}，剩余 ${Math.max(0, this.hp)}/${this.maxHp}`);

        if (this.hp <= 0) {
            this.hp = 0;
            this.die();
        }
    }

    /**
     * 死亡前的自定义处理（敌人 AI 可挂上，播放死亡表现后自行停用节点）。
     * 未设置时维持原行为：立即停用节点。
     */
    public onDeath: ((self: Damageable) => void) | null = null;

    private die(): void {
        eventBus.emit('enemy-died', { node: this.node, name: this.node.name });
        if (this.onDeath) {
            this.onDeath(this);
            return;
        }
        this.node.active = false;
    }
}
