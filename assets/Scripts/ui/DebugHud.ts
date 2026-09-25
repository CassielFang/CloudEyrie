import {
    _decorator, Component, Node, Sprite, SpriteFrame, Label,
    UITransform, Color, Size, Layers, director, resources, log,
} from 'cc';
const { ccclass } = _decorator;

import { eventBus } from '../core/EventBus';
import { spiritEnergySystem } from '../core/SpiritEnergySystem';
import { CompanionForm } from '../character/forms/ICompanionForm';
import { CompanionFormChangedEvent, CompanionStateMachine } from '../character/CompanionStateMachine';
import { Damageable } from '../combat/Damageable';

/**
 * 调试 HUD（灰盒期专用，正式 UI 做好后整个删掉）。
 *
 * 显示三样东西——它们是当前测试中最"看不见"的：
 *   1. 灵炁条（唯一资源，不知道剩多少就没法测形态切换和战斗消耗）
 *   2. 当前形态（白駠/莹翳换形态只有日志，看不出区别）
 *   3. 敌人血量（挨打只有日志）
 *
 * 整个 UI 在 onLoad 里用代码搭，挂到 Canvas 上即可，不需要在 Inspector 连引用。
 * 两条 bar 用 assets/resources/white.png 染色实现（resources/ 下的资源才能运行时加载）。
 */
@ccclass('DebugHud')
export class DebugHud extends Component {

    private static readonly BAR_W = 220;
    private static readonly BAR_H = 14;
    private static readonly PANEL_X = -620;   // 画布左上角起（Canvas 1280x720，中心原点）

    private barFrame: SpriteFrame | null = null;

    private spiritFill: Node | null = null;
    private spiritText: Label | null = null;
    private formText: Label | null = null;
    private enemyText: Label | null = null;
    private enemyFill: Node | null = null;

    private enemy: Damageable | null = null;
    private form: CompanionForm = CompanionForm.Entity;

    private onFormChangedHandler = (e: CompanionFormChangedEvent): void => {
        this.form = e.current;
    };

    protected onLoad(): void {
        this.node.layer = Layers.Enum.UI_2D;
        eventBus.on<CompanionFormChangedEvent>('companion-form-changed', this.onFormChangedHandler);

        // white.png 在 assets/resources/ 下，只有 resources 目录能运行时加载
        resources.load('white/spriteFrame', SpriteFrame, (err, frame) => {
            if (err || !frame) {
                log('[DebugHud] white.png 加载失败，HUD 不显示:', err);
                return;
            }
            this.barFrame = frame;
            this.build();

            // 初始形态（挂载时可能已经不是 Entity）
            const scene = director.getScene();
            const q = scene ? scene.getChildByPath('Canvas/Qinghe') : null;
            const sm = q ? q.getComponent(CompanionStateMachine) : null;
            if (sm) {
                this.form = sm.getCurrentForm();
            }
        });
    }

    protected onDestroy(): void {
        eventBus.off<CompanionFormChangedEvent>('companion-form-changed', this.onFormChangedHandler);
    }

    // ================= 构建 =================

    private build(): void {
        const x = DebugHud.PANEL_X;
        let y = 330;

        this.createLabel('SpiritCaption', x, y, 18, new Color(200, 215, 230), '灵炁');
        this.spiritText = this.createLabel('SpiritValue', x + 60, y, 18, new Color(140, 220, 255));
        y -= 20;
        this.createBar('SpiritBarBg', x, y, DebugHud.BAR_W, DebugHud.BAR_H, new Color(30, 36, 44, 200));
        this.spiritFill = this.createBar('SpiritBarFill', x, y, DebugHud.BAR_W, DebugHud.BAR_H,
            new Color(90, 200, 240, 255));
        y -= 30;

        this.formText = this.createLabel('FormText', x, y, 18, new Color(255, 230, 170));
        y -= 34;

        this.enemyText = this.createLabel('EnemyCaption', x, y, 18, new Color(200, 215, 230));
        y -= 20;
        this.createBar('EnemyBarBg', x, y, DebugHud.BAR_W, DebugHud.BAR_H, new Color(30, 36, 44, 200));
        this.enemyFill = this.createBar('EnemyBarFill', x, y, DebugHud.BAR_W, DebugHud.BAR_H,
            new Color(235, 90, 90, 255));
    }

    /** 左对齐文本；节点锚点设成 (0, 0.5)，这样 x 就是文字左边缘 */
    private createLabel(name: string, x: number, y: number, size: number, color: Color, text = ''): Label {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        this.node.addChild(n);

        const ut = n.addComponent(UITransform);
        ut.setAnchorPoint(0, 0.5);

        const label = n.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 2;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.verticalAlign = Label.VerticalAlign.CENTER;

        n.setPosition(x, y, 0);
        return label;
    }

    /** 左对齐 bar；锚点 (0, 0.5)，改宽度即向右生长 */
    private createBar(name: string, x: number, y: number, w: number, h: number, color: Color): Node {
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
        return n;
    }

    // ================= 每帧刷新 =================

    protected update(): void {
        if (!this.barFrame) {
            return;
        }

        // 灵炁
        const cur = spiritEnergySystem.getCurrent();
        const max = spiritEnergySystem.max;
        const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
        this.setBarWidth(this.spiritFill, ratio);
        if (this.spiritText) {
            this.spiritText.string = `${cur.toFixed(0)} / ${max.toFixed(0)}`;
        }

        // 形态
        if (this.formText) {
            this.formText.string = `形态  ${this.formLabel(this.form)}`;
        }

        // 敌人血量
        if (!this.enemy) {
            const scene = director.getScene();
            const n = scene ? scene.getChildByPath('Canvas/enemy') : null;
            this.enemy = n ? n.getComponent(Damageable) : null;
        }
        if (this.enemyText && this.enemyFill) {
            if (!this.enemy) {
                this.enemyText.string = '敌人  （未找到 Damageable）';
                this.setBarWidth(this.enemyFill, 0);
            }
            else if (!this.enemy.node.active || this.enemy.getHp() <= 0) {
                this.enemyText.string = '敌人  已击杀';
                this.setBarWidth(this.enemyFill, 0);
            }
            else {
                const hp = this.enemy.getHp();
                const hpMax = Math.max(1, this.enemy.getMaxHp());
                this.enemyText.string = `敌人  ${hp.toFixed(0)} / ${hpMax.toFixed(0)}`;
                this.setBarWidth(this.enemyFill, hp / hpMax);
            }
        }
    }

    private setBarWidth(n: Node | null, ratio: number): void {
        if (!n) {
            return;
        }
        const ut = n.getComponent(UITransform);
        if (!ut) {
            return;
        }
        ut.setContentSize(Math.max(0, DebugHud.BAR_W * ratio), DebugHud.BAR_H);
    }

    private formLabel(f: CompanionForm): string {
        switch (f) {
            case CompanionForm.Entity: return '实体（青禾）';
            case CompanionForm.Mist: return '灵雾（莹翳）';
            case CompanionForm.Merge: return '灵合（融合）';
            default: return String(f);
        }
    }
}
