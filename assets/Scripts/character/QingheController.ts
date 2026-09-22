import {
    _decorator,
    Component, Node,
    RigidBody2D, BoxCollider2D, IPhysics2DContact, Contact2DType,
    Input, EventKeyboard, KeyCode, input,
    Vec2, Color, Sprite,
    log
} from 'cc';
const { ccclass, property } = _decorator;

import { eventBus } from '../core/EventBus';
import { applyFacingFlip, NaturalFacing } from '../core/FacingFlip';

/**
 * 青禾立绘的天然朝向：素材画的是**朝右**。
 * 判据：弓向右侧伸出、握弓的手在右、脸朝右（把原图和镜像并排对比确认过）。
 * 改美术素材后如果朝向变了，改这一个常量即可。
 */
const ART_NATURAL_FACING: NaturalFacing = 1;
import { CompanionStateMachine, CompanionFormChangedEvent } from './CompanionStateMachine';
import { CompanionForm, FormContext, MovementParams } from './forms/ICompanionForm';
import { CombatController } from '../combat/CombatController';

/**
 * 青禾玩家控制器：实体外壳（物理、碰撞、输入、形态委托）。
 *
 * 形态差异的移动/消耗已抽到 forms/ 状态类里（状态模式），
 * 战斗（轻击/蓄力/格挡/灵弹）已抽到 combat/CombatController。
 * 本控制器只负责：读移动输入 → 委托形态移动 → 委托战斗 tick。
 */
@ccclass('QingheController')
export class QingheController extends Component {

    private rigidBody: RigidBody2D | null = null;
    private collider: BoxCollider2D | null = null;

    @property
    private moveSpeed = 5;
    @property(Node)
    private groundNode: Node | null = null;
    @property
    private jumpSpeed = 10;
    @property
    private maxJumpCount = 2;

    @property
    private dashSpeed = 30;
    @property
    private dashDuration = 0.15;

    // 形态相关速度（占位，后续可调）
    @property
    private mistFlySpeed = 5;      // 灵雾自由飞行速度
    @property
    private mergeMoveSpeed = 7.5;  // 灵合悬浮速度

    private currentForm: CompanionForm = CompanionForm.Entity;
    private companionStateMachine: CompanionStateMachine | null = null;
    private combat: CombatController | null = null;
    private ctx: FormContext | null = null;
    /** 立绘节点：左右朝向暂时靠水平翻转表示（美术只有单侧朝向） */
    private artNode: Node | null = null;

    private onFormChangedHandler = (event: CompanionFormChangedEvent): void => {
        this.onFormChanged(event);
    };

    private onBeginContact(
        selfCollider: BoxCollider2D,
        otherCollider: BoxCollider2D,
        contact: IPhysics2DContact | null
    ): void {
        if (otherCollider.node === this.groundNode) {
            if (this.ctx) {
                this.ctx.grounded = true;
            }
            log('[Qinghe Controller] touch ground');
        }
    }

    private onEndContact(
        selfCollider: BoxCollider2D,
        otherCollider: BoxCollider2D,
        contact: IPhysics2DContact | null
    ): void {
        if (otherCollider.node === this.groundNode) {
            if (this.ctx) {
                this.ctx.grounded = false;
            }
            log('[Qinghe Controller] off ground');
        }
    }

    private onKeyDown(event: EventKeyboard): void {
        if (!this.ctx) {
            return;
        }
        const input = this.ctx.input;
        switch (event.keyCode) {
            case KeyCode.KEY_A: case KeyCode.ARROW_LEFT:
                input.left = true;
                break;
            case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT:
                input.right = true;
                break;
            case KeyCode.KEY_W: case KeyCode.ARROW_UP:
                input.up = true;
                break;
            case KeyCode.KEY_S: case KeyCode.ARROW_DOWN:
                input.down = true;
                break;
            case KeyCode.SPACE:
                input.jump = true;
                break;
            case KeyCode.KEY_K:
                input.dash = true;
                break;
            default: break;
        }
    }

    private onKeyUp(event: EventKeyboard): void {
        if (!this.ctx) {
            return;
        }
        const input = this.ctx.input;
        switch (event.keyCode) {
            case KeyCode.KEY_A: case KeyCode.ARROW_LEFT:
                input.left = false;
                break;
            case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT:
                input.right = false;
                break;
            case KeyCode.KEY_W: case KeyCode.ARROW_UP:
                input.up = false;
                break;
            case KeyCode.KEY_S: case KeyCode.ARROW_DOWN:
                input.down = false;
                break;
            default: break;
        }
    }

    private onFormChanged(event: CompanionFormChangedEvent): void {
        this.currentForm = event.current;
        // 切换形态时取消进行中的冲刺，避免状态跨形态泄漏
        if (this.ctx) {
            this.ctx.isDashing = false;
        }
        this.applyFormPhysics();
        this.applyFormTint();
    }

    /**
     * 灰盒视觉：三形态用不同染色区分，否则换形态只有日志、看不出区别。
     * 正式美术（各形态独立立绘 / 骨骼动画）接入后整个删掉。
     */
    private applyFormTint(): void {
        if (!this.artNode) {
            return;
        }
        const sprite = this.artNode.getComponent(Sprite);
        if (!sprite) {
            return;
        }
        switch (this.currentForm) {
            case CompanionForm.Mist:
                sprite.color = new Color(150, 225, 255, 210);   // 青冷半透 —— 灵雾
                break;
            case CompanionForm.Merge:
                sprite.color = new Color(255, 228, 160, 255);   // 暖金 —— 灵合
                break;
            case CompanionForm.Entity:
            default:
                sprite.color = new Color(255, 255, 255, 255);   // 原色 —— 实体
                break;
        }
    }

    /** 形态切换时调整物理（重力开关） */
    private applyFormPhysics(): void {
        if (!this.rigidBody) {
            return;
        }
        if (this.currentForm === CompanionForm.Entity) {
            this.rigidBody.gravityScale = 1;
            // 漂浮时刚体可能被 Box2D 自动休眠，需唤醒才会重新受重力下落
            this.rigidBody.wakeUp();
        }
        else {
            this.rigidBody.gravityScale = 0;
            // 关重力时清掉下落速度，避免残留
            const v = this.rigidBody.linearVelocity;
            this.rigidBody.linearVelocity = new Vec2(v.x, 0);
        }
    }

    protected onLoad(): void {
        this.rigidBody = this.getComponent(RigidBody2D);
        if (!this.rigidBody) {
            throw new Error('[Qinghe Controller] RigidBody2D not found!');
        }

        this.collider = this.getComponent(BoxCollider2D);
        if (!this.collider) {
            throw new Error('[Qinghe Controller] BoxCollider2D not found!');
        }

        if (!this.groundNode) {
            throw new Error('[Qinghe Controller] groundCollider not found!');
        }

        // 构建形态上下文（注入刚体 + 移动参数）
        const move: MovementParams = {
            moveSpeed: this.moveSpeed,
            jumpSpeed: this.jumpSpeed,
            maxJumpCount: this.maxJumpCount,
            dashSpeed: this.dashSpeed,
            dashDuration: this.dashDuration,
            mistFlySpeed: this.mistFlySpeed,
            mergeMoveSpeed: this.mergeMoveSpeed,
        };
        this.ctx = new FormContext(this.rigidBody, move);

        this.collider.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        this.collider.on(Contact2DType.END_CONTACT, this.onEndContact, this);

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);

        // 形态状态机 + 战斗控制器（同节点）
        this.companionStateMachine = this.getComponent(CompanionStateMachine);
        this.combat = this.getComponent(CombatController);

        // 立绘节点（可选的灰盒占位，没有也不影响逻辑）
        this.artNode = this.node.getChildByName('Art');

        eventBus.on<CompanionFormChangedEvent>('companion-form-changed', this.onFormChangedHandler);
    }

    protected onDestroy(): void {
        this.collider.off(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        this.collider.off(Contact2DType.END_CONTACT, this.onEndContact, this);

        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);

        eventBus.off<CompanionFormChangedEvent>('companion-form-changed', this.onFormChangedHandler);
    }

    protected start(): void {
        // 确保初始物理状态与默认形态一致
        this.applyFormPhysics();
        this.applyFormTint();
    }

    protected update(dt: number): void {
        if (!this.ctx || !this.companionStateMachine) {
            return;
        }

        // 战斗先更新（写 isAttacking/isBlocking），再委托形态移动读门控
        if (this.combat) {
            this.combat.tick(dt, this.ctx);
        }

        // 委托形态逻辑（移动 + 持续消耗 + 强制切雾）
        this.companionStateMachine.tick(dt, this.ctx);

        // 朝向：水平翻转立绘（美术目前只有单侧朝向，先这样表示左右）
        applyFacingFlip(this.artNode, this.ctx.facing, ART_NATURAL_FACING);

        // 边沿锁存只保留一帧：jump/dash 是「消费后清零」的边沿输入，
        // 若本帧条件不满足就没被消费，必须在此丢弃。
        // 否则在地面按 K（踏云闪要求已起跳）会一直挂着，等下次跳起来时突然触发。
        this.ctx.input.jump = false;
        this.ctx.input.dash = false;
    }
}
