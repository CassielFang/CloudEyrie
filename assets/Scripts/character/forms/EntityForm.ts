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
        if (input.dash && !ctx.isAttacking && this.jumpCount >= 1 && !ctx.isDashing) {
            velocity.x = ctx.facing * move.dashSpeed;
            ctx.isDashing = true;
            this.dashTimer = 0;
            input.dash = false;
            input.attack = false;
            log('[Qinghe Controller] start Dash');
        }

        // 跳跃（二段跳）
        if (input.jump && !ctx.isDashing && !ctx.isAttacking) {
            if (this.jumpCount < move.maxJumpCount) {
                velocity.y += move.jumpSpeed;
                this.jumpCount += 1;
            }
            input.jump = false;
        }

        // 水平移动
        if (!ctx.isDashing) {
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

        // 着地重置二段跳
        if (ctx.grounded) {
            this.jumpCount = 0;
        }

        rigidBody.linearVelocity = velocity;
    }

    public drainPerSecond(): number {
        return 0;
    }
}
