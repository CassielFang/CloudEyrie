import {
    _decorator, Component, Node, RigidBody2D, BoxCollider2D, Sprite, Color,
    UIOpacity, Vec2, director, log,
} from 'cc';
const { ccclass } = _decorator;

import { gameConfig } from '../core/GameConfig';
import { spiritEnergySystem } from '../core/SpiritEnergySystem';
import { applyFacingFlip, NaturalFacing } from '../core/FacingFlip';
import { Damageable, DamageInfo } from '../combat/Damageable';
import { CombatController, PlayerDamageResult } from '../combat/CombatController';

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
/** 受击闪色持续时间 /秒 */
const HIT_FLASH_DURATION = 0.12;
/** 死亡表现的缩小比例（终点缩到基准缩放的这么大） */
const DEATH_SHRINK = 0.6;

// 灰盒状态染色（正式美术接入后连同 refreshTint 一起删掉）。
// 提成模块常量而不是实例字段：所有敌人共用同一份，Color 赋值给 Sprite 是拷贝语义，不会串色。
const TINT_PATROL = new Color(255, 255, 255, 255);   // 原色（不染色）
const TINT_DISCOVER = new Color(255, 225, 130, 255); // 黄
const TINT_CHASE = new Color(255, 165, 90, 255);     // 橙
const TINT_ATTACK = new Color(255, 110, 110, 255);   // 红
/**
 * 受击闪色。**不能取白色** —— TINT_PATROL 就是 (255,255,255,255)，
 * 也就是「不染色」，白闪等于没闪，挨打会完全没有视觉反馈。
 * 这里取一个与上面四种都不撞的冷白。
 */
const TINT_HIT = new Color(150, 240, 255, 255);

/** 小怪状态（供调试与后续行为树对接） */
export enum EnemyState {
    Patrol = 'patrol',       // 巡逻
    Discover = 'discover',   // 发现
    Chase = 'chase',         // 追击
    Attack = 'attack',       // 攻击
    Dead = 'dead',           // 死亡
}

/**
 * 小怪 AI（灰盒最小可用版）：巡逻 → 发现 → 追击 → 攻击 → 死亡，
 * 另有一层「受击硬直」叠加态，优先级高于上面全部（设计文档 4.1「优先级2」）。
 *
 * 数值全部来自 gameConfig.enemy（GameManager/GameConfig 的 Inspector 里调），
 * 本组件不暴露 @property，挂到敌人节点即可，要求同节点有：
 *   - RigidBody2D（水平移动）
 *   - Damageable（挂它的 onDeath / onDamaged 回调）
 *   可选 Art 子节点（灰盒立绘，用于朝向翻转 / 状态染色 / 死亡淡出）
 *
 * 与战斗系统的两处接口：
 *   - 打玩家：调 CombatController.receivePlayerDamage()，按返回的 spiritCost 扣灵炁；
 *     perfectBlocked 为真时自己吃反制（被弹开 + 打入硬直）。
 *   - 挨打：接管 Damageable.onDamaged，由击退距离驱动受击硬直（见 enterHitStun）。
 *
 * 战斗状态上报走 spiritEnergySystem.setCombatSource(this, ...)，
 * **不要用 setInCombat** —— 那是全局单布尔，同屏多只敌人会互相覆写。
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

    // 受击硬直（对应设计文档 4.1 的「优先级2：受击硬直」）
    private hitStunRemaining = 0;
    /** 本次硬直的初速：由击退距离换算而来，使整段硬直的位移积分 ≈ 该距离 */
    private hitStunVx0 = 0;
    /** 本次硬直的总时长（进入时快照，避免中途改配置把衰减曲线拉歪） */
    private hitStunTotal = 0;

    // 死亡
    private deathElapsed = 0;
    /** 立绘基准缩放：取绝对值，符号位留给朝向（见 updateDead） */
    private artBaseScaleX = 1;
    private artBaseScaleY = 1;
    private hitFlashRemaining = 0;

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
        // 基准缩放取绝对值：scale.x 的符号位是「朝左/朝右」（见 FacingFlip），
        // 若直接拿来当放大倍率，美术一旦用 scale.x = -1 表达天然朝向，死亡缩小会变成镜像放大
        this.artBaseScaleX = this.artNode ? Math.abs(this.artNode.scale.x) : 1;
        this.artBaseScaleY = this.artNode ? Math.abs(this.artNode.scale.y) : 1;
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
        // 受击回调：挂上即接管击退（Damageable 不再直接写速度），改成走受击硬直
        this.damageable.onDamaged = (_self: Damageable, info: DamageInfo): void => {
            this.enterHitStun(info.knockback.x);
        };

        this.spawnX = this.node.position.x;
        this.pickPatrolTarget();
        log(`[EnemyAI] ${this.node.name} 启动，目标 ${this.target ? this.target.name : '未找到（只会巡逻）'}`);
    }

    protected onDestroy(): void {
        if (this.damageable) {
            this.damageable.onDeath = null;
            this.damageable.onDamaged = null;
        }
        // 必须退订战斗来源：否则战斗中切场景 / 销毁敌人后，
        // 灵炁会永久停在战斗恢复档（1/s），而玩家无从察觉
        spiritEnergySystem.setCombatSource(this, false);
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

        // 受击硬直优先级高于一切行为（设计文档 4.1「优先级2」）：
        // 期间不跑状态机、也不写状态机速度 —— 否则每帧的速度覆写会把击退抹掉，
        // 打小怪就完全没有受击位移了。这里只跑击退曲线。
        if (this.hitStunRemaining > 0) {
            this.updateHitStun(dt);
            this.refreshTint();
            return;
        }

        const dirX = this.dirXToTarget();

        switch (this.state) {
            case EnemyState.Patrol:
                this.updatePatrol(dt);
                break;
            case EnemyState.Discover:
                this.updateDiscover(dt, dirX);
                break;
            case EnemyState.Chase:
                this.updateChase(dirX);
                break;
            case EnemyState.Attack:
                this.updateAttack(dt, dirX);
                break;
            default:
                break;
        }

        this.applyFacing();
        this.refreshTint();
    }

    // ============ 各状态 ============

    private updatePatrol(dt: number): void {
        const config = gameConfig.enemy;
        // 垂直容差之外不算「发现」：从它头顶跳过去不会触发仇恨
        if (this.isTargetInSight()) {
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

    private updateDiscover(dt: number, dirX: number): void {
        this.discoverRemaining -= dt;
        this.facing = dirX;
        this.setVelocityX(0);

        if (this.isTargetInAttackRange() && this.cooldownRemaining <= 0) {
            this.enterAttack();
            return;
        }

        if (this.discoverRemaining <= 0) {
            if (this.isTargetInSight()) {
                this.setState(EnemyState.Chase);
            } else {
                this.enterPatrol();
            }
        }
    }

    private updateChase(dirX: number): void {
        const config = gameConfig.enemy;
        this.facing = dirX;

        if (this.isTargetInAttackRange()) {
            if (this.cooldownRemaining <= 0) {
                this.enterAttack();
            } else {
                // 攻击冷却中，贴脸等待
                this.setVelocityX(0);
            }
            return;
        }

        // 脱战只看水平距离：青禾跳到头顶上属于「暂时够不着」，
        // 不该让它直接放弃追击 —— 小怪又不会飞，落下来就接着打
        if (this.horizontalDistanceToTarget() > config.sightRange * CHASE_LEASH_MULT) {
            this.enterPatrol();
            return;
        }

        this.setVelocityX(dirX * config.chaseSpeed);
    }

    private updateAttack(dt: number, dirX: number): void {
        const config = gameConfig.enemy;
        this.attackElapsed += dt;
        this.facing = dirX;
        this.setVelocityX(0);

        if (!this.attackHitDone && this.attackElapsed >= config.attackStartup) {
            this.attackHitDone = true;
            // 出招瞬间再确认一次：青禾在这段前摇里跳开 / 拉开距离就落空
            if (this.isTargetInAttackRange(ATTACK_REACH_MULT)) {
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
            const k = 1 - DEATH_SHRINK * t;
            // 保留 scale.x 的符号：否则朝左死亡时，尸体会在断气瞬间翻回朝右
            const signX = this.artNode.scale.x < 0 ? -1 : 1;
            this.artNode.setScale(
                signX * this.artBaseScaleX * k,
                this.artBaseScaleY * k,
                this.artNode.scale.z,
            );
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
        // 上报「我是战斗威胁来源」而不是直接置战斗位：同屏多只敌人时互不覆写
        spiritEnergySystem.setCombatSource(this, true);
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
        spiritEnergySystem.setCombatSource(this, false);
        this.pickPatrolTarget();
        // 主动补一次停留计时：从追击切回来时若不设，会立刻往下走、白瞎「停留」参数
        this.patrolPauseRemaining = gameConfig.enemy.patrolPause;
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
        spiritEnergySystem.setCombatSource(this, false);
        log(`[EnemyAI] ${this.node.name} 死亡`);
    }

    /**
     * 进入受击硬直 —— 设计文档 4.1「优先级2：受击硬直」。
     *
     * `knockbackX` 是**击退距离**（游戏单位，与 gameConfig.combat 的
     * comboKnockback / heavyKnockback 同义），不是速度：这里换算成初速，
     * 硬直期间做线性衰减，使位移的时间积分 ≈ 该距离。
     * 好处是击退手感不再依赖 RigidBody2D.linearDamping，调阻尼不会把击退一起改掉。
     *
     * 这也是原先「击退失效」的修复：AI 每帧都在写水平速度，
     * Damageable 写进去的击退速度活不过一帧，所以必须由 AI 自己持有这段曲线。
     */
    private enterHitStun(knockbackX: number): void {
        if (this.state === EnemyState.Dead) {
            return;
        }
        // 只让「带击退的命中」进硬直。
        // 轻击第 1、2 段在配置里击退为 0（只有第 3 段和重击带击退），
        // 若这些也照打硬直，玩家一路轻击就能把小怪永久锁死
        // （每下 0.3s 硬直 > 小怪 0.3s 前摇 + 出招间隔），它一个回合都轮不到。
        // 这两段的受击反馈由闪色提供（applyDamage 里已置 hitFlashRemaining）。
        if (Math.abs(knockbackX) < 1e-6) {
            return;
        }
        const duration = gameConfig.enemy.hitStunDuration;
        this.hitStunRemaining = duration;
        this.hitStunTotal = duration;
        this.hitStunVx0 = duration > 0 ? (2 * knockbackX) / duration : 0;

        // 打断进行中的攻击：置位 attackHitDone，
        // 否则硬直结束后那次「迟到的判定」还会补在玩家身上
        if (this.state === EnemyState.Attack) {
            this.attackHitDone = true;
            this.setState(EnemyState.Chase);
        }
    }

    /** 每帧推进硬直：速度从 hitStunVx0 线性衰减到 0 */
    private updateHitStun(dt: number): void {
        this.hitStunRemaining -= dt;
        const k = this.hitStunTotal > 0 ? Math.max(0, this.hitStunRemaining) / this.hitStunTotal : 0;
        this.setVelocityX(this.hitStunVx0 * k);
    }

    private setState(s: EnemyState): void {
        this.state = s;
    }

    // ============ 战斗结算 ============

    private applyDamage(): void {
        const amount = gameConfig.spirit.enemyYangMeleeDamage;
        const result: PlayerDamageResult = this.targetCombat
            ? this.targetCombat.receivePlayerDamage(amount)
            : { spiritCost: amount, perfectBlocked: false };

        this.hitFlashRemaining = HIT_FLASH_DURATION;

        // 完美格挡反制：把小怪朝背离玩家的方向弹开并打入硬直。
        // 力度暂借重击的击退参数，要单独调再拆一个配置项出来。
        if (result.perfectBlocked) {
            this.enterHitStun(this.dirAwayFromTarget() * gameConfig.combat.heavyKnockback);
            log(`[EnemyAI] ${this.node.name} 被完美格挡反制`);
            return;
        }

        if (result.spiritCost > 0) {
            spiritEnergySystem.damage(result.spiritCost);
        }
        log(`[EnemyAI] 命中玩家，扣灵炁 ${result.spiritCost.toFixed(1)}（原始 ${amount}）`);
    }

    // ============ 工具 ============

    /**
     * 距离判定一律**水平 / 垂直分两个轴**，别退回 Vec3.distance。
     *
     * 本作敌人的 `RigidBody2D.gravityScale = 0`（见 main.scene 的 Canvas/enemy），
     * 它只沿 X 移动、永远停在同一个 Y 上，而青禾会跳。两种错误都真出过：
     *   - 混着算（三维距离）：光是两者 35px 的天然高差就白白吃掉 9% 的攻击距离
     *     （85 -> 77.5），青禾一起跳整段滞空都打不到 —— 表现成「贴着你走却不动手」；
     *   - 只算水平、不管 Y：走到另一个极端，跳到它头顶上照样挨打。
     * 所以水平方向用 config 里的像素值，垂直方向用 `verticalTolerance`
     * 明确表达「算不算在同一层」。
     */
    private horizontalDistanceToTarget(): number {
        if (!this.target) {
            return Infinity;
        }
        return Math.abs(this.target.worldPosition.x - this.node.worldPosition.x);
    }

    /** 与目标的垂直高差绝对值（像素） */
    private verticalOffsetToTarget(): number {
        if (!this.target) {
            return Infinity;
        }
        return Math.abs(this.target.worldPosition.y - this.node.worldPosition.y);
    }

    /**
     * 目标是否算「在 horizontalRange 内」：水平够近 **且** 高差在垂直容差内。
     * 发现距离与攻击距离共用这一套判定。
     */
    private isTargetInRange(horizontalRange: number): boolean {
        if (!this.target) {
            return false;
        }
        if (this.horizontalDistanceToTarget() > horizontalRange) {
            return false;
        }
        return this.verticalOffsetToTarget() <= gameConfig.enemy.verticalTolerance;
    }

    /** 目标是否在视野内（发现 / 脱战判定用） */
    private isTargetInSight(): boolean {
        return this.isTargetInRange(gameConfig.enemy.sightRange);
    }

    /** 目标是否在攻击距离内（reachMult 供命中那一下放宽用） */
    private isTargetInAttackRange(reachMult = 1): boolean {
        return this.isTargetInRange(gameConfig.enemy.attackRange * reachMult);
    }

    /** 背离目标的方向（完美格挡反制用） */
    private dirAwayFromTarget(): number {
        if (!this.target) {
            return -this.facing;
        }
        const dx = this.node.worldPosition.x - this.target.worldPosition.x;
        if (dx !== 0) {
            return dx > 0 ? 1 : -1;
        }
        return -this.facing;
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
            this.artSprite.color = TINT_HIT;
            return;
        }
        switch (this.state) {
            case EnemyState.Discover:
                this.artSprite.color = TINT_DISCOVER;
                break;
            case EnemyState.Chase:
                this.artSprite.color = TINT_CHASE;
                break;
            case EnemyState.Attack:
                this.artSprite.color = TINT_ATTACK;
                break;
            case EnemyState.Patrol:
            case EnemyState.Dead:
            default:
                this.artSprite.color = TINT_PATROL;
                break;
        }
    }
}
