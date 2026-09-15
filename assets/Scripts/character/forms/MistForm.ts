import { Vec2 } from 'cc';
import { CompanionForm, FormContext, ICompanionForm } from './ICompanionForm';
import { gameConfig } from '../../core/GameConfig';

/** 灵雾形态（莹翳主导）：八向自由飞行 */
export class MistForm implements ICompanionForm {
    readonly form = CompanionForm.Mist;

    /** 是否高速飞行（决定额外消耗） */
    private flying = false;

    public update(_dt: number, ctx: FormContext): void {
        const { rigidBody, move } = ctx;
        const input = ctx.input;

        // 灵雾无跳跃/冲刺，清掉残留请求
        input.jump = false;
        input.dash = false;

        let h = 0;
        let v = 0;
        if (input.left) h -= 1;
        if (input.right) h += 1;
        if (input.up) v += 1;
        if (input.down) v -= 1;

        if (h > 0) ctx.facing = 1;
        else if (h < 0) ctx.facing = -1;

        rigidBody.linearVelocity = new Vec2(h * move.mistFlySpeed, v * move.mistFlySpeed);

        this.flying = h !== 0 || v !== 0;
    }

    public drainPerSecond(): number {
        const spirit = gameConfig.spirit;
        return this.flying
            ? spirit.mistBaseDrain + spirit.mistFlyDrainExtra
            : spirit.mistBaseDrain;
    }
}
