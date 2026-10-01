import {
    _decorator, Component, Node, Sprite, Label, Font, UITransform, Color,
    Graphics, UIOpacity, view, resources, warn, instantiate,
} from 'cc';
const { ccclass } = _decorator;

/**
 * 首页（`TitleScreen`）和结束页（`EndingScreen`）共用的「舞台」。
 *
 * 两页都是**一张满屏长卷 + 暗角 + 居中文字**，差别只在文字内容和交互，
 * 所以把背景铺满、统一缩放、字体加载、建文本这些重复部分抽到这里，
 * 子类只写自己那点内容。
 *
 * 基类**不碰引擎生命周期**（不定义 `onLoad` / `update`）—— 子类要覆盖这两个方法，
 * 基类再定义一遍的话子类就得记得 `super.onLoad()`，漏一次就静默少跑一半初始化。
 * 改成让子类在自己的 `onLoad` 里显式调 `setupStage()` / `loadFont()`。
 */

/** 设计分辨率高度。适配策略是 fitWidth（宽固定 1280），所以宽一定是 1280、高随屏幕变。 */
export const DESIGN_H = 720;

/**
 * 背景长卷的像素尺寸，必须与 `art-source/_tools/gen_title.py` 的 `CROP_W` 一致。
 * cover 铺满的缩放系数由它算：scale = max(visW / COVER_W, visH / COVER_H)。
 */
export const COVER_W = 2200;
export const COVER_H = 1000;

export const COLOR_TITLE = new Color(232, 248, 253, 255);
export const COLOR_SUB = new Color(152, 196, 212, 255);
export const COLOR_OUTLINE = new Color(10, 26, 38, 200);
export const COLOR_GLOW = new Color(150, 230, 245, 255);
export const COLOR_RULE = new Color(150, 210, 225, 200);
export const COLOR_DIAMOND = new Color(198, 242, 252, 240);

/** 暮色乘算色。见 `ScreenStage.bgTint` 的说明。 */
export const BG_TINT_DUSK = new Color(132, 158, 180, 255);

/** 灵炁光点：缓慢上浮、出屏后从底部回绕的小光斑。 */
interface Wisp {
    node: Node;
    opacity: UIOpacity;
    x: number;
    y: number;
    vy: number;
    amp: number;
    phase: number;
    sway: number;
    baseAlpha: number;
}

/** 光点数量。两页共用，改这里两边一起变。 */
export const WISP_COUNT = 18;

@ccclass('ScreenStage')
export abstract class ScreenStage extends Component {

    /**
     * 背景乘算色。Sprite.color 是**乘**不是叠加，所以纸白底变暮蓝、墨线山峦按比例压更暗，
     * 笔触和明暗层次都留着 —— 比叠一层半透明黑蒙层通透得多。
     * 越接近白色越亮；调整个空间的明暗就改这里。
     */
    protected bgTint: Color = BG_TINT_DUSK;

    protected labels: Label[] = [];
    protected font: Font | null = null;
    /** 字体到位后才置 true。字没到就开动画会先闪一帧系统字体的错字形。 */
    protected ready = false;

    private bgNode: Node | null = null;
    private vignetteNode: Node | null = null;
    private bgBaseScale = 1;
    private lastLayoutW = 0;
    private lastLayoutH = 0;

    // ============================================================ 初始化

    /** 找背景与暗角节点、上色。子类在自己的 `onLoad` 里第一个调它。 */
    protected setupStage(): void {
        const canvas = this.node.parent;
        if (!canvas) {
            warn('[ScreenStage] 组件没有父节点，背景无法初始化');
            return;
        }
        this.bgNode = canvas.getChildByName('BgScroll');
        this.vignetteNode = canvas.getChildByName('Vignette');

        const sp = this.bgNode ? this.bgNode.getComponent(Sprite) : null;
        if (sp) {
            sp.color = this.bgTint;
        }
    }

    /** 取游戏字体。失败就保持系统字体 —— 中文仍能显示，只是字形不对。 */
    protected loadFont(): void {
        const apply = (font: Font | null): void => {
            if (!font) {
                warn('[ScreenStage] assets/resources/font.ttf 加载失败，回退系统字体');
            }
            else {
                this.font = font;
                for (const l of this.labels) {
                    l.font = font;
                }
            }
            this.ready = true;
        };

        resources.load('font', Font, (err, font) => {
            if (err || !font) {
                resources.load('font.ttf', Font, (err2, font2) => apply(err2 ? null : font2));
                return;
            }
            apply(font);
        });
    }

    // ============================================================ 搭建

    protected makeNode(name: string, parent: Node): Node {
        const n = new Node(name);
        n.layer = parent.layer;
        parent.addChild(n);
        return n;
    }

    /** 居中文本。描边走 `Label.enableOutline`（3.8.2 起 `LabelOutline` 组件已废弃）。 */
    protected makeLabel(name: string, parent: Node, text: string, size: number,
        color: Color, outline = 2): Label {
        const n = this.makeNode(name, parent);
        n.addComponent(UITransform);

        const l = n.addComponent(Label);
        l.string = text;
        l.fontSize = size;
        l.lineHeight = Math.round(size * 1.2);
        l.color = color;
        l.horizontalAlign = Label.HorizontalAlign.CENTER;
        l.verticalAlign = Label.VerticalAlign.CENTER;
        l.overflow = Label.Overflow.NONE;
        if (this.font) {
            // 字体可能已经加载完了（节点是之后才建的），补挂一次
            l.font = this.font;
        }
        if (outline > 0) {
            // 背景是明暗不定的山水画，不加描边时浅色字会糊进云里
            l.enableOutline = true;
            l.outlineColor = COLOR_OUTLINE;
            l.outlineWidth = outline;
        }
        this.labels.push(l);
        return l;
    }

    /**
     * 从场景里的模板节点克隆一份贴图。
     *
     * 模板是 `active = false` 的占位节点 —— 面板和光点的贴图不在 `assets/resources/`
     * 下，没法 `resources.load`，只能在场景里摆一个挂好 spriteFrame 的节点克隆出来用。
     */
    protected cloneTemplate(templateName: string, name: string, parent: Node): Node | null {
        const canvas = this.node.parent;
        const tpl = canvas ? canvas.getChildByName(templateName) : null;
        if (!tpl) {
            warn(`[ScreenStage] 场景里找不到模板节点 ${templateName}`);
            return null;
        }
        const n = instantiate(tpl);
        n.name = name;
        n.active = true;
        parent.addChild(n);
        return n;
    }

    /**
     * 一条细横线 + 中间一枚菱形（标题与副标题之间的分隔）。
     * 用 Graphics 画，省一张贴图也便于按需拉长。
     */
    protected drawRule(node: Node, halfLen: number): void {
        const g = node.getComponent(Graphics) ?? node.addComponent(Graphics);
        g.clear();
        g.lineWidth = 2;
        g.strokeColor = COLOR_RULE;
        g.moveTo(-halfLen, 0);
        g.lineTo(-24, 0);
        g.moveTo(24, 0);
        g.lineTo(halfLen, 0);
        g.stroke();

        g.fillColor = COLOR_DIAMOND;
        g.moveTo(0, 9);
        g.lineTo(9, 0);
        g.lineTo(0, -9);
        g.lineTo(-9, 0);
        g.close();
        g.fill();
    }

    // ============================================================ 灵炁光点

    /**
     * 克隆 `WispTemplate` 铺一层上浮的光点。
     * 节点必须先在场景里摆好（挂好贴图、设成 `active = false`），见 `cloneTemplate`。
     */
    protected buildWisps(layer: Node | null): void {
        if (!layer) {
            return;
        }
        for (let i = 0; i < WISP_COUNT; i += 1) {
            const node = this.cloneTemplate('WispTemplate', `Wisp${i}`, layer);
            if (!node) {
                return;
            }
            node.active = true;
            const size = 4 + Math.random() * 12;
            this.fit(node, size, size);
            const sp = node.getComponent(Sprite);
            if (sp) {
                sp.color = new Color(
                    COLOR_GLOW.r, COLOR_GLOW.g, COLOR_GLOW.b,
                    120 + Math.floor(Math.random() * 110));
            }
            const op = node.addComponent(UIOpacity);
            op.opacity = 255;

            this.wisps.push({
                node,
                opacity: op,
                x: (Math.random() - 0.5) * 1400,
                y: (Math.random() - 0.5) * 900,
                vy: 8 + Math.random() * 20,
                amp: 10 + Math.random() * 30,
                phase: Math.random() * Math.PI * 2,
                sway: 0.25 + Math.random() * 0.5,
                baseAlpha: 0.35 + Math.random() * 0.5,
            });
        }
    }

    protected updateWisps(dt: number, t: number): void {
        const half = this.visibleSize().height / 2 + 60;
        for (const w of this.wisps) {
            w.y += w.vy * dt;
            if (w.y > half) {
                w.y = -half;
                w.x = (Math.random() - 0.5) * 1400;
            }
            w.node.setPosition(w.x + Math.sin(t * w.sway + w.phase) * w.amp, w.y, 0);
            // 上浮时淡出、回到底部再淡入，避免看到「瞬间消失」
            const edge = Math.min(1, (half - w.y) / 220, (w.y + half) / 220);
            w.opacity.opacity = Math.round(255 * w.baseAlpha * Math.max(0, edge));
        }
    }

    private wisps: Wisp[] = [];

    // ============================================================ 布局

    /** 每帧调。背景铺满、暗角跟着可视区、内容按高度等比缩放。 */
    protected layoutStage(contentRoot: Node | null = null): void {
        const vis = this.visibleSize();

        // 尺寸没变就别动 UITransform —— setContentSize 会标脏重排
        if (vis.width !== this.lastLayoutW || vis.height !== this.lastLayoutH) {
            this.lastLayoutW = vis.width;
            this.lastLayoutH = vis.height;

            // 暗角必须跟着可视区走：非 16:9 时固定 1280×720 会盖不住或压到画面外
            if (this.vignetteNode) {
                const ut = this.vignetteNode.getComponent(UITransform);
                if (ut) {
                    ut.setContentSize(vis.width, vis.height);
                }
            }
        }

        if (contentRoot) {
            const s = Math.min(1, vis.height / DESIGN_H);
            contentRoot.setScale(s, s, 1);
        }

        // 背景 cover：取两个方向缩放比的较大者，超出画布的部分落在屏幕外
        if (this.bgNode) {
            this.bgBaseScale = Math.max(vis.width / COVER_W, vis.height / COVER_H);
        }
    }

    /** 极缓慢的推近 + 平移，让长卷「活」起来；幅度小到不喧宾夺主。 */
    protected updateBackdrop(t: number): void {
        if (!this.bgNode) {
            return;
        }
        const zoom = 1 + 0.03 * (0.5 - 0.5 * Math.cos(t * 0.08));
        const s = this.bgBaseScale * zoom;
        this.bgNode.setScale(s, s, 1);
        this.bgNode.setPosition(
            Math.sin(t * 0.13) * 60,
            Math.sin(t * 0.09) * 18,
            0);
    }

    /**
     * 把节点缩放成 w×h 那么大。
     *
     * **必须按节点当前的 contentSize 反算，不能写死贴图边长** —— `Sprite` 一旦被
     * 赋 `spriteFrame` 就会把节点尺寸重置成贴图尺寸（图片导入时还会自动去掉透明边，
     * 实际尺寸常和源文件不一样），写死就会算错。
     */
    protected fit(node: Node, w: number, h: number): void {
        const ut = node.getComponent(UITransform);
        const bw = ut && ut.width > 0 ? ut.width : w;
        const bh = ut && ut.height > 0 ? ut.height : h;
        node.setScale(w / bw, h / bh, 1);
    }

    protected visibleSize(): { width: number; height: number } {
        const canvas = this.node.parent;
        const ut = canvas ? canvas.getComponent(UITransform) : null;
        if (ut && ut.width > 0 && ut.height > 0) {
            return { width: ut.width, height: ut.height };
        }
        const v = view.getVisibleSize();
        return { width: v.width, height: v.height };
    }
}
