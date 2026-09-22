import { _decorator, Component, UIOpacity } from 'cc';
const { ccclass } = _decorator;

/**
 * 命中火花：短暂放大 + 淡出后自毁。
 * 纯表现层（灰盒视觉），不参与任何伤害结算，正式特效接入后删掉。
 */
@ccclass('HitSpark')
export class HitSpark extends Component {

    private readonly duration = 0.18;
    private elapsed = 0;
    private baseScale = 1;
    private scaleMult = 1;
    private opacity: UIOpacity | null = null;

    protected onLoad(): void {
        this.baseScale = this.node.scale.x;
        this.opacity = this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
    }

    /** 体型倍数（重击的火花更大） */
    public setScaleMult(mult: number): void {
        this.scaleMult = mult;
        this.node.setScale(this.baseScale * mult, this.baseScale * mult, 1);
    }

    protected update(dt: number): void {
        this.elapsed += dt;
        const t = Math.min(1, this.elapsed / this.duration);

        // 先撑开再收，淡出
        const grow = 0.7 + 0.8 * t;
        const s = this.baseScale * this.scaleMult * grow;
        this.node.setScale(s, s, 1);

        if (this.opacity) {
            this.opacity.opacity = Math.round(255 * (1 - t));
        }

        if (t >= 1) {
            this.node.destroy();
        }
    }
}
