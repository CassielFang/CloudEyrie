import { _decorator, Component, RigidBody2D, BoxCollider2D, Vec2, IPhysics2DContact, Contact2DType } from 'cc';
const { ccclass } = _decorator;

import { Damageable } from './Damageable';
import { CompanionForm } from '../character/forms/ICompanionForm';
import { gameConfig } from '../core/GameConfig';

/**
 * 灵雾灵弹：沿方向直线飞行，命中 Damageable 造成伤害后自毁；超时自毁。
 * 由 CombatController 生成（prefab 或 Graphics 兜底节点），并调用 init() 设定参数。
 */
@ccclass('MistShot')
export class MistShot extends Component {

    private rigidBody: RigidBody2D | null = null;
    private collider: BoxCollider2D | null = null;

    private dir = new Vec2(1, 0);
    private speed = 10;
    private damage = 0;
    private life = 0;
    private lifetime = 2.0;

    private onBeginContact = (self: BoxCollider2D, other: BoxCollider2D, contact: IPhysics2DContact | null): void => {
        const damageable = other.node.getComponent(Damageable);
        if (damageable) {
            damageable.takeDamage({
                amount: this.damage,
                // 击退量走配置（原先硬编码 0.5，实测推得太远）
                knockback: new Vec2(this.dir.x * gameConfig.combat.mistShotKnockback, 0),
                sourceForm: CompanionForm.Mist,
                isMistShot: true,
            });
            this.node.destroy();
        }
    };

    protected onLoad(): void {
        this.rigidBody = this.getComponent(RigidBody2D);
        this.collider = this.getComponent(BoxCollider2D);
        if (this.collider) {
            this.collider.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        }
        if (this.rigidBody) {
            this.rigidBody.gravityScale = 0;
        }
    }

    protected onDestroy(): void {
        if (this.collider) {
            this.collider.off(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        }
    }

    public init(dir: Vec2, speed: number, damage: number, lifetime = 2.0): void {
        this.dir = dir.clone();
        this.speed = speed;
        this.damage = damage;
        this.lifetime = lifetime;
        this.life = 0;
    }

    protected update(dt: number): void {
        this.life += dt;
        if (this.life >= this.lifetime) {
            this.node.destroy();
            return;
        }
        if (this.rigidBody) {
            this.rigidBody.linearVelocity = new Vec2(this.dir.x * this.speed, this.dir.y * this.speed);
        } else {
            const p = this.node.position;
            this.node.setPosition(p.x + this.dir.x * this.speed * dt, p.y + this.dir.y * this.speed * dt);
        }
    }
}
