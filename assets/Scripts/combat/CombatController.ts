import {
    _decorator, Component, Node, Vec2, Vec3, Size, Color,
    BoxCollider2D, RigidBody2D, IPhysics2DContact, Contact2DType,
    Prefab, Graphics, Sprite, SpriteFrame, UITransform, Layers, resources, instantiate,
    Input, EventKeyboard, KeyCode, input,
    log,
} from 'cc';
const { ccclass, property } = _decorator;

/** 挥砍光刃相对角色的水平偏移（朝向前方，仅灰盒视觉用） */
const SLASH_OFFSET_X = 48;
/** 重击光刃更靠前一点（它本身也更大，见节点尺寸） */
const SLASH_HEAVY_OFFSET_X = 66;

/**
 * 灵弹发射点相对角色节点的偏移。
 * 角色节点原点在**脚底**（碰撞体底边），直接拿它当发射点灵弹会从脚底冒出来，
 * 这里按立绘身高抬到胸口、并朝前让开一点。
 */
const MIST_SHOT_SPAWN_X = 26;
const MIST_SHOT_SPAWN_Y = 55;

/** 灵弹显示尺寸 / 碰撞体尺寸 */
const MIST_SHOT_SIZE = 28;
const MIST_SHOT_BODY = 18;
/** 命中火花显示尺寸（再按重击倍数放大） */
const HIT_SPARK_SIZE = 56;

import { eventBus } from '../core/EventBus';
import { applyFacingFlip, NaturalFacing } from '../core/FacingFlip';

/** 光刃素材本身画的是「弧口朝左、弧背鼓向右」—— 即天然朝右 */
const SLASH_NATURAL_FACING: NaturalFacing = 1;
import { spiritEnergySystem } from '../core/SpiritEnergySystem';
import { gameConfig } from '../core/GameConfig';
import { CompanionForm, FormContext } from '../character/forms/ICompanionForm';
import { CompanionFormChangedEvent } from '../character/CompanionStateMachine';
import { Damageable, DamageInfo } from './Damageable';
import { MistShot } from './MistShot';
import { HitSpark } from './HitSpark';

/**
 * 战斗控制器（挂在青禾节点）：独占 J（攻击/蓄力）与 L（格挡）输入，
 * 内聚轻击三连 / 蓄力重击 / 格挡·完美格挡 / 灵雾灵弹，
 * 驱动 AttackHitBox 命中判定并结算伤害与灵炁消耗。
 * 由 QingheController.update 每帧调用 tick(dt, ctx)（先于形态 tick，避免门控延迟一帧）。
 */
@ccclass('CombatController')
export class CombatController extends Component {

    // ---- 攻击时序（从 QingheController 迁来） ----
    @property({ group: '战斗时序', displayName: '前摇/秒' })
    private attackStartup = 0.1;
    @property({ group: '战斗时序', displayName: '判定期/秒' })
    private attackActiveDuration = 0.2;
    @property({ group: '战斗时序', displayName: '后摇/秒' })
    private attackRecovery = 0.1;

    @property({ type: Prefab, group: '战斗', displayName: '灵弹预制体(可选)' })
    private mistShotPrefab: Prefab | null = null;

    private attackHitBox: BoxCollider2D | null = null;
    /** 判定盒中心（相对角色节点）；onLoad 折算一次后不再变 */
    private attackHitBoxLocalPos = new Vec3();
    private attackHitBoxCenterReady = false;

    // ---- 灰盒视觉（可选子节点，缺了不影响任何逻辑与判定）----
    /** 轻击光刃（判定期显示） */
    private slashLight: Node | null = null;
    /** 重击光刃 —— 用另一张素材+更大的尺寸，和轻击拉开区分 */
    private slashHeavy: Node | null = null;
    /** 本段攻击是否重击（决定显示哪把光刃） */
    private isHeavyAttack = false;
    /** 格挡时显示的护盾 */
    private shieldNode: Node | null = null;
    /** 灵弹 / 命中火花素材（从 assets/resources 运行时加载，加载失败则退回程序化绘制） */
    private mistShotFrame: SpriteFrame | null = null;
    private hitSparkFrame: SpriteFrame | null = null;

    private ctx: FormContext | null = null;
    private currentForm: CompanionForm = CompanionForm.Entity;

    // ---- 输入状态 ----
    private attackHeld = false;
    private chargeTime = 0;
    private blockHeld = false;
    private blockElapsed = 0;

    // ---- 攻击状态机 ----
    private attacking = false;
    private attackingActive = false;
    private attackTimer = 0;
    private pendingDamage = 0;
    private pendingKnockback = 0;

    // ---- 轻击连段 ----
    private comboIndex = 0;
    private comboTimer = 0;
    /** 攻击进行中收到的轻击输入（收招时自动接上，保证连段流畅） */
    private bufferedLight = false;

    // ---- 格挡 ----
    private blocking = false;

    // ---- 命中去重（每次攻击只结算一次） ----
    private hitSet = new Set<Damageable>();

    // ---- 命中盒当前重叠到的可受击目标（接触事件维护，判定期每帧扫描）----
    private overlapping = new Set<Damageable>();

    private onFormChangedHandler = (event: CompanionFormChangedEvent): void => {
        this.onFormChanged(event);
    };

    protected onLoad(): void {
        const hitBoxNode = this.node.getChildByName('AttackHitBox');
        if (hitBoxNode) {
            this.attackHitBox = hitBoxNode.getComponent(BoxCollider2D);
            // 防御性修正：命中盒是 sensor，关重力避免其动态刚体下坠脱离玩家
            const rb = hitBoxNode.getComponent(RigidBody2D);
            if (rb) {
                rb.gravityScale = 0;
            }
        }
        if (!this.attackHitBox) {
            throw new Error('[Combat] AttackHitBox not found!');
        }
        // 命中盒的实际位置 = 节点位置 + 碰撞体 offset，但**只有节点位置会随朝向翻转**，
        // offset 不会 —— 若 offset 非 0，朝左攻击时判定盒会留在角色身后（够不着敌人）。
        // 这里把 offset 折进 attackHitBoxLocalPos 并把 offset 归零，从根上避免这个坑。
        // 只折算一次：placeAttackHitBox 会移动这个节点，若二次进入 onLoad
        // 会把已被移动的位置当成原始位置，判定盒朝向就反了。
        if (!this.attackHitBoxCenterReady) {
            const hbCol = this.attackHitBox;
            this.attackHitBoxLocalPos = new Vec3(
                this.attackHitBox.node.position.x + hbCol.offset.x,
                this.attackHitBox.node.position.y + hbCol.offset.y,
            );
            if (hbCol.offset.x !== 0 || hbCol.offset.y !== 0) {
                hbCol.offset = new Vec2(0, 0);
                hbCol.apply();
            }
            this.attackHitBoxCenterReady = true;
        }

        // 碰撞体常开（sensor，不挡路），只用来维护重叠集合
        this.attackHitBox.enabled = true;
        this.attackHitBox.on(Contact2DType.BEGIN_CONTACT, this.onAttackBeginContact, this);
        this.attackHitBox.on(Contact2DType.END_CONTACT, this.onAttackEndContact, this);

        // 关键：命中盒静止约 0.5s 会休眠，而 Box2D 对"双方都休眠"的接触对
        // 不再评估 —— 表现就是"站着不动打不到、一走又能打到"。禁止它休眠。
        const hbRb = this.attackHitBox.node.getComponent(RigidBody2D);
        if (hbRb) {
            hbRb.gravityScale = 0;   // 兜底：sensor 不该受重力
            hbRb.allowSleep = false;
            hbRb.wakeUp();
        }

        // 灰盒视觉节点（可选）
        this.slashLight = this.node.getChildByName('Slash');
        if (this.slashLight) {
            this.slashLight.active = false;
        }
        this.slashHeavy = this.node.getChildByName('SlashHeavy');
        if (this.slashHeavy) {
            this.slashHeavy.active = false;
        }
        this.shieldNode = this.node.getChildByName('Shield');
        if (this.shieldNode) {
            this.shieldNode.active = false;
        }

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);

        eventBus.on<CompanionFormChangedEvent>('companion-form-changed', this.onFormChangedHandler);

        // 预加载灰盒特效素材（只有 assets/resources 下的资源能运行时加载）
        resources.load('mist_shot/spriteFrame', SpriteFrame, (err, frame) => {
            if (!err && frame) {
                this.mistShotFrame = frame;
            }
        });
        resources.load('hit_spark/spriteFrame', SpriteFrame, (err, frame) => {
            if (!err && frame) {
                this.hitSparkFrame = frame;
            }
        });
    }

    protected onDestroy(): void {
        if (this.attackHitBox) {
            this.attackHitBox.off(Contact2DType.BEGIN_CONTACT, this.onAttackBeginContact, this);
            this.attackHitBox.off(Contact2DType.END_CONTACT, this.onAttackEndContact, this);
        }
        this.overlapping.clear();
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        eventBus.off<CompanionFormChangedEvent>('companion-form-changed', this.onFormChangedHandler);
    }

    /** 每帧由 QingheController 驱动（先于形态移动，避免门控延迟一帧） */
    public tick(dt: number, ctx: FormContext): void {
        this.ctx = ctx;

        // 蓄力计时（实体形态按住 J）
        if (this.attackHeld && this.currentForm === CompanionForm.Entity) {
            this.chargeTime += dt;
        }
        // 格挡计时（用于完美格挡窗口判定）
        if (this.blockHeld) {
            this.blockElapsed += dt;
        }
        // 连击窗口计时
        if (this.comboTimer > 0) {
            this.comboTimer -= dt;
        }
        // 攻击时序推进
        if (this.attacking) {
            this.updateAttackTiming(dt);
        }

        this.blocking = this.blockHeld && this.currentForm === CompanionForm.Entity;

        // 灰盒视觉：护盾跟随格挡状态
        if (this.shieldNode) {
            this.shieldNode.active = this.blocking;
        }

        // 写回上下文，供形态门控移动/跳跃/冲刺
        ctx.isAttacking = this.attacking;
        ctx.isBlocking = this.blocking;
    }

    // ============ 输入 ============

    private onKeyDown(event: EventKeyboard): void {
        switch (event.keyCode) {
            case KeyCode.KEY_J:
                if (this.attackHeld) {
                    return;
                }
                this.attackHeld = true;
                this.chargeTime = 0;
                if (this.currentForm === CompanionForm.Mist) {
                    this.fireMistShot();
                }
                break;
            case KeyCode.KEY_L:
                if (this.blockHeld) {
                    return;
                }
                this.blockHeld = true;
                this.blockElapsed = 0;
                break;
            default: break;
        }
    }

    private onKeyUp(event: EventKeyboard): void {
        switch (event.keyCode) {
            case KeyCode.KEY_J:
                if (!this.attackHeld) {
                    return;
                }
                this.attackHeld = false;
                if (this.currentForm === CompanionForm.Entity) {
                    this.resolveAttackRelease();
                }
                break;
            case KeyCode.KEY_L:
                this.blockHeld = false;
                break;
            default: break;
        }
    }

    private resolveAttackRelease(): void {
        const isLight = this.chargeTime < gameConfig.combat.lightTapThreshold;
        if (!isLight) {
            // 重击不缓存：蓄力是"有意识"的动作，攻击中按就直接丢弃
            if (!this.attacking) {
                this.doHeavyAttack();
            }
            return;
        }

        if (this.attacking) {
            // 攻击中再点轻击 -> 缓存下来，收招瞬间接上，连段才不会断
            this.bufferedLight = true;
            return;
        }
        this.doLightAttack();
    }

    // ============ 轻击三连 / 蓄力重击 ============

    private doLightAttack(): void {
        if (this.attacking) {
            return;
        }
        const spirit = gameConfig.spirit;
        if (!spiritEnergySystem.canConsume(spirit.lightAttackCost)) {
            log('[Combat] 灵炁不足，无法轻击');
            return;
        }
        spiritEnergySystem.consume(spirit.lightAttackCost);

        const combat = gameConfig.combat;
        if (this.comboTimer <= 0) {
            this.comboIndex = 0;
        }
        this.comboIndex += 1;
        if (this.comboIndex > 3) {
            this.comboIndex = 1;
        }
        this.comboTimer = combat.comboWindow;

        const mult = combat.comboDamageMult[this.comboIndex - 1];
        const knockback = this.comboIndex === 3 ? combat.comboKnockback : 0;
        this.beginAttack(mult, knockback);
        log(`[Combat] 轻击第${this.comboIndex}段 (x${mult})`);
    }

    private doHeavyAttack(): void {
        if (this.attacking) {
            return;
        }
        const spirit = gameConfig.spirit;
        if (!spiritEnergySystem.canConsume(spirit.heavyAttackCost)) {
            log('[Combat] 灵炁不足，无法蓄力重击');
            return;
        }
        spiritEnergySystem.consume(spirit.heavyAttackCost);

        const combat = gameConfig.combat;
        const isFull = this.chargeTime >= combat.heavyChargeTime;
        const mult = isFull ? combat.heavyFullDamageMult : combat.heavyHalfDamageMult;
        this.comboIndex = 0;
        this.comboTimer = 0;
        this.beginAttack(mult, combat.heavyKnockback);
        log(`[Combat] 蓄力重击 ${isFull ? '满蓄' : '半蓄'} (x${mult})`);
    }

    private beginAttack(damageMult: number, knockbackDist: number): void {
        this.attacking = true;
        this.attackingActive = false;
        this.attackTimer = 0;
        this.hitSet.clear();

        this.pendingDamage = gameConfig.combat.baseLightDamage * damageMult;
        this.pendingKnockback = knockbackDist;

        this.placeAttackHitBox();


        // 灰盒视觉：以重击半蓄倍率为界，决定这一段用哪把光刃
        this.isHeavyAttack = damageMult >= gameConfig.combat.heavyHalfDamageMult;
        if (this.slashLight) {
            this.slashLight.active = false;
        }
        if (this.slashHeavy) {
            this.slashHeavy.active = false;
        }
    }

    private updateAttackTiming(dt: number): void {
        this.attackTimer += dt;
        const total = this.attackStartup + this.attackActiveDuration + this.attackRecovery;

        if (this.attackTimer >= total) {
            this.attacking = false;
            this.attackingActive = false;
            this.pendingDamage = 0;

            // 连击窗口从**收招**开始算，而不是起手 ——
            // 一次攻击总共 0.4s，若从起手算，窗口 0.3s 会在攻击结束前就过期，
            // 连段永远接不上（表现为"怎么按都只有第一段"）。
            this.comboTimer = gameConfig.combat.comboWindow;

            if (this.bufferedLight) {
                this.bufferedLight = false;
                this.doLightAttack();
            }
        } else if (this.attackTimer >= this.attackStartup + this.attackActiveDuration) {
            this.attackingActive = false;
        } else if (this.attackTimer >= this.attackStartup) {
            this.attackingActive = true;
            this.placeAttackHitBox();
            // 判定期每帧扫描一次重叠集合 —— 光靠 BEGIN_CONTACT 会漏掉
            // 「攻击开始时敌人就已经在框内」的情况（碰撞体不再重新触发进入事件）
            this.sweepOverlapping();
        }

        // 灰盒视觉：光刃只在判定期显示，轻/重各用一把
        if (this.slashLight) {
            this.slashLight.active = this.attackingActive && !this.isHeavyAttack;
        }
        if (this.slashHeavy) {
            this.slashHeavy.active = this.attackingActive && this.isHeavyAttack;
        }
    }

    /** 把命中盒摆到玩家朝向的前方（判定期每帧重摆，避免 sensor 刚体漂移） */
    private placeAttackHitBox(): void {
        const facing = this.ctx ? this.ctx.facing : 1;
        this.attackHitBox!.node.setPosition(
            this.attackHitBoxLocalPos.x * facing,
            this.attackHitBoxLocalPos.y,
        );
        // 光刃摆到角色身前，并随朝向做水平镜像
        this.placeSlash(this.slashLight, SLASH_OFFSET_X, facing);
        this.placeSlash(this.slashHeavy, SLASH_HEAVY_OFFSET_X, facing);
    }

    /**
     * 把光刃放到朝向前方，并按朝向水平镜像。
     * 素材只画了「朝右」那半弧，朝左时若只挪位置不翻转，弧口会背对攻击方向、看着是歪的。
     */
    private placeSlash(node: Node | null, offsetX: number, facing: number): void {
        if (!node) {
            return;
        }
        node.setPosition(offsetX * facing, node.position.y, 0);
        applyFacingFlip(node, facing, SLASH_NATURAL_FACING);
    }

    // ============ 格挡 / 完美格挡 ============

    /**
     * 敌人命中玩家时调用（后续敌人 AI 接入）。
     * 返回实际应扣除的灵炁：完美格挡 0、普通格挡减伤后值、未格挡原值。
     */
    public receivePlayerDamage(amount: number): number {
        const combat = gameConfig.combat;
        if (this.blocking) {
            const isPerfect = this.blockElapsed <= combat.perfectBlockWindow;
            if (isPerfect) {
                log('[Combat] 完美格挡！反制（0 消耗）');
                // TODO: 反制击退敌人（待敌人 AI 接入后补充）
                return 0;
            }
            spiritEnergySystem.consume(gameConfig.spirit.blockCost);
            const reduced = amount * (1 - combat.blockReduction);
            log(`[Combat] 格挡减伤 ${amount} -> ${reduced.toFixed(1)}`);
            return reduced;
        }
        return amount;
    }

    // ============ 灵雾灵弹 ============

    private fireMistShot(): void {
        const spirit = gameConfig.spirit;
        if (!spiritEnergySystem.canConsume(spirit.mistShotCost)) {
            log('[Combat] 灵炁不足，无法灵弹');
            return;
        }
        spiritEnergySystem.consume(spirit.mistShotCost);

        const combat = gameConfig.combat;
        const facing = this.ctx ? this.ctx.facing : 1;
        this.spawnMistShot(
            new Vec2(facing, 0),
            combat.mistShotSpeed,
            combat.baseLightDamage * combat.mistShotDamageRatio,
            combat.mistShotLifetime,
        );
        log('[Combat] 灵弹发射');
    }

    private spawnMistShot(dir: Vec2, speed: number, damage: number, lifetime: number): void {
        const parent = this.node.parent;
        if (!parent) {
            return;
        }

        let shotNode: Node;
        if (this.mistShotPrefab) {
            shotNode = instantiate(this.mistShotPrefab);
        } else {
            shotNode = this.buildFallbackShotNode();
        }

        parent.addChild(shotNode);
        // 角色节点的原点是脚底（碰撞体底边），直接拿它当发射点灵弹会从脚底冒出来
        const origin = this.node.worldPosition;
        const dirSign = dir.x >= 0 ? 1 : -1;
        shotNode.setWorldPosition(
            origin.x + dirSign * MIST_SHOT_SPAWN_X,
            origin.y + MIST_SHOT_SPAWN_Y,
            origin.z,
        );

        const shot = shotNode.getComponent(MistShot) ?? shotNode.addComponent(MistShot);
        shot.init(dir, speed, damage, lifetime);
    }

    /** 灰盒兜底：无 prefab 时程序化生成灵弹（素材 + 刚体 + 碰撞盒 + MistShot） */
    private buildFallbackShotNode(): Node {
        const node = new Node('MistShot');
        node.layer = Layers.Enum.UI_2D;

        if (this.mistShotFrame) {
            const ut = node.addComponent(UITransform);
            ut.setContentSize(MIST_SHOT_SIZE, MIST_SHOT_SIZE);
            const sp = node.addComponent(Sprite);
            sp.spriteFrame = this.mistShotFrame;
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
        }
        else {
            // 素材还没加载出来时的兜底：画个圆，至少看得见
            const g = node.addComponent(Graphics);
            g.fillColor = new Color(170, 210, 255, 255);
            g.circle(0, 0, 8);
            g.fill();
        }

        const rb = node.addComponent(RigidBody2D);
        rb.gravityScale = 0;
        rb.linearDamping = 0;
        rb.bullet = true;

        const col = node.addComponent(BoxCollider2D);
        col.size = new Size(MIST_SHOT_BODY, MIST_SHOT_BODY);

        node.addComponent(MistShot);
        return node;
    }

    /** 命中火花：短命特效节点，自行淡出自毁 */
    private spawnHitSpark(worldPos: Vec3): void {
        if (!this.hitSparkFrame) {
            return;
        }
        const parent = this.node.parent;
        if (!parent) {
            return;
        }

        const n = new Node('HitSpark');
        n.layer = Layers.Enum.UI_2D;
        parent.addChild(n);

        const ut = n.addComponent(UITransform);
        ut.setContentSize(HIT_SPARK_SIZE, HIT_SPARK_SIZE);
        const sp = n.addComponent(Sprite);
        sp.spriteFrame = this.hitSparkFrame;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;

        n.setWorldPosition(worldPos);

        const spark = n.addComponent(HitSpark);
        spark.setScaleMult(this.isHeavyAttack ? 1.5 : 1.0);
    }

    // ============ 命中结算 ============

    /**
     * 命中盒的碰撞体**常开**（sensor，不挡任何东西），只用它维护"当前和谁重叠"。
     * 判定期每帧再扫一遍这个集合 —— 覆盖"开打时目标就已经在框内"的情况。
     *
     * ⚠️ 命中盒的刚体必须 `allowSleep = false`（见 onLoad）：
     * 它是 Dynamic 刚体，角色站住不动约 0.5s 后它会**休眠**，而 Box2D 对
     * 双方都休眠的接触对不做处理 —— 表现就是"站着不动打不到、一走又能打到"。
     */
    private onAttackBeginContact(selfCollider: BoxCollider2D, otherCollider: BoxCollider2D,
                                 contact: IPhysics2DContact | null): void {
        const damageable = otherCollider.node.getComponent(Damageable);
        if (!damageable) {
            return;
        }
        this.overlapping.add(damageable);
        this.tryDamage(damageable, otherCollider.node);
    }

    private onAttackEndContact(selfCollider: BoxCollider2D, otherCollider: BoxCollider2D,
                               contact: IPhysics2DContact | null): void {
        const damageable = otherCollider.node.getComponent(Damageable);
        if (damageable) {
            this.overlapping.delete(damageable);
        }
    }

    /** 判定期每帧调用：把"已经在框里"的目标也结算掉 */
    private sweepOverlapping(): void {
        this.overlapping.forEach((d) => {
            if (d && d.isValid) {
                this.tryDamage(d, d.node);
            }
        });
    }

    /** 单次结算入口：只在判定期、且本次攻击还没打过这个目标时才生效 */
    private tryDamage(damageable: Damageable, hitNode: Node): void {
        if (!this.attackingActive || this.pendingDamage <= 0) {
            return;
        }
        if (this.hitSet.has(damageable)) {
            return;
        }
        this.hitSet.add(damageable);

        const facing = this.ctx ? this.ctx.facing : 1;
        const info: DamageInfo = {
            amount: this.pendingDamage,
            knockback: new Vec2(facing * this.pendingKnockback, 0),
            sourceForm: CompanionForm.Entity,
        };
        damageable.takeDamage(info);
        this.spawnHitSpark(hitNode.worldPosition);
        log(`[Combat] 命中 ${hitNode.name}`);
    }

    // ============ 形态切换 ============

    private onFormChanged(event: CompanionFormChangedEvent): void {
        this.currentForm = event.current;
        this.cancelAttack();
        this.attackHeld = false;
        this.blockHeld = false;
        this.blocking = false;
        this.chargeTime = 0;
        if (this.ctx) {
            this.ctx.isAttacking = false;
            this.ctx.isBlocking = false;
        }
    }

    private cancelAttack(): void {
        this.attacking = false;
        this.attackingActive = false;
        this.pendingDamage = 0;
        this.bufferedLight = false;
        // 碰撞体保持常开，不在这里关（见 onAttackBeginContact 的注释）
        if (this.slashLight) {
            this.slashLight.active = false;
        }
        if (this.slashHeavy) {
            this.slashHeavy.active = false;
        }
    }
}
