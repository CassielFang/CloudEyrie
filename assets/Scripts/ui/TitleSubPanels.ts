import {
    Node, Sprite, Label, UITransform, UIOpacity, Vec2,
    Color, EventKeyboard, tween,
} from 'cc';

import { COLOR_PANEL_HINT, COLOR_PANEL_INK } from './ScreenStage';
import { PanelDeps } from './PanelDeps';
import { SettingsPanel } from './SettingsPanel';

/**
 * 首页的三个子面板：设置 / 成就 / 制作组。
 *
 * 按项目的脚本分层约定，这里是个**普通工具类**（不是 Component）：由
 * `TitleScreen` 在 `onLoad` 里 new 出来，面板节点挂在它给的父节点下，
 * 生命周期跟着首页走，不需要自己注册引擎回调。
 *
 * 本类只管**框架**：底板、宣纸、标题、返回提示、开关与淡入淡出、命中判定。
 * 具体内容归各自的文件 —— 设置页在 `SettingsPanel`（已经能用），
 * 成就与制作组目前仍只有框 + 标题，填的时候照 `buildSettings()` 的写法加。
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

/**
 * 「按 E 退出」那一行。放在**地脚留白带里，与天头的标题完全镜像**。
 *
 * 同样别按比例算：地脚墨线也在距边 54~67px 处（实测底边与顶边对称），
 * 留白带只有 `-249 ~ -310` 这么高，字号 22 的文字占 26px，落在带子里正好。
 * 放到带子**以内**（比如 -218）会紧贴内容区，版面上不如镜像好看。
 *
 * ⚠️ 用 **E** 而不是 ESC：Web 上游戏是全屏跑的，而 **ESC 是浏览器保留的「退出全屏」键**
 * （页面试图拦也拦不住），拿它当返回键会一边关面板一边掉出全屏。
 */
const EXIT_HINT_Y = -PANEL_H / 2 + 28;
const EXIT_HINT_SIZE = 22;

/**
 * 制作组名单（一排一个名字）。
 *
 * ⚠️ 这份名单里有 `font.ttf` **缺的字**，见 `buildCredits()` —— 整列名字改用系统字体。
 * 加名字前先确认字形在不在：`font.ttf` 是毛笔行楷，扩展区汉字（如「䴰」U+4D30）基本都没有。
 */
const CREDITS = ['祁烬', '泠琼', '樱团', '䴰子', '雨迹', '规心', '穗岐', '柒月'];
const CREDITS_SIZE = 30;
const CREDITS_TOP = 170;
const CREDITS_GAP = 42;

/** 名单末尾那行说明。它的字 font.ttf 里都有，所以和标题一样保留毛笔体。 */
const CREDITS_NOTE = '排名不分先后';
const CREDITS_NOTE_Y = -196;
const CREDITS_NOTE_SIZE = 22;

/** 纸在暮色里会暗一档 —— 像月光下的宣纸。压太狠就和深墨字糊在一起了。 */
const PAPER_TINT = new Color(196, 206, 214, 255);

/**
 * 纸底颜色。要跟 `PAPER_TINT` 下的纸面同色，否则垫底的边会露出来。
 *
 * `panel_paper.png` 的纸面是半透明的墨水晕染（GDD 要的「半透明水墨质感」），
 * 直接铺在暮色山水上，背后山峦会透上来把深墨字压得看不清 —— 所以垫一层不透明的底。
 */
const BACKING_INK = new Color(186, 192, 191, 245);

export class TitleSubPanels {

    private root: Node | null = null;
    private opacity: UIOpacity | null = null;
    private body: Node | null = null;
    /** 面板底板，用来做「点面板外返回」的命中判定 */
    private backing: Node | null = null;
    /** 当前面板的内容对象（目前只有设置页有）。每次 open 重建，所以必须显式 dispose */
    private content: SettingsPanel | null = null;

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
        // 先拆旧内容再销毁节点：内容对象在全局单例上挂过监听（详见 disposeContent）
        this.disposeContent();
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
        // 关的瞬间就收掉内容，**不能等淡出 tween 结束**：这 0.2 秒里内容还挂在
        // 全局单例上（改键捕获模式），拖到回调里再清就晚了一拍
        this.disposeContent();
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

    /**
     * 把按键先交给面板内容。返回 true = 已消费，`TitleScreen` 不要再处理。
     *
     * 目前只有设置页会消费：改键捕获期间 E 是「取消改键」而不是「退出面板」，
     * 不先问一声的话，玩家想取消改键会被直接踢出面板。
     */
    public handleKeyDown(e: EventKeyboard): boolean {
        return this.content ? this.content.handleKeyDown(e) : false;
    }

    /**
     * 场景卸载时调（见 `TitleScreen.onDestroy`）。
     *
     * `eventBus` 是模块级单例、活得比场景久，内容对象若还挂着订阅，
     * 切场景后设置一变就会回调到已销毁的节点上。
     */
    public dispose(): void {
        this.disposeContent();
    }

    private disposeContent(): void {
        if (this.content) {
            this.content.dispose();
            this.content = null;
        }
    }

    // ======================================================== 三个面板
    // 成就与制作组仍然只有框 + 标题，内容待做。

    private buildSettings(): void {
        const body = this.body!;
        this.attachPaper(body, PANEL_W, PANEL_H);
        this.heading(body, '设    置');
        this.exitHint(body);
        this.content = new SettingsPanel(body, this.deps);
    }

    private buildAchievements(): void {
        const body = this.body!;
        this.attachPaper(body, PANEL_W, PANEL_H);
        this.heading(body, '成    就');
        this.exitHint(body);
    }

    /**
     * 制作组名单：一排一个名字，末尾一行「排名不分先后」。
     *
     * ⚠️ **整列名字用系统字体，不挂 `font.ttf`**：名单里「䴰」(U+4D30) 不在字体的
     * cmap 里，挂毛笔字体会**静默掉字**，把「䴰子」变成「子」—— 那是把一个真实的人
     * 的名字写错，比字形不统一严重得多（其余 15 个字字体都有）。
     * 面板标题与末尾那行说明的字都在字体里，所以仍用毛笔体，只有名字这一列有差异。
     *
     * 等字体文件补上这个字形，把下面那句 `label.font = null` 删掉即可恢复统一。
     * （`Label.font` 置空 = 回到系统字体，见 `2d/components/label.ts` 的 setter。）
     */
    private buildCredits(): void {
        const body = this.body!;
        this.attachPaper(body, PANEL_W, PANEL_H);
        this.heading(body, '制 作 组');

        for (let i = 0; i < CREDITS.length; i += 1) {
            const n = new Node(`Name${i}`);
            n.layer = body.layer;
            body.addChild(n);
            n.addComponent(UITransform);
            n.setPosition(0, CREDITS_TOP - i * CREDITS_GAP, 0);
            const label = this.deps.makeLabel(n, 'Label', CREDITS[i], CREDITS_SIZE, COLOR_PANEL_INK, 0);
            label.font = null;
        }

        const note = new Node('Note');
        note.layer = body.layer;
        body.addChild(note);
        note.addComponent(UITransform);
        note.setPosition(0, CREDITS_NOTE_Y, 0);
        this.deps.makeLabel(note, 'Label', CREDITS_NOTE, CREDITS_NOTE_SIZE, COLOR_PANEL_HINT, 0);

        this.exitHint(body);
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
        // outline = 0：面板底下垫了不透明底衬，字压的是浅色平面而不是山水画，
        // 默认那圈深色描边在这里只会把字糊脏
        this.deps.makeLabel(n, 'Label', text, HEADING_SIZE, COLOR_PANEL_INK, 0);
    }

    /** 三个面板共用的返回提示，位置与天头的标题镜像。见 `EXIT_HINT_Y`。 */
    private exitHint(parent: Node): void {
        const n = new Node('ExitHint');
        n.layer = parent.layer;
        parent.addChild(n);
        n.addComponent(UITransform);
        n.setPosition(0, EXIT_HINT_Y, 0);
        this.deps.makeLabel(n, 'Label', '按 E 退 出', EXIT_HINT_SIZE, COLOR_PANEL_HINT, 0);
    }
}
