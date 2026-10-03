import {
    _decorator, BoxCollider2D, Component, ERigidBody2DType, Layers, Node,
    PhysicsSystem2D, Rect, RigidBody2D, Size, Sprite, SpriteFrame, UIOpacity, UITransform,
    Vec2, director, log, resources, warn,
} from 'cc';
const { ccclass, property } = _decorator;

import { CompanionStateMachine } from '../character/CompanionStateMachine';
import { CompanionForm } from '../character/forms/ICompanionForm';
import { Damageable } from '../combat/Damageable';
import { applyPhysicsGroups, PhysicsGroups } from '../core/PhysicsGroups';
import { spiritEnergySystem } from '../core/SpiritEnergySystem';
import { BossP1AI } from '../boss/BossP1AI';
import { EnemyAI } from '../enemy/EnemyAI';
import { MinionVisual } from '../enemy/MinionVisual';
import { CameraFollow } from './CameraFollow';
import { ParallaxBackground } from './ParallaxBackground';

/**
 * 关卡段落（对照 `docs/大赛规划v2.0（17天版）.md` 的「关卡总览」表）。
 *
 * 剧情顺序是固定的，这里的枚举值同时也是**推进顺序**。
 */
export enum LevelSegment {
    /** 0 开场过场：远景推进 → 青禾与莹翳行走 → 谷地被黑雾笼罩 → 狐鸣 */
    Opening = 'opening',
    /** 1 前奏探索：平台跳跃 → 遭遇阳浊小怪 → 战斗教学 */
    Explore = 'explore',
    /** 2 灵雾教学：灵界屏障挡路 → 切灵雾穿墙 → 触机关开门 */
    MistLesson = 'mist',
    /** 3 过渡段：短暂平静 → 灵泉恢复 → 远处九尾狐轮廓 */
    Approach = 'approach',
    /** 4 Boss P1 幻影 */
    BossP1 = 'bossP1',
    /** 5 Boss P2 狂乱（未实现） */
    BossP2 = 'bossP2',
    /** 6 Boss P3 归心（未实现） */
    BossP3 = 'bossP3',
    /** 7 结局过场（未实现） */
    Ending = 'ending',
}

/** 关卡横向布局（Canvas 本地坐标，x 向右）。整关宽 = LEVEL_RIGHT */
const LEVEL_LEFT = 0;
const LEVEL_RIGHT = 3200;
/** 地面碰撞体顶边所在的 y（与 main.scene 的 Ground 一致） */
const GROUND_Y = -335;
/** 玩家出生点 */
const SPAWN_X = 200;
/** Boss 战场中心 */
const ARENA_X = 2600;

/** 各段落的推进阈值：玩家 x 越过就进入该段 */
const SEGMENT_ORDER: Array<{ seg: LevelSegment; atX: number; note: string }> = [
    { seg: LevelSegment.Opening, atX: -1e9, note: '开场过场' },
    { seg: LevelSegment.Explore, atX: 420, note: '前奏探索：平台跳跃 + 阳浊小怪' },
    { seg: LevelSegment.MistLesson, atX: 1180, note: '灵雾教学：灵界屏障 + 机关' },
    { seg: LevelSegment.Approach, atX: 1780, note: '过渡段：灵泉 + 远处九尾狐轮廓' },
    { seg: LevelSegment.BossP1, atX: 2320, note: 'Boss P1 幻影' },
];

/**
 * 关卡导演：按「关卡总览」的段落顺序推进，并搭出关卡几何与道具。
 *
 * 为什么要有它
 * ------------
 * 之前直接把 Boss 摆在一个光秃秃的竞技场里，段落 0–3（开场 / 探索 / 灵雾教学 /
 * 过渡段）整段缺失。这里把关卡铺开：段落按玩家 x 推进，每段有自己的相机行为。
 *
 * 关卡的几何与道具是**代码搭的**，不是场景里摆的 —— 一是关卡还在反复调，
 * 摆场景里改一次要动编辑器；二是本项目此前也没有 prefab（`assets/Prefab/` 是空的），
 * 本来就得程序化建。
 */
@ccclass('LevelDirector')
export class LevelDirector extends Component {

    @property({ displayName: '玩家节点路径' })
    public playerPath = 'Canvas/Qinghe';

    @property({ displayName: 'Boss 节点路径', tooltip: '进入 Boss 战场时由本组件唤醒它' })
    public bossPath = 'Canvas/Boss';

    @property({ displayName: '背景节点路径', tooltip: 'ParallaxBackground 挂在这上面（与 CameraFollow 的同一个）' })
    public bgPath = 'Canvas/Background';

    @property({ displayName: '开局自动搭关卡' })
    public autoBuild = true;

    @property({ displayName: '开场过场时长' })
    public openingDuration = 4;



    /** 当前段落 */
    public segment: LevelSegment = LevelSegment.Opening;

    /** 段落变化回调（Boss AI 等挂上来） */
    public onSegmentChanged: ((seg: LevelSegment) => void) | null = null;

    private player: Node | null = null;
    private camera: CameraFollow | null = null;
    private bg: ParallaxBackground | null = null;
    private openTimer = 0;
    private built = false;
    /** 段落2 的灵界屏障/机关；段落3 的灵泉 */
    private barrier: Node | null = null;
    /** 屏障的**右半边**：排在玩家之后，形成「走进门里」的前后关系 */
    private barrierFront: Node | null = null;
    /** 建出来的小怪，搭完后要把它们提到角色层（见 buildLevel 末尾） */
    private minions: Node[] = [];
    private barrierCol: BoxCollider2D | null = null;
    private springPos = new Vec2();
    private inSpring = false;

    protected onLoad(): void {
        const scene = director.getScene();
        this.player = scene ? scene.getChildByPath(this.playerPath) : null;
        this.camera = this.getComponent(CameraFollow);
        // ⚠️ `ParallaxBackground` 挂在 `Canvas/Background` 上，**不在本组件所在的节点上**
        // （它是景物层，要在小怪/Boss 之下），所以要按路径取。
        // 早先这里写的是 `this.getComponent(ParallaxBackground)` —— 恒为 null，
        // 于是 `autoPanSpeed` 从来没被设过，开场过场与 Boss 战场的「背景缓慢平移」全程失效
        // （表现就是「远景不动」）。
        this.bg = this.getComponent(ParallaxBackground)
            ?? (scene ? scene.getChildByPath(this.bgPath)?.getComponent(ParallaxBackground) ?? null : null);
        if (!this.bg) {
            warn(`[Level] 找不到 ${this.bgPath} 上的 ParallaxBackground，背景不会平移`);
        }
        if (!this.player) {
            warn('[Level] 找不到玩家节点，段落推进不会生效');
            return;
        }
        this.setupPhysics();
        if (this.camera) {
            this.camera.setBounds(LEVEL_LEFT, LEVEL_RIGHT);
        }
        if (this.autoBuild) {
            this.buildLevel();
        }
        this.enterSegment(LevelSegment.Opening);
    }

    public getSegment(): LevelSegment {
        return this.segment;
    }

    protected update(dt: number): void {
        if (!this.player) {
            return;
        }
        this.updateMistLesson();
        this.updateSpring();
        // 开场过场：给一小段时间让玩家看到远景推进，不接收推进
        if (this.segment === LevelSegment.Opening) {
            this.openTimer += dt;
            if (this.openTimer >= this.openingDuration) {
                this.advanceTo(LevelSegment.Explore);
            }
            return;
        }
        if (this.segment === LevelSegment.BossP1) {
            return;                       // 交给 Boss AI
        }

        const x = this.player.position.x;
        // 取「已越过的最后一段」。显式标注类型：上面的 if 已经把
        // this.segment 收窄成不含 Opening/BossP1 的联合，直接用会被推断窄。
        let want: LevelSegment = this.segment;
        for (const s of SEGMENT_ORDER) {
            if (x >= s.atX) {
                want = s.seg;
            }
        }
        if (want !== this.segment && this.isAfter(want, this.segment)) {
            this.advanceTo(want);
        }
    }


    /**
     * 配好物理分组：让玩家与小怪**彼此不阻挡**，但命中盒仍能打到小怪。
     * 详见 `core/PhysicsGroups.ts` 的说明（为什么不能简单地把敌人做成 sensor）。
     */
    private setupPhysics(): void {
        applyPhysicsGroups();
        const p = this.player;
        if (!p) {
            return;
        }
        // 玩家身体
        const body = p.getComponent(BoxCollider2D);
        if (body) {
            body.group = PhysicsGroups.PLAYER;
            // ⚠️ `group` 的 setter 只改 JS 字段，夹具的过滤位要 `apply()` 才重建。
            // 少了这一句，玩家夹具的 categoryBits 仍是默认的 DEFAULT(1)，
            // 于是「箭(ARROW) vs 玩家」的双向过滤有一边过不了 → **接触根本不产生**。
            // 而 `body.group` 读回来是对的，所以日志看着毫无问题（和 `col.size` 同一类陷阱）。
            body.apply();
        }
        // 攻击命中盒（`CombatController.onLoad` 会去找这个子节点）
        const hb = p.getChildByName('AttackHitBox')?.getComponent(BoxCollider2D);
        if (hb) {
            hb.group = PhysicsGroups.HITBOX;
            hb.apply();
        } else {
            warn('[Level] 没找到 AttackHitBox，玩家将打不到任何敌人');
        }
        const m = PhysicsSystem2D.instance.collisionMatrix as unknown as Record<number, number>;
        log(`[Level] 物理分组 身体${body ? body.group : '?'} 命中盒${hb ? hb.group : '?'}`
            + `  矩阵 WORLD=${m[PhysicsGroups.WORLD]} PLAYER=${m[PhysicsGroups.PLAYER]}`
            + ` ENEMY=${m[PhysicsGroups.ENEMY]} HITBOX=${m[PhysicsGroups.HITBOX]}`);
    }


    /** 玩家当前形态（灵雾态能穿过灵界屏障） */
    private playerForm(): CompanionForm | null {
        const sm = this.player?.getComponent(CompanionStateMachine);
        return sm ? sm.getCurrentForm() : null;
    }

    /**
     * 段落2：灵界屏障挡路。
     *
     * 规则：**实体态被挡住，灵雾态可穿过**；灵雾态碰到机关即开门（屏障永久消失）。
     * 屏障碰撞体是运行时建的，位置不动、只切 `enabled` —— 关掉再打开不会让夹具失效。
     */
    private updateMistLesson(): void {
        if (!this.player || !this.barrierCol) {
            return;
        }
        // 屏障对**实体态是墙、对灵雾态放行** —— 这就是「灵雾穿墙」的教学本身。
        // （原先还有个「灵雾触碰机关 → 屏障永久消散」的设定，机关暂时不需要，已去掉。）
        this.barrierCol.enabled = this.playerForm() !== CompanionForm.Mist;
    }

    /** 段落3：靠近灵泉石台回灵炁（`SpiritEnergySystem` 那套现成的） */
    private updateSpring(): void {
        if (!this.player) {
            return;
        }
        const dx = this.player.position.x - this.springPos.x;
        const dy = this.player.position.y - this.springPos.y;
        const near = dx * dx + dy * dy <= 150 * 150;
        if (near !== this.inSpring) {
            this.inSpring = near;
            spiritEnergySystem.setInSpring(near);
            log(`[Level] 灵泉${near ? '范围内' : '范围外'}`);
        }
    }

    /** 只看推进序，防止玩家往回走时倒退段落 */
    private isAfter(a: LevelSegment, b: LevelSegment): boolean {
        const order = SEGMENT_ORDER.map((s) => s.seg);
        return order.indexOf(a) > order.indexOf(b);
    }

    private advanceTo(seg: LevelSegment): void {
        const entry = SEGMENT_ORDER.find((s) => s.seg === seg);
        log(`[Level] 进入段落：${seg}${entry ? ' —— ' + entry.note : ''}`);
        this.enterSegment(seg);
    }

    private enterSegment(seg: LevelSegment): void {
        this.segment = seg;
        switch (seg) {
            case LevelSegment.Opening:
                // 开场：相机钉在起点，背景缓慢推移（卷轴感）
                this.camera?.lock();
                if (this.bg) {
                    this.bg.autoPanSpeed = 18;
                }
                break;
            case LevelSegment.Explore:
                this.camera?.unlock();
                if (this.bg) {
                    this.bg.autoPanSpeed = 0;
                }
                break;
            case LevelSegment.BossP1: {
                // Boss 战场是固定场地：锁相机 + 背景重新缓慢平移
                this.camera?.lock();
                if (this.bg) {
                    this.bg.autoPanSpeed = 12;
                }
                // 唤醒 Boss。BossP1AI 的 autoStart 要关掉，开打时机由关卡流程决定
                const scene = director.getScene();
                const bn = scene ? scene.getChildByPath(this.bossPath) : null;
                const ai = bn ? bn.getComponent(BossP1AI) : null;
                if (ai) {
                    ai.begin();
                } else {
                    warn(`[Level] 找不到 ${this.bossPath} 上的 BossP1AI，Boss 不会开打`);
                }
                break;
            }
            default:
                break;
        }
        this.onSegmentChanged?.(seg);
    }

    // ================= 搭关卡 =================

    private buildLevel(): void {
        if (this.built) {
            return;
        }
        this.built = true;
        const root = this.node;

        // 地面**不在这里造**，用的是场景里那块 `Canvas/Ground`（已拉长到整关）。
        //
        // ⚠️ 为什么必须是场景节点：`QingheController.groundNode` 是 Inspector 上的
        // **节点引用**，着地判定写死了 `otherCollider.node === this.groundNode`。
        // 运行时新建的地面它指不到 —— `grounded` 永远是 false，`jumpCount` 就永远
        // 不重置，表现是「跳两次之后再也跳不起来」（实测反馈「接触过一次小怪就不会跳跃」）。
        // 而且运行时建的碰撞体还得额外 `apply()`（见 CLAUDE.md 的硬约束）。

        // 地面美术横向拉满整关，**并且挪到和碰撞体同一段区间**。
        //
        // ⚠️ 只调缩放不挪位置会出事：`GroundArt` 在 Canvas x=0，按锚点缩放后覆盖
        // −1603~+1603；而地面碰撞体在 Canvas x=1600，覆盖 0~3200。两者只在
        // 0~1603 重叠，于是
        //   · 左段 −1603~0：有贴图没碰撞体 → 看着是实的，踩上去掉下去；
        //   · 右段 1603~3200：有碰撞体没贴图 → 悬空行走，看着像地面断了。
        // 实测反馈正是「地面有的地方实有的地方虚、还不连续」。
        const groundArt = root.parent?.getChildByName('GroundArt');
        const gut = groundArt?.getComponent(UITransform);
        if (groundArt && gut && gut.contentSize.width > 0) {
            const k = (LEVEL_RIGHT - LEVEL_LEFT) / gut.contentSize.width;
            groundArt.setScale(k, 1, 1);
            groundArt.setPosition((LEVEL_LEFT + LEVEL_RIGHT) / 2, groundArt.position.y, 0);
            log(`[Level] 地面美术 ×${k.toFixed(2)} 并居中到 x=${((LEVEL_LEFT + LEVEL_RIGHT) / 2).toFixed(0)}`
                + `（原生 ${gut.contentSize.width.toFixed(0)} → ${LEVEL_RIGHT - LEVEL_LEFT}）`);
        }

        // 段落1 前奏探索的几级石台 —— **暂时不做**。
        //
        // 之前放了三个「只有碰撞体、没有贴图」的平台，角色撞上去就是撞空气，
        // 实测反馈是「莫名其妙看不到的障碍」。平台必须先有美术（石台贴图 / tileset）
        // 才有意义；在那之前不放，宁可这一段是平地。
        // 需要恢复时：连同贴图一起加，别再只加碰撞体。

        // 段落1 前奏探索：两只阳浊小怪。
        //
        // ⚠️ 位置要**离出生点（x=200）比远程射程（460）更远** —— 否则玩家一进场就被
        // 发现、立刻挨一箭，根本来不及看画面（实测反馈「一启动立刻就冲我射一箭」）。
        // 巡逻范围 ±140，所以要按最坏情况留够：860-140-200 = 520 > 460 ✓
        // y = GROUND_Y+126：小怪的脚底在节点下方约 61 单位，脚底正好落在地面美术
        // 的上沿。+120 时脚压进色带里看不见、+145 又离地悬空（两次实测反馈）。
        // ⚠️ 现在小怪受重力（见 makeMinion），这个 y 只是**出生点**，最终停在哪由
        // 碰撞体和地面的接触决定 —— 落点的对齐靠 makeMinion 里那个 −21 的 offset 保住。
        //
        // x 的约束是**两条**，要一起满足：
        //   离出生点(200) > 远程视野 690 → 进场不会被立刻发现（巡逻 ±140 也要算进去）
        //   在段落1 区间（420~1180）内
        this.minions.push(this.makeMinion(root, 950, GROUND_Y + 126, '小怪A'));
        this.minions.push(this.makeMinion(root, 1150, GROUND_Y + 126, '小怪B'));

        // 段落2 灵雾教学：灵界屏障挡路，须切灵雾穿过并触碰机关
        // ⚠️ 缩放是「世界单位 ÷ 原图高度」，不是随手填的：
        // 道具原图都是打印级尺寸（屏障 846×1062），给 1.0 就是 1000+ 单位高、比屏幕还大。
        // 目标高度按屏幕反推：0.62 × 1062 ≈ 658 单位 ≈ 一屏的 91%
        // （原先是 0.51 → 542，实测反馈「门还可以再高大一点」）。
        const BARRIER_SCALE = 0.62;
        /** 门的横向中心（两半各摆在 ±半个宽度处） */
        const BARRIER_X = 1400;
        /** 屏障原图高（`assets/Resources/场景小物件/灵界屏障（门）.png`，846×1062） */
        const BARRIER_ART_H = 1062;
        /**
         * 图**主体**底边距图心多少像素。
         *
         * 图整幅 1062 高看着像铺满，其实上下各有一条淡到测不出来的边
         * （按 alpha>8 量：内容在第 48~1019 行，下边距 42px）——
         * 按整图对齐会离地。用脚本量出来的值是 488px。
         */
        const BARRIER_BODY_BOTTOM = 488;
        /** 物理地面顶边的 Canvas y（GROUND_Y 是地面节点的 y，见 main.scene 的 Ground） */
        const PHYS_GROUND_Y = -295;
        // 主体底边压在地面上 → 再按实测反馈下调 25（人手调出来的手感值，别去掉）
        const BARRIER_Y = PHYS_GROUND_Y + BARRIER_BODY_BOTTOM * BARRIER_SCALE - 25;

        // 屏障本质是**门**：左半边在角色之后、右半边在角色之前，
        // 角色穿过时才像是「走进门里」。所以拆成前后两层（见 makePropHalf）。
        this.barrier = this.makePropHalf(root, '场景小物件/灵界屏障（门）', BARRIER_X, BARRIER_Y,
            BARRIER_SCALE, 'Barrier', 'left');
        this.barrierFront = this.makePropHalf(root, '场景小物件/灵界屏障（门）', BARRIER_X, BARRIER_Y,
            BARRIER_SCALE, 'BarrierFront', 'right');
        {
            // ⚠️ 碰撞体挂在**单独一个节点**上，不能挂 `this.barrier`。
            //
            // `makePropHalf` 为了让两半分处角色前后，会把各自节点挪开**半个宽度**
            // （左半 −262、右半 +262）。挂在左半节点上的话，碰撞体的中心跟着跑到
            // 门的**左半边** —— 从左边撞上来是「走进门里」的样子，但从右边过来要先
            // 穿进门的右半边 360 单位才被挡住，看着像从门里穿过去（实测反馈
            // 「从左到右做的不错，从右到左就一般」，根因就是这个偏了 131 的中心）。
            //
            // 所以另起一个位置固定、只当墙用的节点，中心就摆在门的正中间。
            const blocker = new Node('BarrierBlocker');
            blocker.layer = Layers.Enum.UI_2D;
            root.addChild(blocker);
            blocker.setPosition(BARRIER_X, BARRIER_Y, 0);
            // 运行时建的碰撞体**必须 apply()**，否则夹具是默认的 1×1（详见 CLAUDE.md 的硬约束）
            const c = blocker.addComponent(BoxCollider2D);
            // 尺寸 = 门左右两半的**交接缝**那根长条，不是整扇门的宽度。
            // 缝对齐到门中心后，两半各自露在角色身前/身后，角色能一直走到门框里
            // ——「走进门里」的前后关系才成立。整扇门等宽的话角色只能停在门外。
            // 高度比美术再高出 100：底边扎到地面以下、顶边越过屏幕上沿，
            // 否则门顶留在屏幕内、二段跳能翻过去绕过灵雾教学。
            const BARRIER_SEAM_W = 70;
            c.size = new Size(BARRIER_SEAM_W, BARRIER_ART_H * BARRIER_SCALE + 100);
            c.friction = 0;
            c.apply();
            this.barrierCol = c;
        }
        // 灵界机关**暂时不放** —— 需求方明确说目前不需要。
        // 「灵雾穿墙」这个教学本身不依赖机关：屏障对实体态是墙、对灵雾态放行就够了。
        // 素材（`灵界机关（亮/暗）`）还在 Resources 里，要加回来随时可以。

        // 段落3 过渡段：灵泉石台（靠近回灵炁）。
        // 目标高约 300 → 304/1047 ≈ 0.29；主体底边距图心 440px × 0.29 ≈ 128，
        // 对齐物理地面 −295 → 节点 y = −295 + 128 = −167；再下调 25 → GROUND_Y + 143。
        const spring = this.makeProp(root, '场景小物件/灵泉石台（回血）', 1850, GROUND_Y + 143, 0.29, 'Spring');
        this.springPos = new Vec2(spring.position.x, spring.position.y);
        // TODO 段落3 还欠「远处九尾狐轮廓」——应当是九尾狐的单帧剪影，
        // 但拿整段序列帧只显示一帧成本高，先留空。

        // 诊断：确认场景里那块地面确实在、且盖住了出生点。
        // 真正的判据仍是行为（见 update 里的玩家 y 追踪），几何只是辅助。
        const g = root.parent?.getChildByName('Ground');
        const gcol = g?.getComponent(BoxCollider2D);
        if (g && gcol) {
            const w = g.worldPosition;
            log(`[Level] 地面 active=${g.active} `
                + `x ${(w.x - gcol.size.width / 2).toFixed(0)}~${(w.x + gcol.size.width / 2).toFixed(0)} `
                + `顶 ${(w.y + gcol.size.height / 2).toFixed(0)}`);
        } else {
            warn('[Level] 场景里找不到带 BoxCollider2D 的 Ground —— 角色会掉下去、也跳不起来');
        }
        const p = this.player?.worldPosition;
        log(`[Level] 玩家世界坐标 (${p ? p.x.toFixed(0) : '?'}, ${p ? p.y.toFixed(0) : '?'})`);
        // 图层归位。`Level` 是**景物层**（灵泉、屏障左半），
        // 「会动的角色」应当和青禾同属角色层，所以提到 Canvas 下、和青禾并排：
        //   … 景物 → 小怪 → Boss → 青禾 → 屏障右半 → HUD
        // Level 在 Canvas 本地坐标 (0,0)，所以局部坐标不用换算。
        const canvas = root.parent;
        const qinghe = canvas?.getChildByName('Qinghe');
        if (canvas && qinghe) {
            const base = qinghe.getSiblingIndex();
            this.minions.forEach((m, i) => {
                if (m.isValid) {
                    m.setParent(canvas);
                    m.setSiblingIndex(base + i);
                }
            });
            if (this.barrierFront) {
                // 屏障右半在**玩家之后**，角色穿门时才像「走进门里」
                this.barrierFront.setParent(canvas);
                this.barrierFront.setSiblingIndex(base + this.minions.length + 1);
            }
        }

        log('[Level] 关卡已搭建：地面 + 灵界屏障 + 灵泉 + Boss 战场');
    }



    /**
     * 造一只阳浊小怪：`EnemyAI` 要求同节点有 `RigidBody2D` + `Damageable`，
     * 外加一个 `Art` 子节点给它翻转朝向；表现交给 `MinionVisual` 按状态切序列帧。
     */
    private makeMinion(parent: Node, x: number, y: number, name: string): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        parent.addChild(n);
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(200, 200);

        const rb = n.addComponent(RigidBody2D);
        rb.type = ERigidBody2DType.Dynamic;
        // ⚠️ **要有重力**（和青禾一致），不能是 0。
        // `gravityScale = 0` 时 Y 方向一旦被赋过速度就再也回不来 —— 表现是
        // 「小怪走着走着飘起来」（实测反馈）。有重力才会被地面接住。
        rb.gravityScale = 1;
        rb.fixedRotation = true;
        rb.allowSleep = false;

        // ⚠️ 碰撞体**必须比 `gameConfig.enemy.attackRange`(72) 的一半小**。
        // 小怪是「走到攻击距离就停下开打」的，碰撞体一旦宽过两倍攻击距离，
        // 它就会一边「停在攻击距离」一边把玩家顶开 —— 实测表现是「人物被小怪挤跑」。
        // main.scene 原本那只小怪用的是 64×110（半宽 32 < 72），照这个比例来。
        const col = n.addComponent(BoxCollider2D);
        col.size = new Size(80, 130);
        // ⚠️ 碰撞体相对节点**下移 21**，不是 0。
        //
        // 上面那个 y（GROUND_Y+126）是当初按「脚底正好压在地面美术上沿」实测调出来的，
        // 而它当时是靠 `gravityScale = 0` 悬在半空才成立的 —— 碰撞体底边比地面高 21。
        // 现在改成受重力，节点会自己落下来 21 单位，脚就压进地面色带里了
        // （正是当初 +120 那版的毛病）。把碰撞体下移同样的量，落点就回到原来的位置。
        col.offset = new Vec2(0, -21);
        col.friction = 0.9;
        col.group = PhysicsGroups.ENEMY;   // 玩家身体穿得过去，但刀能砍到（见 PhysicsGroups.ts）
        col.apply();                  // ⚠️ 运行时建的碰撞体必须 size/offset 都要 apply()，否则夹具还是 1×1

        n.addComponent(Damageable);

        // ⚠️ `Art` 子节点必须在 `EnemyAI` **之前**建好。
        // `EnemyAI.onLoad` 里 `this.artNode = getChildByName('Art')` 是一次性的，
        // 顺序反了就拿不到、`applyFacingFlip` 整个失效 —— 表现是「小怪不会转身」（踩过）。
        const art = new Node('Art');
        art.layer = Layers.Enum.UI_2D;
        n.addChild(art);
        art.addComponent(UITransform).setContentSize(512, 512);
        const sp = art.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;

        // 远程型：攻击距离取 `rangedAttackRange`（460），且攻击时射出箭的抛射物，
        // 而不是近身直接结算 —— 它的攻击动画是**拉弓射箭**
        const ai = n.addComponent(EnemyAI);
        ai.ranged = true;
        // 真美术已接入，关掉灰盒的按状态染色（否则攻击时整只小怪变红）
        ai.tintByState = false;
        // 两条动画现在都朝右：行走那条本来就是，攻击那条在流水线里镜像过
        // （美术组交的两条视频左右相反，见 gen_video_fx.py 的 VIDEOS 说明）
        ai.artNaturalFacing = 1;

        // artScale 乘的是**打包后的**帧尺寸（512 × 0.5 = 256），主体约占画布 72%。
        // 原定 1.1（约 200 世界单位高）实测偏大，按反馈缩到 0.6 倍 → 0.66
        const mv = n.addComponent(MinionVisual);
        mv.artScale = 0.66;
        return n;
    }

    /**
     * 摆「门」的**半边** —— 左半 / 右半各一个节点，好让它们分处角色的前后两层。
     *
     * 做法：加载整图后，按纹理的 rect 各取一半，造两个 `SpriteFrame`。
     * 注意 `SpriteFrame.rect` 用的是**左上原点**，且导入时图被自动裁过透明边，
     * 所以必须基于 `frame.rect`（裁剪后区域）来切，不能按原图尺寸切。
     */
    private makePropHalf(parent: Node, path: string, x: number, y: number,
                         scale: number, name: string, half: 'left' | 'right'): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        parent.addChild(n);
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(1, 1);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;

        resources.load(`${path}/spriteFrame`, SpriteFrame, (err, frame) => {
            if (err || !frame) {
                warn(`[Level] 道具读不到 ${path}：${err}`);
                return;
            }
            const r = frame.rect;
            const halfW = r.width / 2;
            const sub = new SpriteFrame();
            sub.texture = frame.texture;
            // `rect` 是**左上原点**：`r.x` 就是图的左边缘，所以 left 取左半 ✓
            sub.rect = new Rect(
                half === 'left' ? r.x : r.x + halfW, r.y, halfW, r.height);
            sub.originalSize = new Size(halfW, r.height);
            sp.spriteFrame = sub;

            n.getComponent(UITransform)?.setContentSize(halfW, r.height);
            n.setScale(scale, scale, 1);

            // ⚠️ 两半的分开**靠挪节点，不要碰 `SpriteFrame.offset`**。
            // 那个字段的语义是「裁剪区相对原图中心的偏移」，拿它当摆放坐标用会左右颠倒
            // （实测反馈「屏障左右弄反了」）。锚点是 (0.5,0.5)，所以各挪半个宽度即可。
            n.setPosition(x + (half === 'left' ? -1 : 1) * halfW * scale / 2, y, 0);
        });
        return n;
    }

    /** 摆一件可运行时加载的道具 */
    private makeProp(parent: Node, path: string, x: number, y: number,
                     scale: number, name: string): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        parent.addChild(n);
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(1, 1);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;
        resources.load(`${path}/spriteFrame`, SpriteFrame, (err, frame) => {
            if (err || !frame) {
                warn(`[Level] 道具读不到 ${path}：${err}`);
                return;
            }
            sp.spriteFrame = frame;
            // ⚠️ `sizeMode = CUSTOM` 下画面尺寸 = `contentSize × node.scale`。
            // contentSize 必须设成**原图尺寸**，否则它一直是上面那个 `(1,1)` ——
            // 道具会渲染成约 1 像素，等于看不见（排查了好几轮的「灵泉/屏障显示不出来」）。
            // 背景层踩过同一个坑，当时只修了那边。
            const src = frame.rect;
            n.getComponent(UITransform)?.setContentSize(src.width, src.height);
            n.setScale(scale, scale, 1);
        });
        return n;
    }
}
