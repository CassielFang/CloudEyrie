import {
    _decorator, Component, Color, Layers, Node, Sprite, SpriteFrame,
    UIOpacity, UITransform, resources, view, warn,
} from 'cc';
const { ccclass, property } = _decorator;

import { SequencePlayer } from './SequencePlayer';

const enum Step { Idle, DimIn, Playing, DimOut }

/**
 * 阶段转场叠层：**把画面调暗 → 叠上全屏动画 → 动画结束推进阶段**。
 *
 * 用法（挂在 Canvas 下的一个节点上，构造时会自动置顶）：
 *
 *     transition.play('九尾狐-幻影狂乱衔接', { onComplete: () => this.enterPhase2() });
 *
 * 为什么不用 `ui/ScreenStage`
 * --------------------------
 * `ScreenStage` 是「整页场景组件」——要求宿主场景摆好 BgScroll/Vignette/WispTemplate
 * 三件套，且是场景的唯一组件。这里要的是**叠在战斗场景上的临时层**，契约不匹配。
 * 只借它的 cover 铺满算法：`scale = max(visW / W, visH / H)`。
 *
 * 为什么遮罩是自己画的
 * --------------------
 * 项目里没有任何全屏遮罩/叠层类，现有的「压暗」只有 `TitleScreen.openPanel`
 * 给内容层降 `UIOpacity` 那一处。这里用 `white.png` 染黑 + `UIOpacity` 自己搭。
 */
@ccclass('StageTransition')
export class StageTransition extends Component {

    @property({ displayName: '压暗程度', tooltip: '0~255，越大背景越黑' })
    public dimOpacity = 190;

    @property({ displayName: '压暗用时' })
    public dimInDuration = 0.35;

    @property({ displayName: '收尾用时' })
    public dimOutDuration = 0.5;

    @property({ displayName: '停顿时长', tooltip: '动画播完后再停多久才收尾' })
    public holdDuration = 0.4;

    @property({ displayName: '资源目录' })
    public basePath = 'video_fx';

    @property({ displayName: '遮罩节点名' })
    public maskName = 'Mask';

    @property({ displayName: '动画节点名' })
    public stageName = 'Stage';

    private step: Step = Step.Idle;
    private timer = 0;          // 当前阶段已用时
    private holdTimer = 0;
    private dimOutTimer = 0;
    private animDone = false;
    private targetDim = 190;
    private hold = 0.4;
    private onComplete: (() => void) | null = null;

    private mask: Node | null = null;
    private maskOpacity: UIOpacity | null = null;
    private stage: Node | null = null;
    private player: SequencePlayer | null = null;

    protected onLoad(): void {
        // 叠层必须在最上面，否则被战斗画面盖住
        const parent = this.node.parent;
        if (parent) {
            this.node.setSiblingIndex(parent.children.length - 1);
        }
        this.build();
        this.setVisible(false);
    }

    /** 是否正在演出（调用方可据此锁住输入） */
    public get isPlaying(): boolean {
        return this.step !== Step.Idle;
    }

    /** 播一段转场；`onComplete` 在收尾结束、叠层隐藏之后调一次 */
    public play(name: string, opts?: { dimTo?: number; hold?: number; onComplete?: () => void }): void {
        if (this.step !== Step.Idle) {
            warn('[Transition] 上一段还没演完，忽略这次调用');
            return;
        }
        const player = this.player;
        if (!player) {
            warn('[Transition] 没有动画节点，转场不播');
            opts?.onComplete?.();
            return;
        }

        this.targetDim = opts?.dimTo ?? this.dimOpacity;
        this.hold = opts?.hold ?? this.holdDuration;
        this.onComplete = opts?.onComplete ?? null;
        this.timer = 0;
        this.holdTimer = 0;
        this.dimOutTimer = 0;
        this.animDone = false;
        this.step = Step.DimIn;

        this.setVisible(true);
        this.setMaskAlpha(0);

        // 先读索引拿到画布尺寸，才能按 cover 摆好；读完再起播
        player.loadManifest(name, (ok) => {
            if (!ok) {
                // 素材缺失不该卡住流程：跳过动画，直接收尾推进
                warn(`[Transition] 转场动画 "${name}" 加载失败，跳过动画直接推进`);
                this.animDone = true;
                return;
            }
            if (this.step === Step.Idle) {
                return;                       // 加载期间被取消
            }
            const size = player.canvasSize;
            if (size) {
                this.fitStage(size.width, size.height);
            }
            player.play(name, {
                loop: false,
                onComplete: () => { this.animDone = true; },
            });
        });
    }

    protected update(dt: number): void {
        switch (this.step) {
            case Step.DimIn: {
                this.timer += dt;
                const t = Math.min(1, this.timer / Math.max(0.01, this.dimInDuration));
                this.setMaskAlpha(Math.round(this.targetDim * t));
                if (t >= 1) {
                    this.step = Step.Playing;
                    this.holdTimer = 0;
                }
                break;
            }
            case Step.Playing: {
                // 动画由 SequencePlayer 自己推进，这里只等它播完再停顿
                if (!this.animDone) {
                    break;
                }
                this.holdTimer += dt;
                if (this.holdTimer >= this.hold) {
                    this.beginDimOut();
                }
                break;
            }
            case Step.DimOut: {
                this.dimOutTimer += dt;
                const t = Math.min(1, this.dimOutTimer / Math.max(0.01, this.dimOutDuration));
                this.setMaskAlpha(Math.round(this.targetDim * (1 - t)));
                if (t >= 1) {
                    this.finish();
                }
                break;
            }
            default:
                break;
        }
    }

    // ================= 内部 =================

    private beginDimOut(): void {
        this.step = Step.DimOut;
        this.dimOutTimer = 0;
        this.player?.stop();
    }

    private finish(): void {
        this.step = Step.Idle;
        this.setVisible(false);
        this.setMaskAlpha(0);
        const done = this.onComplete;
        this.onComplete = null;
        done?.();
    }

    private setVisible(on: boolean): void {
        if (this.mask) {
            this.mask.active = on;
        }
        if (this.stage) {
            this.stage.active = on;
        }
    }

    private setMaskAlpha(a: number): void {
        if (this.maskOpacity) {
            this.maskOpacity.opacity = Math.max(0, Math.min(255, a));
        }
    }

    /** 按 cover 铺满：短边也要填满，宁可裁掉一点也不要露边 */
    private fitStage(w: number, h: number): void {
        const stage = this.stage;
        if (!stage || w <= 0 || h <= 0) {
            return;
        }
        const vis = view.getVisibleSize();
        const s = Math.max(vis.width / w, vis.height / h);
        stage.setScale(s, s, 1);
    }

    private build(): void {
        // 幂等：编辑器可能会把 onLoad 建出来的节点存进场景，重载后不能再建一遍
        for (const n of [this.maskName, this.stageName]) {
            const old = this.node.getChildByName(n);
            if (old) {
                old.destroy();
            }
        }

        // ---- 遮罩：white.png 染黑，铺满可视区 ----
        const mask = new Node(this.maskName);
        mask.layer = Layers.Enum.UI_2D;
        this.node.addChild(mask);
        this.mask = mask;
        const vis = view.getVisibleSize();
        mask.addComponent(UITransform).setContentSize(vis.width, vis.height);
        const msp = mask.addComponent(Sprite);
        msp.sizeMode = Sprite.SizeMode.CUSTOM;
        msp.type = Sprite.Type.SIMPLE;
        msp.color = new Color(0, 0, 0, 255);
        this.maskOpacity = mask.addComponent(UIOpacity);
        this.maskOpacity.opacity = 0;

        // ---- 动画层：Sprite + SequencePlayer ----
        const stage = new Node(this.stageName);
        stage.layer = Layers.Enum.UI_2D;
        this.node.addChild(stage);
        this.stage = stage;
        stage.addComponent(UITransform).setContentSize(1, 1);
        const ssp = stage.addComponent(Sprite);
        ssp.sizeMode = Sprite.SizeMode.CUSTOM;
        ssp.type = Sprite.Type.SIMPLE;
        const player = stage.addComponent(SequencePlayer);
        player.basePath = this.basePath;
        // 全屏帧又大又只播一遍：前置留 1 页防卡，后置不留（省显存）
        player.aheadPages = 1;
        player.behindPages = 0;
        this.player = player;

        resources.load('white/spriteFrame', SpriteFrame, (err, frame) => {
            if (err || !frame) {
                warn('[Transition] white.png 加载失败，遮罩画不出来:', err);
                return;
            }
            msp.spriteFrame = frame;
        });
    }
}
