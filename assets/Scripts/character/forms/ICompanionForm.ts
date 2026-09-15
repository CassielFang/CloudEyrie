import { RigidBody2D } from 'cc';

/** 灵伴三形态 */
export enum CompanionForm {
    Entity = 'entity',  // 实体形态（青禾主导）
    Mist = 'mist',      // 灵雾形态（莹翳主导）
    Merge = 'merge',    // 灵合形态（二人合一）
}

/** 输入快照（QingheController 填充；jump/dash/attack 为边沿锁存，消费后清零） */
export interface MoveInput {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    jump: boolean;
    dash: boolean;
    attack: boolean;
}

/** 移动参数（由 QingheController 的 @property 填充，注入各形态状态类） */
export interface MovementParams {
    moveSpeed: number;
    jumpSpeed: number;
    maxJumpCount: number;
    dashSpeed: number;
    dashDuration: number;
    mistFlySpeed: number;
    mergeMoveSpeed: number;
}

/** 形态上下文：状态类共享的可变状态 */
export class FormContext {
    /** 朝向 1=右 -1=左 */
    public facing = 1;
    /** 是否着地 */
    public grounded = false;
    /** 是否冲刺中（状态写，控制器读） */
    public isDashing = false;
    /** 是否攻击中（控制器写，状态读） */
    public isAttacking = false;
    /** 输入快照 */
    public input: MoveInput = {
        left: false, right: false, up: false, down: false,
        jump: false, dash: false, attack: false,
    };

    constructor(
        public rigidBody: RigidBody2D,
        public move: MovementParams,
    ) {}
}

/** 灵伴形态状态（状态模式）：每个形态内聚自己的移动与灵炁消耗 */
export interface ICompanionForm {
    readonly form: CompanionForm;
    /** 每帧移动：读 ctx.input，写 ctx.rigidBody 速度 */
    update(dt: number, ctx: FormContext): void;
    /** 每秒灵炁消耗 */
    drainPerSecond(): number;
}
