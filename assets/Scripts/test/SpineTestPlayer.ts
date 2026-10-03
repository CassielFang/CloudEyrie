import { _decorator, Component, EventKeyboard, Input, input, KeyCode, log, sp, warn } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Spine 播放测试驱动（临时）。
 *
 * 挂到带 sp.Skeleton 的节点上把骨架动画跑起来，用来确认美术导出的骨骼资源能正常播放：
 * 启动时列出骨架里的全部动画（空动画单独标出——播了画面也不会动），播放指定的那一条；
 * 运行时 ←/→ 换动画、↑/↓ 调速、R 重播。正式动画状态机接入后整个文件删掉。
 */
@ccclass('SpineTestPlayer')
export class SpineTestPlayer extends Component {

    @property({ displayName: '动画名', tooltip: '留空则自动播第一条非空动画' })
    public animationName = 'idle_breath';

    @property({ displayName: '速度倍率' })
    public timeScale = 1;

    @property({ displayName: '循环播放' })
    public loop = true;

    private skel: sp.Skeleton | null = null;
    /** 可播放的动画名（已滤掉空动画） */
    private names: string[] = [];
    private index = 0;

    protected onLoad(): void {
        const skel = this.getComponent(sp.Skeleton);
        if (!skel) {
            warn('[SpineTest] 节点上没有 sp.Skeleton 组件');
            return;
        }
        if (!skel.skeletonData) {
            warn('[SpineTest] sp.Skeleton 没有绑定 SkeletonData');
            return;
        }
        this.skel = skel;

        this.names = this.collectAnimations();
        log(`[SpineTest] 可用动画 ${this.names.length} 条：${this.names.join(' / ') || '（无）'}`);

        const want = this.animationName || this.names[0] || '';
        if (!want) {
            warn('[SpineTest] 没有可播放的动画');
            return;
        }
        this.index = Math.max(0, this.names.indexOf(want));
        this.play(want);
    }

    protected onEnable(): void {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    protected onDisable(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    /**
     * 列出非空动画。空动画（timelines 为 0）播起来画面纹丝不动，
     * 直接滤掉，免得看起来像「代码没生效」。
     */
    private collectAnimations(): string[] {
        const anims = this.skel?.skeletonData?.getRuntimeData(true)?.animations ?? [];
        const playable: string[] = [];
        const empty: string[] = [];
        for (const anim of anims) {
            if (anim.timelines.length > 0) {
                playable.push(anim.name);
            } else {
                empty.push(anim.name);
            }
        }
        if (empty.length > 0) {
            log(`[SpineTest] 跳过 ${empty.length} 条空动画：${empty.join(' / ')}`);
        }
        return playable;
    }

    private play(name: string): void {
        const skel = this.skel;
        if (!skel) {
            return;
        }
        const entry = skel.setAnimation(0, name, this.loop);
        if (!entry) {
            warn(`[SpineTest] 播放 "${name}" 失败`);
            return;
        }
        skel.timeScale = this.timeScale;
        log(`[SpineTest] 播放 "${name}"（${entry.animation.duration.toFixed(3)}s，`
            + `loop=${this.loop}，timeScale=${this.timeScale}）`);
    }

    private onKeyDown(evt: EventKeyboard): void {
        if (!this.skel || this.names.length === 0) {
            return;
        }
        switch (evt.keyCode) {
            case KeyCode.ARROW_LEFT:
                this.step(-1);
                break;
            case KeyCode.ARROW_RIGHT:
                this.step(1);
                break;
            case KeyCode.ARROW_UP:
                this.setTimeScale(this.timeScale + 0.25);
                break;
            case KeyCode.ARROW_DOWN:
                this.setTimeScale(this.timeScale - 0.25);
                break;
            case KeyCode.KEY_R:
                this.play(this.names[this.index]);
                break;
            default:
                break;
        }
    }

    private step(delta: number): void {
        this.index = (this.index + delta + this.names.length) % this.names.length;
        this.play(this.names[this.index]);
    }

    private setTimeScale(value: number): void {
        this.timeScale = Math.max(0.25, Math.round(value * 100) / 100);
        if (this.skel) {
            this.skel.timeScale = this.timeScale;
        }
        log(`[SpineTest] timeScale = ${this.timeScale}`);
    }
}
