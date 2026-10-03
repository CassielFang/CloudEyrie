import {
    _decorator, Color, Component, Label, Layers, Node, Sprite, SpriteFrame,
    UIOpacity, UITransform, Vec3, director, resources, warn,
} from 'cc';
const { ccclass, property } = _decorator;

import { BossP1AI, BossPhase } from '../boss/BossP1AI';
import { Damageable } from '../combat/Damageable';
import { BossConfig, gameConfig } from '../core/GameConfig';
import { spiritEnergySystem } from '../core/SpiritEnergySystem';

/**
 * 正式 HUD —— 替掉灰盒期的 `DebugHud`。
 *
 * 两样东西，都按 `Cloud Eyrie.md` §7.3「极简主义」的要求：
 *
 * 1. **灵炁条**（左下角）：细线条 + 水墨质感。它是本作唯一的资源，
 *    替代传统血条 —— 底 `/槽 + 填充 + 笔锋光点` 三张叠着。
 * 2. **Boss 阶段指示器**（Boss 头顶）：三段弧线，亮/暗两态由引擎摆三次。
 *    只在 Boss 开打后出现。
 *
 * 图来自 `art-source/ui/`（**程序化占位**，配色与比例按设计文档），
 * 运行时从 `assets/Resources/ui/` 加载 —— 只有 `resources/` 下的才能 `resources.load`。
 *
 * 整个 UI 在 `onLoad` 里用代码搭，挂到 `Canvas` 下即可，不需要在 Inspector 连引用。
 */
@ccclass('GameHud')
export class GameHud extends Component {

    private static readonly BAR_W = 420;      // 灵炁条显示宽度
    private static readonly BAR_H = 40;
    private static readonly BAR_X = -610;     // 左下角
    private static readonly BAR_Y = -300;

    /** 三段弧线的横向间距与尺寸 */
    private static readonly ARC_SIZE = 96;
    private static readonly ARC_GAP = 10;
    /** 指示器高出 Boss 节点多少 */
    private static readonly ARC_ABOVE = 420;

    @property({ displayName: 'Boss 节点路径' })
    public bossPath = 'Canvas/Boss';

    private trackFrame: SpriteFrame | null = null;
    private fillFrame: SpriteFrame | null = null;
    private tipFrame: SpriteFrame | null = null;
    private arcLit: SpriteFrame | null = null;
    private arcDim: SpriteFrame | null = null;

    private fill: Node | null = null;
    private barTip: Node | null = null;
    private arcs: Node[] = [];
    private phaseRoot: Node | null = null;
    private boss: BossP1AI | null = null;
    private loaded = 0;

    protected onLoad(): void {
        this.node.layer = Layers.Enum.UI_2D;
        const want = [
            ['ui/spirit_bar_track/spriteFrame', (f: SpriteFrame) => { this.trackFrame = f; }],
            ['ui/spirit_bar_fill/spriteFrame', (f: SpriteFrame) => { this.fillFrame = f; }],
            ['ui/spirit_bar_tip/spriteFrame', (f: SpriteFrame) => { this.tipFrame = f; }],
            ['ui/phase_arc_lit/spriteFrame', (f: SpriteFrame) => { this.arcLit = f; }],
            ['ui/phase_arc_dim/spriteFrame', (f: SpriteFrame) => { this.arcDim = f; }],
        ] as const;
        for (const [path, put] of want) {
            resources.load(path, SpriteFrame, (err, frame) => {
                if (err || !frame) {
                    warn(`[GameHud] 读不到 ${path}：${err}`);
                    return;
                }
                put(frame);
                this.loaded += 1;
                if (this.loaded === want.length) {
                    this.build();
                }
            });
        }
    }

    // ================= 构建 =================

    private build(): void {
        this.buildSpiritBar();
        this.buildPhaseArcs();
    }

    private buildSpiritBar(): void {
        const X = GameHud.BAR_X;
        const Y = GameHud.BAR_Y;
        const W = GameHud.BAR_W;
        const H = GameHud.BAR_H;

        // 槽底
        this.makeSprite('SpiritTrack', X, Y, W, H, this.trackFrame, new Color(255, 255, 255, 210), [0, 0.5]);
        // 填充：**沿 X 均匀**，所以可以按比例直接裁切宽度
        this.fill = this.makeSprite('SpiritFill', X, Y, W, H, this.fillFrame,
            new Color(255, 255, 255, 255), [0, 0.5]);
        // 笔锋光点：跟着百分比跑
        this.barTip = this.makeSprite('SpiritTip', X + W, Y, GameHud.BAR_H * 0.66,
            GameHud.BAR_H, this.tipFrame, new Color(255, 255, 255, 255), [0.5, 0.5]);
    }

    private buildPhaseArcs(): void {
        // ⚠️ 指示器**不能挂在 HUD 节点下**：HUD 是屏幕固定的（挂 `ScreenFixed`），
        // 跟着它就会被钉在屏幕上，而不是跟着 Boss 走。所以另建一个世界空间的容器，
        // 挂到 Canvas 下，每帧按 Boss 的世界坐标摆。
        const root = new Node('BossPhaseRoot');
        root.layer = Layers.Enum.UI_2D;
        (this.node.parent ?? this.node).addChild(root);
        this.phaseRoot = root;
        root.active = false;

        const total = GameHud.ARC_SIZE * 3 + GameHud.ARC_GAP * 2;
        for (let i = 0; i < 3; i += 1) {
            const x = -total / 2 + GameHud.ARC_SIZE / 2 + i * (GameHud.ARC_SIZE + GameHud.ARC_GAP);
            const n = this.makeSprite(`PhaseArc${i}`, x, 0, GameHud.ARC_SIZE, GameHud.ARC_SIZE,
                this.arcDim, new Color(255, 255, 255, 255), [0.5, 0.5], root);
            this.arcs.push(n);
        }
    }

    /**
     * 建一张 Sprite。
     *
     * ⚠️ `sizeMode = CUSTOM` 下画面尺寸 = `contentSize × node.scale` ——
     * 所以这里显式 `setContentSize(w, h)`，**不要**让 contentSize 停在 (1,1)。
     */
    private makeSprite(name: string, x: number, y: number, w: number, h: number,
                       frame: SpriteFrame | null, color: Color,
                       anchor: [number, number], parent?: Node): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        (parent ?? this.node).addChild(n);

        const ut = n.addComponent(UITransform);
        ut.setAnchorPoint(anchor[0], anchor[1]);
        ut.setContentSize(w, h);

        const sp = n.addComponent(Sprite);
        sp.spriteFrame = frame;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;
        sp.color = color;

        n.setPosition(x, y, 0);
        return n;
    }

    // ================= 每帧刷新 =================

    protected update(): void {
        if (this.loaded < 5) {
            return;
        }
        this.updateSpiritBar();
        this.updatePhaseArcs();
    }

    private updateSpiritBar(): void {
        const ratio = Math.max(0, Math.min(1, spiritEnergySystem.getRatio()));
        const ut = this.fill?.getComponent(UITransform);
        if (ut) {
            ut.setContentSize(GameHud.BAR_W * ratio, GameHud.BAR_H);
        }
        if (this.barTip) {
            this.barTip.setPosition(GameHud.BAR_X + GameHud.BAR_W * ratio, GameHud.BAR_Y, 0);
        }
    }

    /** Boss 阶段指示器：只用亮/暗两态区分「已过 / 当前 / 未到」 */
    private updatePhaseArcs(): void {
        const boss = this.resolveBoss();
        const engaged = !!boss && boss.isEngaged();
        const dmg = boss ? boss.getDamageable() : null;

        if (this.phaseRoot) {
            this.phaseRoot.active = engaged;
        }
        if (!engaged || !dmg) {
            return;
        }

        const cfg: BossConfig = gameConfig.boss;
        const ratio = dmg.getHpRatio();
        // 第 0 段对应 P1（100%~70%），依此类推
        const active = ratio > cfg.phase2HpRatio ? 0
            : ratio > cfg.phase3HpRatio ? 1 : 2;

        this.arcs.forEach((n, i) => {
            const sp = n.getComponent(Sprite);
            if (!sp) {
                return;
            }
            // 当前阶段亮、之后的暗；已经走过的段保持亮（当作进度）
            sp.spriteFrame = i <= active ? this.arcLit : this.arcDim;
        });
    }

    /** 把指示器容器摆到 Boss 头顶（世界坐标，跟着 Boss 走而不是钉在屏幕上） */
    protected lateUpdate(): void {
        const boss = this.resolveBoss();
        const root = this.phaseRoot;
        if (!boss || !root || !root.active) {
            return;
        }
        const parent = root.parent;
        const wp = boss.node.worldPosition;
        const pp = parent ? parent.worldPosition : Vec3.ZERO;
        root.setPosition(wp.x - pp.x, wp.y - pp.y + GameHud.ARC_ABOVE, 0);
    }

    private resolveBoss(): BossP1AI | null {
        if (this.boss && this.boss.isValid) {
            return this.boss;
        }
        const scene = director.getScene();
        const n = scene ? scene.getChildByPath(this.bossPath) : null;
        this.boss = n ? n.getComponent(BossP1AI) : null;
        return this.boss;
    }
}
