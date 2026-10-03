import {
    _decorator, Component, JsonAsset, Rect, Size, Sprite, SpriteFrame,
    UITransform, resources, warn,
} from 'cc';
const { ccclass, property } = _decorator;

/** 一帧在图集页里的位置（左上原点，与 SpriteFrame.rect 同约定） */
interface FrameEntry {
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
}

/** `art-source/_tools/pack_atlas.py` 产出的索引格式 */
export interface SequenceManifest {
    name: string;
    canvas: number[];
    fps: number;
    frames: number;
    layout: 'grid' | 'single';
    pageSize: number[];
    pages: string[];
    entries: FrameEntry[];
    loop?: string | null;
    anchor?: string;
}

/**
 * 序列帧播放器：把美术组给的视频转成的 PNG 序列播出来。
 *
 * 用法：挂到带 `Sprite` 的节点上，然后 `play('九尾狐-幻影', { loop: true })`。
 *
 * 为什么要滑动窗口
 * ----------------
 * 九段动画合计 15.7 亿像素 ≈ 6.3GB 原始 RGBA，**全量常驻显存不可能**
 * （`狐火` 一个小怪就有 88M 像素）。所以这里只保留播放头附近的几页，
 * 播过去的立刻 `decRef` 掉。驻留页数有上界，与动画总长无关。
 *
 * 子帧是运行时构造的，不依赖编辑器的图集系统：
 * 拿页的 `Texture2D` + 一个 `Rect` 就能拼出 `SpriteFrame`。
 */
@ccclass('SequencePlayer')
export class SequencePlayer extends Component {

    @property({ displayName: '资源目录', tooltip: 'resources/ 下的子目录，打包器产出所在处' })
    public basePath = 'video_fx';

    @property({ displayName: '窗口前置页数', tooltip: '播放头之后再驻留几页' })
    public aheadPages = 1;

    @property({ displayName: '窗口后置页数', tooltip: '播放头之前再驻留几页；全屏那种大页设 0 最省显存' })
    public behindPages = 1;

    @property({ displayName: '起播前预载', tooltip: '关掉则第一圈可能卡顿' })
    public preloadBeforePlay = true;

    private manifest: SequenceManifest | null = null;
    private sprite: Sprite | null = null;

    /** 已加载的页：页号 → 贴图页的 SpriteFrame */
    private pages = new Map<number, SpriteFrame>();
    /** 正在加载中的页，防重复请求 */
    private loading = new Set<number>();
    /** 子帧缓存：帧号 → 裁好的 SpriteFrame；随页释放一起清 */
    private frames = new Map<number, SpriteFrame>();

    private playing = false;
    private loop = true;
    private elapsed = 0;
    private index = 0;
    private onComplete: (() => void) | null = null;
    /** 本次播放的帧区间（含两端） */
    private from = 0;
    private to = 0;
    private pendingFrom = 0;
    private pendingTo = -1;
    /** 播放倍速。美术给的动画按「表演」剪，往往比游戏节奏慢，靠它追上 */
    private playbackScale = 1;

    protected onLoad(): void {
        this.sprite = this.getComponent(Sprite);
        if (!this.sprite) {
            warn('[Sequence] 节点上没有 Sprite 组件，序列帧没地方画');
        }
    }

    protected onDestroy(): void {
        this.releaseAll();
    }

    public get isPlaying(): boolean {
        return this.playing;
    }

    public get frameCount(): number {
        return this.manifest ? this.manifest.frames : 0;
    }

    /** 当前帧号。Boss 分身靠它对齐相位。 */
    public get frameIndex(): number {
        return this.index;
    }

    /**
     * 跳到指定帧（负值会绕回）。
     *
     * 给「多个实例播同一段动画、必须长得一模一样」用 —— 各实例是异步加载后
     * 各自起播的，相位天然错开；Boss 的三个分身不同步的话就看不出是同一个 Boss，
     * 「1 真 2 假」的辨识前提就没了。
     */
    public setFrame(frame: number): void {
        if (!this.manifest || this.manifest.frames <= 0) {
            return;
        }
        const n = this.manifest.frames;
        this.index = ((frame % n) + n) % n;
        this.elapsed = 0;
        this.present();
    }

    /** 当前播放区间的**起止帧**（Boss 分身靠它对齐相位；播单段时也能看出范围） */
    public get frameRange(): { from: number; to: number } {
        return { from: this.from, to: this.to };
    }

    /** 帧尺寸（画布尺寸），调用方可据此摆放。未加载时返回 null */
    public get canvasSize(): Size | null {
        if (!this.manifest) {
            return null;
        }
        return new Size(this.manifest.canvas[0], this.manifest.canvas[1]);
    }

    /** 只把索引读进来，不播。用于提前准备。 */
    public loadManifest(name: string, cb?: (ok: boolean) => void): void {
        const path = `${this.basePath}/${name}/manifest`;
        resources.load(path, JsonAsset, (err, asset) => {
            if (err || !asset) {
                warn(`[Sequence] 读不到索引 ${path}：${err}`);
                cb?.(false);
                return;
            }
            const m = asset.json as SequenceManifest;
            if (!m || !m.entries || !m.pages) {
                warn(`[Sequence] 索引格式不对：${path}`);
                cb?.(false);
                return;
            }
            this.manifest = m;
            const ut = this.getComponent(UITransform);
            if (ut) {
                ut.setContentSize(m.canvas[0], m.canvas[1]);
            }
            if (this.sprite) {
                this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                this.sprite.type = Sprite.Type.SIMPLE;
            }
            cb?.(true);
        });
    }

    /**
     * 播放。索引没读过会先读一遍。
     *
     * `from` / `to` 可以只播一段 —— 美术给的动画往往**不是为游戏节奏剪的**，
     * 例如小怪的攻击动画前 2.5 秒都在「拉满弓保持」，整段播会看起来像
     * 「箭一直吊着不射」。只取「放箭前后」那一段才像一次攻击。
     *
     * `onComplete` 只在非循环播放结束时调一次。
     */
    public play(name: string, opts?: {
        loop?: boolean; from?: number; to?: number;
        timeScale?: number; onComplete?: () => void;
    }): void {
        this.loop = opts?.loop ?? true;
        // ⚠️ 回调**不能在这里设** —— 下面的 `start()` 会先调 `stop()`，
        // 而 `stop()` 里有一句 `this.onComplete = null`（那是给外部主动取消用的），
        // 会把刚设好的回调清掉，播完永远不会通知。
        // 症状极隐蔽：`MinionVisual` 的「攻击播完回走路」没被调用 → `attacking`
        // 一直是 true → 走路动画从此不再播，小怪卡成一帧静止图。
        const wantComplete = opts?.onComplete ?? null;
        this.pendingFrom = opts?.from ?? 0;
        this.pendingTo = opts?.to ?? -1;
        this.playbackScale = Math.max(0.05, opts?.timeScale ?? 1);

        const start = (): void => {
            this.stop();                       // 换动画时先把上一个的页放掉
            this.onComplete = wantComplete;    // 必须在 stop() 之后
            const last = this.manifest ? this.manifest.frames - 1 : 0;
            this.from = Math.max(0, Math.min(this.pendingFrom, last));
            this.to = this.pendingTo < 0 ? last : Math.max(this.from, Math.min(this.pendingTo, last));
            this.index = this.from;
            this.elapsed = 0;
            this.playing = true;
            // 先把首窗载好再开播，否则第一圈会卡
            this.ensureWindow(this.from, this.to);
            this.present();
        };

        if (this.manifest && this.manifest.name === name) {
            start();
            return;
        }
        this.loadManifest(name, (ok) => {
            if (ok) {
                start();
            } else {
                this.onComplete?.();
            }
        });
    }

    public stop(): void {
        this.playing = false;
        this.onComplete = null;
        this.releaseAll();
    }

    /** 停在当前帧，不释放页 */
    public pause(): void {
        this.playing = false;
    }

    public resume(): void {
        if (this.manifest) {
            this.playing = true;
        }
    }

    protected update(dt: number): void {
        if (!this.playing || !this.manifest) {
            return;
        }
        const fps = this.manifest.fps > 0 ? this.manifest.fps : 24;
        const step = 1 / (fps * this.playbackScale);
        this.elapsed += dt;

        // while 而不是 if：掉帧时一次补多帧，避免慢机器上动画变慢
        while (this.elapsed >= step) {
            this.elapsed -= step;
            this.index += 1;
            if (this.index > this.to) {
                if (this.loop) {
                    this.index = this.from;
                } else {
                    this.index = this.to;
                    this.playing = false;
                    this.present();
                    const done = this.onComplete;
                    this.onComplete = null;
                    done?.();
                    return;
                }
            }
        }
        this.present();
    }

    // ================= 内部 =================

    private present(): void {
        if (!this.manifest || !this.sprite) {
            return;
        }
        const e = this.manifest.entries[this.index];
        if (!e) {
            return;
        }
        this.ensureWindow(e.page, this.manifest.entries[this.to]?.page ?? -1);

        const sf = this.frames.get(this.index);
        // 页还没加载完就继续显示上一帧，宁可停一帧也不闪空白
        if (sf) {
            this.sprite.spriteFrame = sf;
        }
    }

    /**
     * 只保留 [当前页 - behind, 当前页 + ahead]，其余释放。
     *
     * 只播一段（`from`/`to`）时，窗口还要**盖住整段的首尾**：否则那段跨了页、
     * 后面的页没驻留，播到一半就没帧可显示。
     */
    private ensureWindow(page: number, rangeEndPage = -1): void {
        if (!this.manifest) {
            return;
        }
        const last = this.manifest.pages.length - 1;
        let lo = Math.max(0, page - this.behindPages);
        let hi = Math.min(last, page + this.aheadPages);
        if (rangeEndPage >= 0) {
            lo = Math.min(lo, this.manifest.entries[this.from]?.page ?? lo);
            hi = Math.max(hi, rangeEndPage);
        }

        for (let p = lo; p <= hi; p += 1) {
            this.loadPage(p);
        }
        for (const p of Array.from(this.pages.keys())) {
            if (p < lo || p > hi) {
                this.releasePage(p);
            }
        }
    }

    private loadPage(page: number): void {
        if (!this.manifest || this.pages.has(page) || this.loading.has(page)) {
            return;
        }
        const file = this.manifest.pages[page];
        if (!file) {
            return;
        }
        const name = file.replace(/\.png$/i, '');
        const path = `${this.basePath}/${this.manifest.name}/${name}/spriteFrame`;
        this.loading.add(page);

        resources.load(path, SpriteFrame, (err, sf) => {
            this.loading.delete(page);
            if (err || !sf) {
                warn(`[Sequence] 读不到图集页 ${path}：${err}`);
                return;
            }
            // 加载期间窗口可能已经移走了，那就别留着
            if (!this.manifest) {
                sf.decRef();
                return;
            }
            const cur = this.manifest.entries[this.index];
            const last = this.manifest.pages.length - 1;
            let lo = Math.max(0, cur.page - this.behindPages);
            let hi = Math.min(last, cur.page + this.aheadPages);
            // 与 ensureWindow 保持一致：区间末页也要留住
            const endPage = this.manifest.entries[this.to]?.page ?? -1;
            if (endPage >= 0) {
                lo = Math.min(lo, this.manifest.entries[this.from]?.page ?? lo);
                hi = Math.max(hi, endPage);
            }
            if (page < lo || page > hi) {
                sf.decRef();
                return;
            }
            sf.addRef();
            this.pages.set(page, sf);
            this.buildSubFrames(page, sf);
        });
    }

    /** 把这一页里属于本动画的所有帧裁出来缓存好，播放时直接取 */
    private buildSubFrames(page: number, pageSf: SpriteFrame): void {
        if (!this.manifest) {
            return;
        }
        const tex = pageSf.texture;
        this.manifest.entries.forEach((e, i) => {
            if (e.page !== page || this.frames.has(i)) {
                return;
            }
            const sf = new SpriteFrame();
            sf.texture = tex;
            sf.rect = new Rect(e.x, e.y, e.w, e.h);
            sf.originalSize = new Size(e.w, e.h);
            sf.packable = false;
            this.frames.set(i, sf);
        });
    }

    private releasePage(page: number): void {
        const sf = this.pages.get(page);
        if (!sf) {
            return;
        }
        this.pages.delete(page);
        if (this.manifest) {
            this.manifest.entries.forEach((e, i) => {
                if (e.page === page) {
                    this.frames.delete(i);
                }
            });
        }
        sf.decRef();
    }

    private releaseAll(): void {
        for (const p of Array.from(this.pages.keys())) {
            this.releasePage(p);
        }
        this.pages.clear();
        this.frames.clear();
    }
}
