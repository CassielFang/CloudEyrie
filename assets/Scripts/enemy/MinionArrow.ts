import {
    _decorator, BoxCollider2D, Component, Contact2DType, ERigidBody2DType, IPhysics2DContact,
    Layers, Node, RigidBody2D, Size, Sprite, UITransform,
    Vec2, director, log,
} from 'cc';
const { ccclass } = _decorator;

import { CombatController, PlayerDamageResult } from '../combat/CombatController';
import { PhysicsGroups } from '../core/PhysicsGroups';
import { spiritEnergySystem } from '../core/SpiritEnergySystem';
import { SequencePlayer } from '../fx/SequencePlayer';

/** 箭的素材（`art-source/_tools/extract_arrow.py` 从攻击动画里抽出来的那一帧） */
const ARROW_ASSET = '小怪-箭';
/** 素材画的是**朝左**的箭，朝右飞要镜像节点 */
const ARROW_NATURAL_DIR = -1;

/**
 * 小怪射出的箭 —— 阳浊小怪的**远程攻击**。
 *
 * 补的是一个「表现与逻辑对不上」的缺口：小怪的攻击动画明明是**拉弓射箭**，
 * 而 `EnemyAI` 的攻击是近战 —— 在距离内直接扣玩家灵炁、不生成任何东西。
 *
 * 为什么是 sensor
 * --------------
 * 箭不该把玩家顶开，所以碰撞体是 sensor。它落在 `PhysicsGroups.ARROW` 组，
 * 而**玩家身体那一组的 mask 里包含 ARROW**、箭是 sensor、玩家不是 ——
 * Box2D 对「sensor vs 非 sensor」是会报接触的（只有 sensor 对 sensor 才不报）。
 *
 * 命中后走 `CombatController.receivePlayerDamage()`，和近战同一条链路，
 * 于是格挡 / 完美格挡 / 受击扣灵炁全部自动生效，不用另写一套。
 */
@ccclass('MinionArrow')
export class MinionArrow extends Component {

    private damage = 15;
    private speed = 900;
    private dir = -1;
    private life = 2.0;
    private done = false;

    /** 箭身的半宽/半高（和碰撞体 150×20 一致），命中判定用 */
    private static readonly HIT_HALF_W = 75;
    private static readonly HIT_HALF_H = 10;

    private rb: RigidBody2D | null = null;
    private col: BoxCollider2D | null = null;
    private bound = false;
    /** 本帧已判定命中，等 update 里结算（不能在物理回调里动刚体） */
    private pendingHit = false;
    /** 结算目标：玩家节点与它的 CombatController */
    private target: Node | null = null;
    private targetCombat: CombatController | null = null;

    /**
     * 生成一支箭。`parent` 用关卡根节点；`worldPos` 是箭的出生世界坐标。
     */
    public static spawn(parent: Node, worldPos: Vec2, dir: number,
                        damage: number, speed: number): MinionArrow {
        const n = new Node('MinionArrow');
        n.layer = Layers.Enum.UI_2D;
        parent.addChild(n);
        const p = parent.worldPosition;
        n.setPosition(worldPos.x - p.x, worldPos.y - p.y, 0);
        n.addComponent(UITransform).setContentSize(160, 40);

        // ⚠️ 刚体/碰撞体的配法**照抄本项目的 `AttackHitBox`**（已验证可用）：
        //   `Animated` 刚体 —— fixture 跟随节点变换（`Static` 不跟随，会「打不中」）
        //   `sensor` 碰撞体 —— 只报接触、**不产生物理阻挡**
        //
        // 踩过的两个坑，都在这一处：
        //   1) 用 `Animated` + **靠 `linearVelocity` 推** → 速度被忽略，箭钉在空中；
        //   2) 改成 Dynamic + **非 sensor** → 箭会飞了，但和玩家的 Dynamic 刚体
        //      做真物理碰撞，**把玩家撞飞**（实测反馈「不是射在我身上，是把我撞飞了」）。
        //
        // 正解是两者结合：**Animated 刚体 + sensor**，位置由本组件每帧 `setPosition`
        // 自己积分 —— 既不需要质量/速度语义，又不产生任何物理推力。
        const rb = n.addComponent(RigidBody2D);
        rb.type = ERigidBody2DType.Animated;
        rb.gravityScale = 0;
        rb.allowSleep = false;                 // 休眠后 Box2D 不再评估接触
        rb.fixedRotation = true;

        const col = n.addComponent(BoxCollider2D);
        col.size = new Size(150, 20);
        col.sensor = true;                     // 只报接触，不阻挡、不推动
        col.group = PhysicsGroups.ARROW;
        col.apply();                           // ⚠️ 运行时建的碰撞体必须 apply()，否则夹具是 1×1

        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;

        const a = n.addComponent(MinionArrow);
        a.rb = rb;
        a.col = col;
        // 目标在这里就解析好 —— 别拖到 update 里每帧查场景
        const scene = director.getScene();
        a.target = scene ? scene.getChildByPath('Canvas/Qinghe') : null;
        a.targetCombat = a.target ? a.target.getComponent(CombatController) : null;
        a.damage = damage;
        a.speed = speed;
        a.dir = dir >= 0 ? 1 : -1;
        // 素材朝左；要朝右飞就镜像
        n.setScale(a.dir === ARROW_NATURAL_DIR ? 1 : -1, 1, 1);
        a.playArt();
        return a;
    }

    private playArt(): void {
        const pl = this.node.addComponent(SequencePlayer);
        pl.basePath = 'video_fx';
        pl.aheadPages = 0;
        pl.behindPages = 0;
        // 单帧素材：`play` 自己会去读 manifest，这里不用先 load 一遍
        pl.play(ARROW_ASSET, { loop: false });
    }

    protected onDisable(): void {
        if (this.bound && this.col) {
            this.col.off(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
            this.bound = false;
        }
    }

    /**
     * 惰性注册接触监听。
     *
     * ⚠️ **不能在 `onEnable` 里注册**：`spawn()` 里 `addComponent(MinionArrow)` 会
     * 立刻触发 `onEnable`，而 `this.col` 是在那之后才赋值的 —— 注册时 `col` 还是 null，
     * 监听**从来没挂上**。表现是「箭会飞会撞，但打不掉灵炁」（实测反馈「小怪的箭没有伤害」）。
     */
    private bindContact(): void {
        if (this.bound || !this.col) {
            return;
        }
        this.bound = true;
        this.col.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
    }

    private onBeginContact(_self: BoxCollider2D, other: BoxCollider2D,
                           _c: IPhysics2DContact | null): void {
        if (this.done) {
            return;
        }
        // 诊断：能碰到谁。碰撞分组限定只和 PLAYER 碰，所以这行只在打到玩家时出现。
        log(`[MinionArrow] 接触 ${other.node.name}`);
        const combat = other.node.getComponent(CombatController);
        if (!combat) {
            return;                        // 只打玩家；撞到别的一律无视
        }
        // ⚠️ **不要在接触回调里结算+销毁** —— 会报
        // `Can not active RigidBody in contact listener`（Box2D 不允许在回调里动刚体）。
        // 记下标记，交给下一帧的 `update` 处理。
        this.pendingHit = true;
    }

    /** 真正结算命中。由 `update` 在物理回调之外调用。 */
    private resolveHit(): void {
        this.done = true;
        const combat = this.targetCombat;
        if (!combat) {
            this.node.destroy();
            return;
        }
        const result: PlayerDamageResult = combat.receivePlayerDamage(this.damage);
        log(`[MinionArrow] 命中玩家，扣灵炁 ${result.spiritCost.toFixed(1)}（完美格挡=${result.perfectBlocked}）`);
        if (result.spiritCost > 0) {
            spiritEnergySystem.damage(result.spiritCost);
        }
        this.node.destroy();
    }

    protected update(dt: number): void {
        this.bindContact();
        // 位置自己积分，不走刚体速度 —— `Animated` 刚体本来就不吃 `linearVelocity`
        const p = this.node.position;
        this.node.setPosition(p.x + this.dir * this.speed * dt, p.y, 0);

        this.checkHitPlayer();
        if (this.pendingHit) {
            this.resolveHit();
            return;
        }

        this.life -= dt;
        if (this.life <= 0) {
            this.node.destroy();
        }
    }

    /**
     * **按矩形重叠判定命中**，不依赖物理接触。
     *
     * 为什么不用 `BEGIN_CONTACT`：这条链路要同时穿过「碰撞分组 → 夹具的过滤位 →
     * `apply()` 重建 → 刚体类型」四道关，**任何一道出错都是静默失败**，
     * 而且每一处读回来的值（`col.group`、`col.size`、`worldAABB`）都看着是对的，
     * 排查成本极高（这几轮就在这上面反复栽）。
     *
     * 抛射物本来就是个点/小矩形，直接算重叠既简单又能一眼验证。
     * 碰撞体与分组保留着 —— 将来要做「箭被地形挡下」时还用得上。
     */
    private checkHitPlayer(): void {
        if (this.done || !this.targetCombat || !this.target) {
            return;
        }
        const a = this.node.worldPosition;
        const t = this.target.worldPosition;
        // 箭 150×20；玩家身体 40×150、offset (0,55) → 竖直范围是 t.y-20 ~ t.y+130
        const halfW = MinionArrow.HIT_HALF_W + 20;
        const overlapX = Math.abs(a.x - t.x) <= halfW;
        const overlapY = a.y >= t.y - 20 - MinionArrow.HIT_HALF_H
            && a.y <= t.y + 130 + MinionArrow.HIT_HALF_H;
        if (overlapX && overlapY) {
            this.pendingHit = true;
        }
    }

}
