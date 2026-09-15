import {
    _decorator,
    Component, Node,
    RigidBody2D, BoxCollider2D, IPhysics2DContact, Contact2DType,
    Input, EventKeyboard, KeyCode, input,
    Vec2, Vec3,
    log
} from 'cc';
const { ccclass, property } = _decorator;

import { eventBus } from '../core/EventBus';
import { CompanionStateMachine, CompanionFormChangedEvent } from './CompanionStateMachine';
import { CompanionForm, FormContext, MovementParams } from './forms/ICompanionForm';

/**
 * 青禾玩家控制器：实体外壳（物理、碰撞、输入、近战攻击）。
 *
 * 形态差异的移动/消耗已抽到 forms/ 状态类里（状态模式），
 * 本控制器只负责：读输入 → 委托形态逻辑 → 处理实体形态的近战攻击。
 */
@ccclass('QingheController')
export class QingheController extends Component {

    private rigidBody: RigidBody2D | null = null;
    private collider: BoxCollider2D | null = null;
    private attackHitBox: BoxCollider2D | null = null;

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

    @property
    private attackStartup = 0.1;
    @property
    private attackActiveDuration = 0.2;
    @property
    private attackRecovery = 0.1;

    private isAttacking = false;
    private isAttackingActive = false;
    private attackTimer = 0;

    private attackHitBoxPos: Vec3;

    private currentForm: CompanionForm = CompanionForm.Entity;
    private companionStateMachine: CompanionStateMachine | null = null;
    private ctx: FormContext | null = null;
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

    private onAttackHit(
        selfCollider: BoxCollider2D,
        otherCollider: BoxCollider2D,
        contact: IPhysics2DContact | null
    ): void {
        log('[Qinghe Controller] Attack Hit: ', otherCollider.node.name, ', attacking status: ', this.isAttackingActive);
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
            case KeyCode.KEY_J:
                input.attack = true;
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

    private startAttack(): void {
        if (this.isAttacking) {
            return;
        }
        this.isAttacking = true;
        this.isAttackingActive = false;
        this.attackTimer = 0;

        const facing = this.ctx ? this.ctx.facing : 1;
        this.attackHitBox.node.setPosition(
            this.attackHitBoxPos.x * facing,
            this.attackHitBoxPos.y
        );
        this.attackHitBox.enabled = false;

        log('[Qinghe Controller] start Attack');
    }
    private updateAttack(dt: number): void {
        this.attackTimer += dt;
        if (this.attackTimer >= this.attackStartup + this.attackActiveDuration + this.attackRecovery) {
            this.isAttacking = false;
            this.attackTimer = 0;

            log('[Qinghe Controller] Attack end');
        }
        else if (this.attackTimer >= this.attackStartup + this.attackActiveDuration) {
            this.isAttackingActive = false;
            this.attackHitBox.enabled = false;
        }
        else if (this.attackTimer >= this.attackStartup) {
            this.isAttackingActive = true;
            this.attackHitBox.enabled = true;
        }
    }

    private onFormChanged(event: CompanionFormChangedEvent): void {
        this.currentForm = event.current;
        // 切换形态时取消进行中的冲刺/攻击，避免状态跨形态泄漏
        if (this.ctx) {
            this.ctx.isDashing = false;
        }
        this.cancelAttack();
        this.applyFormPhysics();
    }

    private cancelAttack(): void {
        this.isAttacking = false;
        this.isAttackingActive = false;
        if (this.attackHitBox) {
            this.attackHitBox.enabled = false;
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

        const attackHitBoxNode = this.node.getChildByName('AttackHitBox');
        if (attackHitBoxNode) {
            this.attackHitBox = attackHitBoxNode.getComponent(BoxCollider2D);
        }
        if (!this.attackHitBox) {
            throw new Error('[Qinghe Controller] AttackHitBox not found!');
        }

        if (!this.groundNode) {
            throw new Error('[Qinghe Controller] groundCollider not found!');
        }

        this.attackHitBoxPos = new Vec3(this.attackHitBox.node.position);

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

        this.attackHitBox.on(Contact2DType.BEGIN_CONTACT, this.onAttackHit, this);

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);

        // 形态状态机（同节点）
        this.companionStateMachine = this.getComponent(CompanionStateMachine);
        eventBus.on<CompanionFormChangedEvent>('companion-form-changed', this.onFormChangedHandler);
    }

    protected onDestroy(): void {
        this.collider.off(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        this.collider.off(Contact2DType.END_CONTACT, this.onEndContact, this);

        this.attackHitBox.off(Contact2DType.BEGIN_CONTACT, this.onAttackHit, this);

        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);

        eventBus.off<CompanionFormChangedEvent>('companion-form-changed', this.onFormChangedHandler);
    }

    protected start(): void {
        // 确保初始物理状态与默认形态一致
        this.applyFormPhysics();
    }

    protected update(dt: number): void {
        if (!this.ctx || !this.companionStateMachine) {
            return;
        }

        // 同步攻击状态到上下文（供形态状态门控跳跃/冲刺）
        this.ctx.isAttacking = this.isAttacking;

        // 委托形态逻辑（移动 + 持续消耗 + 强制切雾）
        this.companionStateMachine.tick(dt, this.ctx);

        // 近战攻击（仅实体形态；灵雾/灵合的攻击由战斗系统后续补充）
        if (this.currentForm === CompanionForm.Entity) {
            if (this.ctx.input.attack && !this.ctx.isDashing) {
                this.startAttack();
                this.ctx.input.attack = false;
            }
        }
        else {
            this.ctx.input.attack = false;
        }

        // 攻击计时
        if (this.isAttacking) {
            this.updateAttack(dt);
        }
    }

}
