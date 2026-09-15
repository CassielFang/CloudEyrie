import { Vec2, log } from 'cc';
import { CompanionForm, FormContext, ICompanionForm } from './ICompanionForm';
import { gameConfig } from '../../core/GameConfig';

/** 灵合形态（二人合一）：八向悬浮（快）+ 冲刺 */
export class MergeForm implements ICompanionForm {
    readonly form = CompanionForm.Merge;

    private dashTimer = 0;

    public update(dt: number, ctx: FormContext): void {
        const { rigidBody, move } = ctx;
        const input = ctx.input;
        const velocity = rigidBody.linearVelocity;

        // 灵合无跳跃，清掉残留
        input.jump = false;

        // 冲刺（无需起跳）
        if (input.dash && !ctx.isAttacking && !ctx.isDashing) {
            velocity.x = ctx.facing * move.dashSpeed;
            ctx.isDashing = true;
            this.dashTimer = 0;
            input.dash = false;
            log('[Qinghe Controller] start Dash');
        }

        // 八向悬浮
        if (!ctx.isDashing) {
            let h = 0;
            let v = 0;
            if (input.left) h -= 1;
            if (input.right) h += 1;
            if (input.up) v += 1;
            if (input.down) v -= 1;

            if (h > 0) ctx.facing = 1;
            else if (h < 0) ctx.facing = -1;

            velocity.x = h * move.mergeMoveSpeed;
            velocity.y = v * move.mergeMoveSpeed;
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

        rigidBody.linearVelocity = velocity;
    }

    public drainPerSecond(): number {
        return gameConfig.spirit.mergePurifyCostPerSec;
    }
}
