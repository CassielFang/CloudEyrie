import {
    Node, Sprite, Label, UITransform, UIOpacity, Vec2,
    Color, tween,
} from 'cc';

/**
 * 首页的三个子面板：设置 / 成就 / 制作组。
 *
 * 按项目的脚本分层约定，这里是个**普通工具类**（不是 Component）：由
 * `TitleScreen` 在 `onLoad` 里 new 出来，面板节点挂在它给的父节点下，
 * 生命周期跟着首页走，不需要自己注册引擎回调。
 *
 * ⚠️ **三个面板目前只有框，没有内容** —— 按需求先把内容留空，等后续版本再做。
 * 现在打开任何一项看到的都是「宣纸框 + 标题」，用来确认版面尺寸与交互
 * （打开、ESC 或点框外返回）是通的。填内容时在 `buildXxx()` 的标题之后接着加即可，
 * `PANEL_W` / `PANEL_H` 就是内容可用区域，不用再动框架代码。
 *
 * 视觉走 GDD §7.3 的「石碑、卷轴意象，半透明水墨质感」：底图复用美术组生成的
 * `panel_paper.png`（宣纸九宫格）。制作组原来单独用 `panel_scroll.png` 卷轴，
 * 后来改成和另外两个统一了 —— 那个模板节点还留在 `Title.scene` 里（`PanelScrollTemplate`），
 * 留给以后的图鉴/收集品列表用，现在没人引用。
 */

export type SubPanelKind = 'settings' | 'achievements' | 'credits';

/** 面板贴图的九宫格切边。见 `art-source/README.md`。 */
const PAPER_INSET = 72;

/** 内容可用区域，三个面板共用。填内容时按这个范围排版。 */
const PANEL_W = 1000;
const PANEL_H = 620;

/**
 * 柔边底衬要比纸面每边多出这么多，晕开的部分才落在纸面**之外**、看得出「虚」。
 *
 * 和纸面一样大的话，底衬的渐变全被纸面盖住，看到的还是纸面自己的边
 * —— 之前就是这个原因显得边缘发死。
 * 纵向最多只能给到 50：屏幕才 720 高，620 的面板加上去正好顶满。
 *
 * 改这两个值要和 `gen_title.py` 的 `title_panel()`（贴图的 fade_x / fade_y）配着调，
 * 换算过去应该正好相等：贴图 590 宽 → 显示 1180 宽，fade 45 → 90；纵向 360 → 720，fade 25 → 50。
 */
const BACKING_PAD_X = 90;
const BACKING_PAD_Y = 50;

/**
 * 标题位置与字号。放在**墨框线以上的天头留白里**，不要压在线上。
 *
 * ⚠️ 别按 `0.06 × PANEL_H` 之类去算墨线的位置欺骗自己：`panel_paper.png` 是用
 * 九宫格切的（切边 72px），**边框区不参与拉伸**、按贴图原始像素画，所以墨线实际落在
 * 距面板顶约 61px 处，而不是按比例缩放出来的 37px。标题原来放在 68px 处，只差 7px
 * 又被字号一撑，线就正好从字中间穿过。
 *
 * 天头那条留白只有约 55px 高，字号 40 已经接近上限 —— 想再大就得把标题挪到墨线
 * **下方**（面板内部），那边空间充足。
 */
const HEADING_Y = PANEL_H / 2 - 28;
const HEADING_SIZE = 40;

/** 纸在暮色里会暗一档 —— 像月光下的宣纸。压太狠就和深墨字糊在一起了。 */
const PAPER_TINT = new Color(196, 206, 214, 255);

/**
 * 纸底颜色。要跟 `PAPER_TINT` 下的纸面同色，否则垫底的边会露出来。
 *
 * `panel_paper.png` 的纸面是半透明的墨水晕染（GDD 要的「半透明水墨质感」），
 * 直接铺在暮色山水上，背后山峦会透上来把深墨字压得看不清 —— 所以垫一层不透明的底。
 */
const BACKING_INK = new Color(186, 192, 191, 245);

const COLOR_HEADING = new Color(46, 116, 132, 255);

interface PanelDeps {
    /** 建一个居中描边文本，复用首页那套字体与描边设置 */
    makeLabel(parent: Node, name: string, text: string, size: number,
        color: Color, outline?: number): Label;
    /** 克隆场景里的模板节点（面板贴图不在 resources/ 下，只能这样拿） */
    clone(templateName: string, name: string, parent: Node): Node | null;
}

export class TitleSubPanels {

    private root: Node | null = null;
    private opacity: UIOpacity | null = null;
    private body: Node | null = null;
    /** 面板底板，用来做「点面板外返回」的命中判定 */
    private backing: Node | null = null;

    private opened = false;

    constructor(private host: Node, private deps: PanelDeps) {
        this.getRoot();
    }

    public get isOpen(): boolean {
        return this.opened;
    }

    private getRoot(): Node {
        if (this.root && this.root.isValid) {
            return this.root;
        }
        const n = new Node('SubPanels');
        n.layer = this.host.layer;
        this.host.addChild(n);
        this.opacity = n.addComponent(UIOpacity);
        this.opacity.opacity = 0;
        n.active = false;
        this.root = n;
        return n;
    }

    // ======================================================== 开关

    public open(kind: SubPanelKind): void {
        const root = this.getRoot();
        if (this.body) {
            this.body.destroy();
        }
        this.backing = null;

        this.body = new Node('Body');
        this.body.layer = root.layer;
        root.addChild(this.body);

        switch (kind) {
            case 'settings': this.buildSettings(); break;
            case 'achievements': this.buildAchievements(); break;
            case 'credits': this.buildCredits(); break;
            default: break;
        }

        this.opened = true;
        root.active = true;
        if (this.opacity) {
            this.opacity.opacity = 0;
            tween(this.opacity).to(0.25, { opacity: 255 }).start();
        }
    }

    public close(): void {
        if (!this.opened) {
            return;
        }
        this.opened = false;
        const op = this.opacity;
        const root = this.root;
        if (op && root) {
            tween(op).to(0.2, { opacity: 0 }).call(() => { root.active = false; }).start();
        }
        else if (root) {
            root.active = false;
        }
    }

    /** 点是否落在面板上。落在外面时由 TitleScreen 负责关掉面板。 */
    public hitTest(uiPoint: Vec2): boolean {
        const n = this.backing;
        if (!this.opened || !n || !n.isValid) {
            return false;
        }
        const ut = n.getComponent(UITransform);
        return ut ? ut.getBoundingBoxToWorld().contains(uiPoint) : false;
    }

    // ======================================================== 三个面板
    // 现在都只有框 + 标题，内容待做。

    private buildSettings(): void {
        const body = this.body!;
        this.attachPaper(body, PANEL_W, PANEL_H);
        this.heading(body, '设    置');
    }

    private buildAchievements(): void {
        const body = this.body!;
        this.attachPaper(body, PANEL_W, PANEL_H);
        this.heading(body, '成    就');
    }

    private buildCredits(): void {
        const body = this.body!;
        this.attachPaper(body, PANEL_W, PANEL_H);
        this.heading(body, '制 作 组');
    }

    // ======================================================== 面板底板

    /**
     * 在面板底下垫一层「柔边底衬」—— 中间实、四边晕开的纸色块。
     *
     * 面板贴图本身的纸面是半透明的（GDD 要的「半透明水墨质感」），不垫底的话背后
     * 山峦会透上来把深墨字压得看不清；但直接画个 `Graphics` 实心矩形的话边缘是硬的，
     * 跟整幅水墨画的气质冲突。所以用 `title_panel.png`（生成器出的柔边图）两全。
     *
     * `w` / `h` 是**纸面**尺寸；底衬会往外多画一圈（见 `BACKING_PAD_X/Y`）。
     * 必须**先于**面板贴图加，否则会盖住纸纹和墨框。
     */
    private attachBacking(parent: Node, w: number, h: number): void {
        const pad = this.deps.clone('PanelSoftTemplate', 'Backing', parent);
        if (!pad) {
            return;
        }
        pad.active = true;
        const ut = pad.getComponent(UITransform);
        if (ut) {
            ut.setContentSize(w + BACKING_PAD_X * 2, h + BACKING_PAD_Y * 2);
        }
        const sp = pad.getComponent(Sprite);
        if (sp) {
            // 贴图是纯白 + alpha，颜色全靠这里染
            sp.type = Sprite.Type.SIMPLE;
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.color = BACKING_INK;
        }
        pad.setPosition(0, 0, 0);
    }

    /** 宣纸面板：柔边底衬 + 九宫格纸纹。 */
    private attachPaper(parent: Node, w: number, h: number): void {
        this.attachBacking(parent, w, h);

        const paper = this.deps.clone('PanelPaperTemplate', 'Paper', parent);
        if (!paper) {
            return;
        }
        this.backing = paper;
        paper.active = true;
        const ut = paper.getComponent(UITransform);
        if (ut) {
            ut.setContentSize(w, h);
        }
        const sp = paper.getComponent(Sprite);
        if (sp) {
            const f = sp.spriteFrame;
            // 九宫格切边只写在 README 里、没进 .meta，所以运行时补一次。
            // 不切的话 1024×1024 的方图压到 860×540，笔锋粗细两个方向会差 1.6 倍。
            if (f) {
                f.insetLeft = PAPER_INSET;
                f.insetRight = PAPER_INSET;
                f.insetTop = PAPER_INSET;
                f.insetBottom = PAPER_INSET;
            }
            sp.type = Sprite.Type.SLICED;
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.color = PAPER_TINT;
        }
        paper.setPosition(0, 0, 0);
    }

    private heading(parent: Node, text: string): void {
        const n = new Node('Heading');
        n.layer = parent.layer;
        parent.addChild(n);
        n.addComponent(UITransform);
        n.setPosition(0, HEADING_Y, 0);
        this.deps.makeLabel(n, 'Label', text, HEADING_SIZE, COLOR_HEADING, 0);
    }
}
