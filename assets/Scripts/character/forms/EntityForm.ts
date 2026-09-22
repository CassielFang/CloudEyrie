import { Vec2, log } from 'cc';
import { CompanionForm, FormContext, ICompanionForm } from './ICompanionForm';

/** 实体形态（青禾主导）：行走 / 二段跳 / 踏云闪 */
export class EntityForm implements ICompanionForm {
    readonly form = CompanionForm.Entity;

    private jumpCount = 0;
    private dashTimer = 0;

    public update(dt: number, ctx: FormContext): void {
        const { rigidBody, move } = ctx;
        const input = ctx.input;
        const velocity = rigidBody.linearVelocity;

        // 冲刺（踏云闪：需已起跳）
        if (input.dash && !ctx.isAttacking && !ctx.isBlocking && this.jumpCount >= 1 && !ctx.isDashing) {
            velocity.x = ctx.facing * move.dashSpeed;
            ctx.isDashing = true;
            this.dashTimer = 0;
            input.dash = false;
            log('[Qinghe Controller] start Dash');
        }

        // 跳跃（二段跳）
        if (input.jump && !ctx.isDashing && !ctx.isAttacking && !ctx.isBlocking) {
            if (this.jumpCount < move.maxJumpCount) {
                velocity.y += move.jumpSpeed;
                this.jumpCount += 1;
                // 起跳即离地：物理接触回调（END_CONTACT）要等物理步进后才到，
                // 不在此处主动置 false，本帧末尾的「着地重置」会把刚加上去的
                // jumpCount 抹掉，导致跳过一次后踏云闪（要求 jumpCount>=1）不生效。
                ctx.grounded = false;
            }
            input.jump = false;
        }

        // 水平移动
        if (!ctx.isDashing && !ctx.isBlocking) {
            let h = 0;
            if (input.left) h -= 1;
            if (input.right) h += 1;
            if (h > 0) ctx.facing = 1;
            else if (h < 0) ctx.facing = -1;
            if (h !== 0) velocity.x = h * move.moveSpeed;
        }

        // 冲刺计时
        if (ctx.isDashing) {
            this.dashTimer += dt;
            if (this.dashTimer >= move.dashDuration) {
                ctx.isDashing = false;
                this.dashTimer = 0;
                velocity.x = 0;
                log('[Qinghe Controller] Dash end');
            }
        }

        // 着地重置二段跳（起跳当帧 ctx.grounded 已被上面的跳跃分支置为 false，不会误清）
        if (ctx.grounded) {
            this.jumpCount = 0;
        }

        rigidBody.linearVelocity = velocity;
    }

    public drainPerSecond(): number {
        return 0;
    }
}
