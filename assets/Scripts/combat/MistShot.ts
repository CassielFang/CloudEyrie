import { _decorator, Component, RigidBody2D, BoxCollider2D, Vec2, IPhysics2DContact, Contact2DType, log } from 'cc';
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

    /**
     * 本帧已判定撞上的目标，等 `update` 里再结算。
     *
     * ⚠️ **不能在接触回调里结算 + `destroy()`** —— Box2D 不允许在回调里动刚体，
     * 会报 `Can not active RigidBody in contact listener`。
     * `MinionArrow` 在同一个坑上栽过（那次是在回调里销毁自己），修法就是记个标记、
     * 交给下一帧；这里照抄。
     */
    private pendingTarget: Damageable | null = null;

    /** 出生时由 CombatController 传进来的可受击目标（和近战共用那份缓存） */
    private targets: Damageable[] = [];

    /**
     * 矩形重叠判定用的半边长（世界单位）。
     *
     * 用的是**美术尺寸**（`MIST_SHOT_SIZE` 28）的一半，比物理体（18）略宽松，
     * 手感上更跟手一点。抛射物本身就是个小矩形，直接算重叠既简单又一眼能验。
     */
    private static readonly HIT_HALF = 14;

    private onBeginContact = (self: BoxCollider2D, other: BoxCollider2D, contact: IPhysics2DContact | null): void => {
        if (this.pendingTarget) {
            return;
        }
        const damageable = other.node.getComponent(Damageable);
        if (damageable) {
            this.pendingTarget = damageable;
        }
    };

    /**
     * **按矩形重叠判定命中**，不依赖物理接触。
     *
     * 为什么接触之外还要留这一条：见 `CombatController.buildFallbackShotNode` 里
     * `enabledContactListener` 那段 —— 接触链路要同时穿过「刚体开关 → 碰撞分组 →
     * 夹具过滤位 → 夹具重建」几道关，**任何一道出错都是静默失败**，
     * 而且每一处读回来的值看着都是对的（`MinionArrow` 的注释里记着同样的教训）。
     *
     * 两条路都汇到 `pendingTarget`，所以不会重复结算。
     */
    private hitTest(): Damageable | null {
        const a = this.node.worldPosition;
        for (const t of this.targets) {
            if (!t || !t.isValid || !t.node.active) {
                continue;
            }
            // 目标体积取其 BoxCollider2D；拿不到就退回一个球员大小的默认盒子
            const col = t.getComponent(BoxCollider2D);
            const usable = col && col.size.width > 1 && col.size.height > 1;
            const halfW = usable ? col!.size.width / 2 : 40;
            const halfH = usable ? col!.size.height / 2 : 75;
            const offY = usable ? col!.offset.y : 0;
            const p = t.node.worldPosition;
            if (Math.abs(a.x - p.x) > halfW + MistShot.HIT_HALF) {
                continue;
            }
            if (Math.abs(a.y - (p.y + offY)) > halfH + MistShot.HIT_HALF) {
                continue;
            }
            return t;
        }
        return null;
    }

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

    public init(dir: Vec2, speed: number, damage: number, lifetime = 2.0,
                targets: Damageable[] = []): void {
        this.dir = dir.clone();
        this.speed = speed;
        this.damage = damage;
        this.lifetime = lifetime;
        this.life = 0;
        this.targets = targets;
    }

    protected update(dt: number): void {
        // 命中结算放在物理回调之外（见 pendingTarget 的说明）
        if (this.pendingTarget) {
            const target = this.pendingTarget;
            this.pendingTarget = null;
            target.takeDamage({
                amount: this.damage,
                // 击退量走配置（原先硬编码 0.5，实测推得太远）
                knockback: new Vec2(this.dir.x * gameConfig.combat.mistShotKnockback, 0),
                sourceForm: CompanionForm.Mist,
                isMistShot: true,
            });
            log(`[MistShot] 命中 ${target.node.name}，伤害 ${this.damage.toFixed(1)}`);
            this.node.destroy();
            return;
        }

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

        // 走完这一步再判重叠：接触事件是异步来的，这条是每帧自己算的，
        // 两条路谁先发现都行，结算都走上面那段
        const hit = this.hitTest();
        if (hit) {
            this.pendingTarget = hit;
        }
    }
}
