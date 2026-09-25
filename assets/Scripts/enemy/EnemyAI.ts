import {
    _decorator, Component, Node, RigidBody2D, BoxCollider2D, Sprite, Color,
    UIOpacity, Vec2, Vec3, director, log,
} from 'cc';
const { ccclass } = _decorator;

import { gameConfig } from '../core/GameConfig';
import { spiritEnergySystem } from '../core/SpiritEnergySystem';
import { applyFacingFlip, NaturalFacing } from '../core/FacingFlip';
import { Damageable } from '../combat/Damageable';
import { CombatController } from '../combat/CombatController';

/**
 * 敌人灰盒立绘的天然朝向（素材本身画的是朝右）。
 * 改美术素材后若朝向变了，改这一个常量即可（同 QingheController 的约定）。
 */
const ART_NATURAL_FACING: NaturalFacing = 1;
/** 巡逻点到达判定阈值（像素） */
const PATROL_ARRIVE_EPS = 12;
/** 追击脱战余量：目标距离超过「视野 × 此倍数」才放弃追击 */
const CHASE_LEASH_MULT = 1.3;
/** 攻击命中允许的目标位移余量（攻击范围 × 此倍数） */
const ATTACK_REACH_MULT = 1.25;

/** 小怪状态（供调试与后续行为树对接） */
export enum EnemyState {
    Patrol = 'patrol',       // 巡逻
    Discover = 'discover',   // 发现
    Chase = 'chase',         // 追击
    Attack = 'attack',       // 攻击
    Dead = 'dead',           // 死亡
}

/**
 * 小怪 AI（灰盒最小可用版）：巡逻 → 发现 → 追击 → 攻击 → 死亡。
 *
 * 数值全部来自 gameConfig.enemy（GameManager/GameConfig 的 Inspector 里调），
 * 本组件不暴露 @property，挂到敌人节点即可，要求同节点有：
 *   - RigidBody2D（水平移动）
 *   - Damageable（掉血 / 死亡回调）
 *   可选 Art 子节点（灰盒立绘，用于朝向翻转 / 状态染色 / 死亡淡出）
 *
 * 攻击命中玩家时调用 CombatController.receivePlayerDamage()，把格挡 / 完美格挡
 * 判定的结果（实际扣灵炁量）经 spiritEnergySystem.damage() 结算。
 */
@ccclass('EnemyAI')
export class EnemyAI extends Component {

    private rigidBody: RigidBody2D | null = null;
    private damageable: Damageable | null = null;
    private target: Node | null = null;
    private targetCombat: CombatController | null = null;
    private artNode: Node | null = null;
    private artSprite: Sprite | null = null;
    private opacity: UIOpacity | null = null;

    private state: EnemyState = EnemyState.Patrol;
    private facing = 1;

    // 巡逻
    private spawnX = 0;
    private patrolTargetX = 0;
    private patrolPauseRemaining = 0;

    // 发现
    private discoverRemaining = 0;

    // 攻击
    private attackElapsed = 0;
    private attackHitDone = false;
    private cooldownRemaining = 0;

    // 死亡
    private deathElapsed = 0;
    private baseScale = 1;
    private hitFlashRemaining = 0;

    // 状态染色（灰盒视觉，正式美术接入后删掉）
    private readonly COLOR_PATROL = new Color(255, 255, 255, 255);
    private readonly COLOR_DISCOVER = new Color(255, 225, 130, 255);
    private readonly COLOR_CHASE = new Color(255, 165, 90, 255);
    private readonly COLOR_ATTACK = new Color(255, 110, 110, 255);

    protected onLoad(): void {
        this.rigidBody = this.getComponent(RigidBody2D);
        if (!this.rigidBody) {
            throw new Error('[EnemyAI] RigidBody2D not found!');
        }
        this.damageable = this.getComponent(Damageable);
        if (!this.damageable) {
            throw new Error('[EnemyAI] Damageable not found!');
        }

        // 刚体不允许休眠：休眠后接触评估会停摆（项目已在攻击命中盒上栽过）
        this.rigidBody.allowSleep = false;
        this.rigidBody.wakeUp();

        this.artNode = this.node.getChildByName('Art');
        this.artSprite = this.artNode ? this.artNode.getComponent(Sprite) : null;
        this.baseScale = this.artNode ? this.artNode.scale.x : 1;
        this.opacity = this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);

        // 目标：默认找 Canvas/Qinghe（同 DebugHud 的约定）
        if (!this.target) {
            const scene = director.getScene();
            this.target = scene ? scene.getChildByPath('Canvas/Qinghe') : null;
        }
        this.targetCombat = this.target ? this.target.getComponent(CombatController) : null;

        // 死亡回调：Damageable 掉血到 0 时交给 AI 播放死亡表现
        this.damageable.onDeath = (): void => {
            this.enterDead();
        };

        this.spawnX = this.node.position.x;
        this.pickPatrolTarget();
        log(`[EnemyAI] ${this.node.name} 启动，目标 ${this.target ? this.target.name : '未找到'}`);
    }

    protected onDestroy(): void {
        if (this.damageable) {
            this.damageable.onDeath = null;
        }
    }

    protected update(dt: number): void {
        if (this.state === EnemyState.Dead) {
            this.updateDead(dt);
            return;
        }

        // 死亡兜底（Damageable 已把血量清零但还没走到 onDeath 的情况）
        if (!this.damageable || this.damageable.getHp() <= 0) {
            this.enterDead();
            return;
        }

        if (this.cooldownRemaining > 0) {
            this.cooldownRemaining -= dt;
        }
        if (this.hitFlashRemaining > 0) {
            this.hitFlashRemaining -= dt;
        }

        const dist = this.distanceToTarget();
        const dirX = this.dirXToTarget();

        switch (this.state) {
            case EnemyState.Patrol:
                this.updatePatrol(dt, dist);
                break;
            case EnemyState.Discover:
                this.updateDiscover(dt, dist, dirX);
                break;
            case EnemyState.Chase:
                this.updateChase(dt, dist, dirX);
                break;
            case EnemyState.Attack:
                this.updateAttack(dt, dist, dirX);
                break;
            default:
                break;
        }

        this.applyFacing();
        this.refreshTint();
    }

    // ============ 各状态 ============

    private updatePatrol(dt: number, dist: number): void {
        const config = gameConfig.enemy;
        if (this.target && dist <= config.sightRange) {
            this.enterDiscover();
            return;
        }

        this.patrolPauseRemaining -= dt;
        if (this.patrolPauseRemaining > 0) {
            this.setVelocityX(0);
            return;
        }

        const x = this.node.position.x;
        const dx = this.patrolTargetX - x;
        if (Math.abs(dx) <= PATROL_ARRIVE_EPS) {
            this.setVelocityX(0);
            this.pickPatrolTarget();
            this.patrolPauseRemaining = config.patrolPause;
            return;
        }

        const dir = dx > 0 ? 1 : -1;
        this.facing = dir;
        this.setVelocityX(dir * config.patrolSpeed);
    }

    private updateDiscover(dt: number, dist: number, dirX: number): void {
        const config = gameConfig.enemy;
        this.discoverRemaining -= dt;
        this.facing = dirX;
        this.setVelocityX(0);

        if (dist <= config.attackRange && this.cooldownRemaining <= 0) {
            this.enterAttack();
            return;
        }

        if (this.discoverRemaining <= 0) {
            if (this.target && dist <= config.sightRange) {
                this.setState(EnemyState.Chase);
            } else {
                this.enterPatrol();
            }
        }
    }

    private updateChase(dt: number, dist: number, dirX: number): void {
        const config = gameConfig.enemy;
        this.facing = dirX;

        if (dist <= config.attackRange) {
            if (this.cooldownRemaining <= 0) {
                this.enterAttack();
            } else {
                // 攻击冷却中，贴脸等待
                this.setVelocityX(0);
            }
            return;
        }

        if (dist > config.sightRange * CHASE_LEASH_MULT) {
            this.enterPatrol();
            return;
        }

        this.setVelocityX(dirX * config.chaseSpeed);
    }

    private updateAttack(dt: number, dist: number, dirX: number): void {
        const config = gameConfig.enemy;
        this.attackElapsed += dt;
        this.facing = dirX;
        this.setVelocityX(0);

        if (!this.attackHitDone && this.attackElapsed >= config.attackStartup) {
            this.attackHitDone = true;
            if (dist <= config.attackRange * ATTACK_REACH_MULT) {
                this.applyDamage();
            } else {
                log('[EnemyAI] 攻击落空（目标已离开范围）');
            }
        }

        if (this.attackElapsed >= config.attackDuration) {
            this.setState(EnemyState.Chase);
        }
    }

    private updateDead(dt: number): void {
        const config = gameConfig.enemy;
        if (config.deathDuration <= 0) {
            this.node.active = false;
            return;
        }

        this.deathElapsed += dt;
        const t = Math.min(1, this.deathElapsed / config.deathDuration);

        // 缩小 + 淡出
        if (this.artNode) {
            const s = this.baseScale * (1 - 0.6 * t);
            this.artNode.setScale(s, s, 1);
        }
        if (this.opacity) {
            this.opacity.opacity = Math.round(255 * (1 - t));
        }

        if (t >= 1) {
            this.node.active = false;
        }
    }

    // ============ 状态切换 ============

    private enterDiscover(): void {
        this.setState(EnemyState.Discover);
        this.discoverRemaining = gameConfig.enemy.discoverDuration;
        this.setVelocityX(0);
        this.facing = this.dirXToTarget();
        spiritEnergySystem.setInCombat(true);
        log(`[EnemyAI] ${this.node.name} 发现玩家`);
    }

    private enterAttack(): void {
        const config = gameConfig.enemy;
        this.setState(EnemyState.Attack);
        this.attackElapsed = 0;
        this.attackHitDone = false;
        this.cooldownRemaining = config.attackCooldown;
        this.facing = this.dirXToTarget();
        this.setVelocityX(0);
        log(`[EnemyAI] ${this.node.name} 攻击`);
    }

    private enterPatrol(): void {
        this.setState(EnemyState.Patrol);
        spiritEnergySystem.setInCombat(false);
        this.pickPatrolTarget();
        log(`[EnemyAI] ${this.node.name} 返回巡逻`);
    }

    private enterDead(): void {
        if (this.state === EnemyState.Dead) {
            return;
        }
        this.setState(EnemyState.Dead);
        this.deathElapsed = 0;
        this.setVelocityX(0);

        // 关闭物理，避免死亡后继续被打 / 被碰撞
        const col = this.getComponent(BoxCollider2D);
        if (col) {
            col.enabled = false;
        }
        if (this.rigidBody) {
            this.rigidBody.enabled = false;
        }
        spiritEnergySystem.setInCombat(false);
        log(`[EnemyAI] ${this.node.name} 死亡`);
    }

    private setState(s: EnemyState): void {
        this.state = s;
    }

    // ============ 战斗结算 ============

    private applyDamage(): void {
        const amount = gameConfig.spirit.enemyYangMeleeDamage;
        const actual = this.targetCombat ? this.targetCombat.receivePlayerDamage(amount) : amount;
        if (actual > 0) {
            spiritEnergySystem.damage(actual);
        }
        this.hitFlashRemaining = 0.12;
        log(`[EnemyAI] 命中玩家，扣灵炁 ${actual.toFixed(1)}（原始 ${amount}）`);
    }

    // ============ 工具 ============

    private distanceToTarget(): number {
        if (!this.target) {
            return Infinity;
        }
        return Vec3.distance(this.node.worldPosition, this.target.worldPosition);
    }

    private dirXToTarget(): number {
        if (!this.target) {
            return this.facing;
        }
        return this.target.worldPosition.x >= this.node.worldPosition.x ? 1 : -1;
    }

    private setVelocityX(vx: number): void {
        if (!this.rigidBody) {
            return;
        }
        const v = this.rigidBody.linearVelocity;
        this.rigidBody.linearVelocity = new Vec2(vx, v.y);
    }

    private pickPatrolTarget(): void {
        const range = gameConfig.enemy.patrolRange;
        this.patrolTargetX = this.spawnX + (Math.random() * 2 - 1) * range;
    }

    private applyFacing(): void {
        applyFacingFlip(this.artNode, this.facing, ART_NATURAL_FACING);
    }

    private refreshTint(): void {
        if (!this.artSprite) {
            return;
        }
        if (this.hitFlashRemaining > 0) {
            this.artSprite.color = this.COLOR_PATROL;
            return;
        }
        switch (this.state) {
            case EnemyState.Discover:
                this.artSprite.color = this.COLOR_DISCOVER;
                break;
            case EnemyState.Chase:
                this.artSprite.color = this.COLOR_CHASE;
                break;
            case EnemyState.Attack:
                this.artSprite.color = this.COLOR_ATTACK;
                break;
            case EnemyState.Patrol:
            case EnemyState.Dead:
            default:
                this.artSprite.color = this.COLOR_PATROL;
                break;
        }
    }
}
