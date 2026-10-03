import {
    _decorator, Color, Component, Label, Layers, Node, Sprite, SpriteFrame,
    UITransform, director, log, resources,
} from 'cc';
const { ccclass, property } = _decorator;

import { BossP1AI } from '../boss/BossP1AI';
import { gameConfig } from '../core/GameConfig';

/**
 * Boss 阶段指示器：三段式血条 + 一行状态。
 *
 * 整个 UI 在 `onLoad` 里用代码搭，挂到 `Canvas` 下任意节点即可（同 `DebugHud` 的做法），
 * 不需要在 Inspector 连引用。
 *
 * 三段不是等分的 —— 按《关于boss战的一些修改》P1/P2/P3 各 300/350/350 点血量，
 * 所以分段刻度落在 70% 和 35%，与 gameConfig.boss 里的阈值同源。
 *
 * 正式 UI 换上石碑/卷轴意象后，这个文件删掉或替换。
 */
@ccclass('BossHud')
export class BossHud extends Component {

    private static readonly BAR_W = 720;
    private static readonly BAR_H = 18;
    private static readonly BAR_Y = 300;
    /** 段与段之间的刻度宽 */
    private static readonly TICK_W = 3;

    @property({ displayName: 'Boss 节点路径' })
    public bossPath = 'Canvas/Boss';

    private barFrame: SpriteFrame | null = null;
    private fill: Node | null = null;
    private nameText: Label | null = null;
    private stateText: Label | null = null;
    private boss: BossP1AI | null = null;
    /** 建出来的全部子节点，用于整组显隐 */
    private parts: Node[] = [];

    protected onLoad(): void {
        this.node.layer = Layers.Enum.UI_2D;
        resources.load('white/spriteFrame', SpriteFrame, (err, frame) => {
            if (err || !frame) {
                log('[BossHud] white.png 加载失败，HUD 不显示:', err);
                return;
            }
            this.barFrame = frame;
            this.build();
        });
    }

    private build(): void {
        const W = BossHud.BAR_W;
        const H = BossHud.BAR_H;
        const Y = BossHud.BAR_Y;
        const left = -W / 2;

        this.nameText = this.makeLabel('BossName', 0, Y + 26, 22,
            new Color(240, 230, 210), '九尾灵狐 · 青丘遗灵');
        this.stateText = this.makeLabel('BossState', 0, Y - 30, 18,
            new Color(180, 200, 215), '');

        // 槽底
        this.makeBar('BossBarBg', left, Y, W, H, new Color(24, 22, 30, 200));
        // 血量填充（左对齐，改宽度即向右生长）
        this.fill = this.makeBar('BossBarFill', left, Y, W, H, new Color(210, 70, 80, 255));

        // 阶段刻度：P1|P2 在 70%，P2|P3 在 35%
        for (const ratio of [gameConfig.boss.phase2HpRatio, gameConfig.boss.phase3HpRatio]) {
            const x = left + W * (1 - ratio);
            this.makeBar('BossTick', x - BossHud.TICK_W / 2, Y, BossHud.TICK_W, H + 8,
                new Color(245, 240, 225, 230));
        }
    }

    /** 居中文本 */
    private makeLabel(name: string, x: number, y: number, size: number,
                      color: Color, text = ''): Label {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        this.node.addChild(n);
        n.addComponent(UITransform).setContentSize(640, size + 6);
        const label = n.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 2;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        n.setPosition(x, y, 0);
        this.parts.push(n);
        return label;
    }

    /** 左对齐条；锚点 (0, 0.5)，改宽度即向右生长 */
    private makeBar(name: string, x: number, y: number, w: number, h: number, color: Color): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        this.node.addChild(n);
        const ut = n.addComponent(UITransform);
        ut.setAnchorPoint(0, 0.5);
        ut.setContentSize(w, h);
        const sp = n.addComponent(Sprite);
        sp.spriteFrame = this.barFrame;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;
        sp.color = color;
        n.setPosition(x, y, 0);
        this.parts.push(n);
        return n;
    }

    private setBarWidth(node: Node | null, ratio: number, fullWidth: number): void {
        const ut = node?.getComponent(UITransform);
        if (ut) {
            ut.setContentSize(Math.max(0, fullWidth * ratio), BossHud.BAR_H);
        }
    }

    /** 懒查找：Boss 可能比 HUD 晚挂上来 */
    private resolveBoss(): BossP1AI | null {
        if (this.boss && this.boss.isValid) {
            return this.boss;
        }
        const scene = director.getScene();
        const n = scene ? scene.getChildByPath(this.bossPath) : null;
        this.boss = n ? n.getComponent(BossP1AI) : null;
        return this.boss;
    }

    protected update(): void {
        const boss = this.resolveBoss();
        // 没进 Boss 战场之前整组不显示 —— 探索段顶着一条 Boss 血条很出戏
        const engaged = !!boss && boss.isEngaged();
        for (const n of this.parts) {
            if (n.isValid) {
                n.active = engaged;
            }
        }
        if (!engaged) {
            return;
        }

        const dmg = boss ? boss.getDamageable() : null;
        if (!dmg) {
            if (this.stateText) {
                this.stateText.string = '';
            }
            return;
        }

        this.setBarWidth(this.fill, dmg.getHpRatio(), BossHud.BAR_W);

        const hp = Math.max(0, Math.round(dmg.getHp()));
        const max = Math.round(dmg.getMaxHp());
        const phase = boss?.getPhase() ?? 'p1';
        const revealed = boss?.isRevealed() ? '已识破' : '未识破';
        if (this.stateText) {
            this.stateText.string = `${hp} / ${max}    阶段 ${phase}    ${revealed}`;
        }
    }
}
