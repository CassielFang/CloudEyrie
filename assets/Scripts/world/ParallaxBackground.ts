import {
    _decorator, Component, Layers, Node, Sprite, SpriteFrame, UITransform,
    log, resources, warn,
} from 'cc';
const { ccclass, property } = _decorator;

/** 一层的配置 */
export interface LayerSpec {
    /** resources 下的路径（不含 /spriteFrame） */
    path: string;
    /** 视差系数：1 = 与地面同速（跟着世界走），0 = 钉死在屏幕上（无穷远） */
    factor: number;
    /** 相对画面中心的 y 偏移 */
    yOffset: number;
    /**
     * 目标世界高度：**不够高就整体放大**（等比，宽度跟着涨）。
     *
     * 为什么需要它：本作的背景图都是「一条带 + 上下透明边」的长卷
     * （远景 1920×1080 里可见的云带只占第 300~816 行）。只按宽度贴合的话
     * 云带在世界里只有 ~420 单位高，屏幕顶部就露出一条空白 ——
     * 实测反馈「远景没有铺满」。给一个目标高度让可见带够高。
     *
     * 取 `max(按宽度算的倍率, 按高度算的倍率)`，所以只会放大不会缩小。
     */
    height?: number;
    /**
     * 自身漂移的**振幅**（世界单位），与相机无关，按 `driftPeriod` 来回摆。
     * 远景是云，静止的话像贴纸 —— 设计文档 §7.1 写的是「远景：淡墨山峦，**云雾流动**」。
     *
     * ⚠️ 是**振幅**不是速度：早先写成「每秒位移」并无限累加，云会一直往一边走，
     * 走上几分钟就把图层整个推出屏幕、露出空白。现在按正弦来回摆，永远有界。
     */
    drift?: number;
    /** 一次完整来回的秒数（默认 40） */
    driftPeriod?: number;
    /**
     * 是否跟随 `autoPanSpeed` 的自动平移（开场过场 / Boss 战场那份「背景缓慢推移」）。
     *
     * **默认关**：只有远景的云需要自己动，中景与山景保持不动
     * （需求方 2026-10-04 明确「只要远景那个云动就行了，中景近景什么的都不用动」）。
     *
     * 顺带也避掉一个隐患：`layerWidth()` 是**刚好**按视差系数算出来的、没有余量，
     * 而无条件平移会让图层往一边走、把边缘推出屏幕 ——
     * 中景就会在平移约 130 秒后从左侧露空。不参与平移的层永远没有这个问题。
     */
    autoPan?: boolean;
}

/** 背景层配置：从远到近，绘制顺序同数组顺序 */
export const DEFAULT_LAYERS: LayerSpec[] = [
    // 远景是云雾带，给它自身漂移 —— 纯静止会像一张贴纸贴在后面。
    //
    // height 1350（原图 1080 的 1.25 倍）与 yOffset 120 是一起定的：
    //   云带顶边 = 120 + 240×1.25 = 420（屏幕顶 360 之上，留 60 余量）
    //   云带底边 = 120 − 276×1.25 = −225（中景带顶边 227，两者接得上、不漏）
    // 于是 227~420 这一段屏幕只会看到远景 —— 远近层次才分得出来。
    // （原先 yOffset 70、没有 height：云带只到 266，且 96% 被中景挡住，等于看不见。）
    { path: '背景/远景', factor: 0.15, yOffset: 120, height: 1350, drift: 26, driftPeriod: 36, autoPan: true },
    { path: '背景/中景', factor: 0.45, yOffset: -40 },
];

/**
 * 沿关卡**散布**的景物（不是铺满一屏的整层）。
 *
 * `背景/山.png` 是一株独立的青绿山峰（1680×2240 竖构图），本来就是给叠层用的，
 * 但整层铺开会把它横向拉扁。所以改成按 x 逐个摆，各自按自己的视差系数移动 ——
 * 这样关卡里才有"远近层次"，不然跑起来只有一层中景、显得空。
 */
export interface ScenerySpec {
    path: string;
    /** 视差系数：越接近 1 越贴近玩法层 */
    factor: number;
    /** 目标高度（世界单位），等比缩放 */
    height: number;
    /** 底边对齐的 y（世界坐标） */
    bottomY: number;
    /** 摆放位置（关卡 x） */
    xs: number[];
}

/**
 * 默认景物：几座山峰错落在中景之后。
 *
 * ⚠️ 用的是 `山·透明.png` 而不是 `山.png` —— **原图是画在白纸上的、没有 alpha**，
 * 直接贴上来会是一张白卡片盖住画面。`山·透明.png` 由
 * `art-source/_tools/key_image.py` 抠出（不改源文件）。
 */
export const DEFAULT_SCENERY: ScenerySpec[] = [
    { path: '背景/山·透明', factor: 0.62, height: 620, bottomY: -300, xs: [520, 1720, 2760] },
];

/**
 * 视差背景：把长卷拆出的远景 / 中景分层，按不同速度滚动。
 *
 * 核心一行（见 `apply`）：`node.x = cameraX * (1 - factor)`。
 * 相机本身会被 `CameraFollow` 移动 `+cameraX`，所以：
 *   - `factor = 1` → 节点位移 0 → 和地面一样跟着世界走
 *   - `factor = 0` → 节点位移 = 相机位移 → 两层相消，看上去钉在屏幕上（无穷远）
 * 中间值就是常规视差。
 *
 * 为什么中景要指定 `width`
 * ------------------------
 * `背景/中景.png` 只有一屏宽（1920），而关卡横向有好几屏。视差系数 0.45 意味着
 * 相机走 1 屏它要走 0.45 屏，所以至少要 `一屏 + 0.45 × 相机行程` 才不露边。
 * 宽度不够时**拉伸而不是平铺** —— 中景是一幅完整构图（左草坡、中灵瀑、右山门），
 * 平铺会在接缝处把草坡怼到山门上。
 *
 * 远景是柔和的雾带，拉伸看不出来，所以也走拉伸。
 */
@ccclass('ParallaxBackground')
export class ParallaxBackground extends Component {

    @property({ displayName: '层配置', tooltip: '从远到近；改动需重跑才生效' })
    public layers: LayerSpec[] = DEFAULT_LAYERS;

    @property({ displayName: '散布景物', tooltip: '沿关卡逐个摆的景物（山峰等）' })
    public scenery: ScenerySpec[] = DEFAULT_SCENERY;

    @property({ displayName: '自动平移速度', tooltip: '每秒额外漂移的世界单位；Boss 战场用，探索段设 0' })
    public autoPanSpeed = 0;

    /** 相机累计位移，由 CameraFollow 每帧写入 */
    private cameraX = 0;
    private pan = 0;
    private built: Node[] = [];
    private specs: LayerSpec[] = [];
    /** 散布景物：每个实例记下自己的关卡 x、视差系数与中心 y */
    private placed: Array<{ node: Node; baseX: number; factor: number; centerY: number }> = [];
    /** 累计时间（秒），各层拿它算正弦漂移 */
    private elapsed = 0;
    /** 相机行程 [min, max]，由 CameraFollow 告知，决定每层该拉多宽 */
    private camMin = 0;
    private camMax = 2600;
    private viewW = 1280;

    public setCameraX(x: number): void {
        this.cameraX = x;
    }

    /**
     * 设定相机行程。**必须在建层之前给到**，因为每层的宽度由它反推：
     *
     *     layerW = viewW + factor × (camMax − camMin)
     *
     * 推导：要让相机从关卡头走到尾时，图层正好从「左边缘贴屏幕左边」滑到
     * 「右边缘贴屏幕右边」，两端都不露空。设行程 T、视口 W、视差系数 f，
     * 相机位移 T 而图层只位移 (1−f)T，所以图层要比视口多出 f×T 才够滑。
     * 少给就会在关卡末尾露空，多给则图层被无谓拉大、糊掉。
     */
    public setRange(camMin: number, camMax: number, viewW: number): void {
        this.camMin = camMin;
        this.camMax = camMax;
        this.viewW = viewW;
        // 日志打在这里而不是 layout()：layout() 在 onLoad 里就会跑一次，
        // 那时行程还是默认值，打出来的宽度是错的（踩过）
        // 打**实际**尺寸而不是 layerWidth()：给了 `height` 的层会被放大，
        // 实际宽度大于 layerWidth()，只看后者会以为没生效（排查过一轮）
        const detail = this.specs
            .map((s, i) => {
                const n = this.built[i];
                const size = n?.getComponent(UITransform)?.contentSize;
                const actual = size ? `${(size.width * n.scale.x).toFixed(0)}×${(size.height * n.scale.y).toFixed(0)}` : '?';
                const want = `需要宽 ${this.layerWidth(s).toFixed(0)}${s.height ? ` / 高 ${s.height}` : ''}`;
                return `${s.path.split('/').pop()} f=${s.factor} 实际 ${actual}（${want}）`;
            })
            .join('  ');
        log(`[Parallax] 视口 ${this.viewW}  行程 [${camMin.toFixed(0)}, ${camMax.toFixed(0)}]  ${detail}`);
        this.layout();
    }

    protected onLoad(): void {
        this.node.layer = Layers.Enum.UI_2D;
        this.specs = this.layers.map((s) => this.mergeDefaults(s));
        this.build();
    }

    /**
     * 补齐场景里没存的字段。
     *
     * ⚠️ **这是本项目反复踩的坑**：`@property` 的数组是**逐个元素整体序列化**进场景的，
     * 给 `LayerSpec` 新加一个字段（比如 `drift` / `height`）之后，
     * 场景里存下来的那份旧数组**不会有这个键**，而 Cocos **不会**用类默认值去补
     * —— 于是新字段在运行时恒为 `undefined`，改代码毫无效果。
     * 表现就是「改了默认值但画面纹丝不动」。
     *
     * 所以这里按 `path` 找到同名层的代码默认值，把场景里缺的键补上。
     * 场景里**显式存了值**的字段仍然以场景为准（Inspector 照常可调）。
     */
    private mergeDefaults(raw: LayerSpec): LayerSpec {
        const merged = { ...raw };
        const def = DEFAULT_LAYERS.find((d) => d.path === raw.path);
        if (!def) {
            return merged;
        }
        const missing: string[] = [];
        for (const key of Object.keys(def) as Array<keyof LayerSpec>) {
            if ((merged as Record<string, unknown>)[key] === undefined) {
                (merged as Record<string, unknown>)[key] = def[key];
                missing.push(key);
            }
        }
        if (missing.length > 0) {
            log(`[Parallax] ${raw.path} 场景里缺 ${missing.join('/')}，取代码默认值`
                + `（老场景的序列化数组不会自动补新字段）`);
        }
        return merged;
    }

    protected update(dt: number): void {
        this.elapsed += dt;
        if (this.autoPanSpeed !== 0) {
            const limit = this.maxPan();
            this.pan = Math.max(-limit, Math.min(limit, this.pan + this.autoPanSpeed * dt));
        }
        this.apply();
    }

    /**
     * 自动平移的**安全上限**（世界单位）——再往外推，参与平移的层就会从屏幕边缘露空。
     *
     * 推导：相机推到 `camMax` 时，图层左边缘
     *     `camMin − W/2 + lw/2 + (travel + pan)(1−f) − 实际宽/2`
     * 必须不超过屏幕左边 `camMin + travel − W/2`，解出
     *     `pan ≤ (实际宽 − W + f·travel) / (2(1−f))`
     * 取所有参与平移的层里最紧的一个。
     *
     * 为什么非要有：`layerWidth()` 是**刚好**按视差系数算的、没有余量，
     * 而平移是单向累加的。Boss 战场一直开着 `autoPanSpeed`，
     * 不封顶的话打到一分多钟云就滑出屏幕、左边缘露出空白。
     */
    private maxPan(): number {
        const travel = Math.max(0, this.camMax - this.camMin);
        let limit = Number.POSITIVE_INFINITY;
        this.built.forEach((n, i) => {
            const spec = this.specs[i];
            if (!spec || !spec.autoPan || spec.factor >= 1) {
                return;
            }
            const ut = n.getComponent(UITransform);
            const actualW = ut ? ut.contentSize.width * n.scale.x : this.layerWidth(spec);
            const room = (actualW - this.viewW + spec.factor * travel) / (2 * (1 - spec.factor));
            limit = Math.min(limit, room);
        });
        return limit;
    }

    /** 某层此刻的漂移位移：按 `driftPeriod` 来回摆，有界 */
    private driftOffset(spec: LayerSpec): number {
        if (!spec.drift) {
            return 0;
        }
        const period = spec.driftPeriod && spec.driftPeriod > 0 ? spec.driftPeriod : 40;
        return spec.drift * Math.sin((this.elapsed / period) * Math.PI * 2);
    }

    /** 每层的实际宽度（世界单位），由视差系数与相机行程算出 */
    private layerWidth(spec: LayerSpec): number {
        const travel = Math.max(0, this.camMax - this.camMin);
        return this.viewW + spec.factor * travel;
    }

    /**
     * 层的摆放。
     *
     *     L(camX) = camMin − W/2 + layerW/2 + (camX − camMin) × (1 − f)
     *
     * 基准项保证 `camX = camMin` 时图层左边缘正好贴住屏幕左边（关卡开头看到长卷最左端），
     * 增量项就是视差本身。
     */
    private apply(): void {
        this.built.forEach((n, i) => {
            const spec = this.specs[i];
            if (!spec) {
                return;
            }
            const lw = this.layerWidth(spec);
            const base = this.camMin - this.viewW / 2 + lw / 2;
            // 逐层漂移量：各层各自摆动，和相机无关
            // 自动平移只给开了 `autoPan` 的层（远景的云），其余层不参与
            const panTerm = spec.autoPan ? this.pan : 0;
            const x = base + (this.cameraX - this.camMin + panTerm) * (1 - spec.factor)
                + this.driftOffset(spec);
            n.setPosition(x, spec.yOffset, 0);
        });
        // 散布景物：以**关卡坐标**为基准（baseX），相机一动就按 (1-factor) 让位。
        // 同样不参与自动平移（山景要稳住，动的只有远景的云）
        for (const s of this.placed) {
            if (s.node.isValid) {
                s.node.setPosition(s.baseX + this.cameraX * (1 - s.factor),
                    s.centerY, 0);
            }
        }
    }

    private buildScenery(): void {
        this.scenery.forEach((raw, si) => {
            const spec = { ...raw };
            spec.xs.forEach((baseX, xi) => {
                const n = new Node(`Scenery_${si}_${xi}`);
                n.layer = Layers.Enum.UI_2D;
                this.node.addChild(n);
                n.addComponent(UITransform).setContentSize(1, 1);
                const sp = n.addComponent(Sprite);
                sp.sizeMode = Sprite.SizeMode.CUSTOM;
                sp.type = Sprite.Type.SIMPLE;
                const rec = { node: n, baseX, factor: spec.factor, centerY: spec.bottomY };
                this.placed.push(rec);

                const path = `${spec.path}/spriteFrame`;
                resources.load(path, SpriteFrame, (err, frame) => {
                    if (err || !frame) {
                        warn(`[Parallax] 读不到景物 ${path}：${err}`);
                        return;
                    }
                    sp.spriteFrame = frame;
                    const src = frame.rect;
                    n.getComponent(UITransform)?.setContentSize(src.width, src.height);
                    const k = spec.height / src.height;
                    n.setScale(k, k, 1);
                    // 锚点在中心，所以「底边对齐 bottomY」= 节点 y 抬高半个缩放后高度
                    rec.centerY = spec.bottomY + (src.height * k) / 2;
                });
            });
        });
    }

    private build(): void {
        // 幂等：编辑器可能把上次建出来的层存进了场景
        for (const c of this.node.children.slice()) {
            c.destroy();
        }
        this.built = [];
        this.placed = [];
        this.specs.forEach((spec, i) => {
            const n = new Node(`Layer_${spec.path.split('/').pop() ?? i}`);
            n.layer = Layers.Enum.UI_2D;
            this.node.addChild(n);
            n.addComponent(UITransform).setContentSize(1, 1);
            const sp = n.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.type = Sprite.Type.SIMPLE;
            this.built.push(n);

            const path = `${spec.path}/spriteFrame`;
            resources.load(path, SpriteFrame, (err, frame) => {
                if (err || !frame) {
                    warn(`[Parallax] 读不到背景层 ${path}：${err}`);
                    return;
                }
                sp.spriteFrame = frame;
                // ⚠️ spec 必须传：漏传会走「按视口宽」的兜底分支，
                // 每层都被拉成一屏宽而不是各自的 layerWidth，关卡首尾就会露空
                this.fitLayer(n, frame, spec);
            });
        });
        this.buildScenery();
        this.layout();
    }

    /**
     * 把一层拉到目标宽度。
     *
     * ⚠️ `sizeMode = CUSTOM` 下，画面尺寸 = `contentSize × node.scale`。
     * 所以 contentSize 必须设成**原图尺寸**、缩放才是纯倍率；
     * 之前把 contentSize 设成可视宽度（1280）又乘倍率，实际只画到 1733 而不是 2600，
     * 表现就是「背景被推进了」。
     *
     * `spec.height` 给了目标高度时取**两个要求里更大的那个倍率**（只会放大）。
     * 放大后图层比 `layerWidth()` 宽 —— 这是安全的：`apply()` 里的基准项
     * 决定的是**图层中心**，更宽只会往两边多探出去，不会露空。
     */
    private fitLayer(n: Node, frame: SpriteFrame, spec: LayerSpec): void {
        const ut = n.getComponent(UITransform);
        const src = frame.rect;
        if (!ut || src.width <= 0) {
            return;
        }
        ut.setContentSize(src.width, src.height);
        const byWidth = this.layerWidth(spec) / src.width;
        const byHeight = spec.height && src.height > 0 ? spec.height / src.height : 0;
        const s = Math.max(byWidth, byHeight);
        n.setScale(s, s, 1);
    }

    /** 行程变了就重新量一遍（相机与视口都要到齐才准） */
    private layout(): void {
        this.specs.forEach((spec, i) => {
            const n = this.built[i];
            const sp = n ? n.getComponent(Sprite) : null;
            if (n && sp && sp.spriteFrame) {
                this.fitLayer(n, sp.spriteFrame, spec);
            }
        });
        this.apply();
    }
}
