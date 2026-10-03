import {
    _decorator, BoxCollider2D, Color, Component, Node, RigidBody2D, Sprite,
    UITransform, Vec2, director, log, warn,
} from 'cc';
const { ccclass, property } = _decorator;

import { CompanionStateMachine } from '../character/CompanionStateMachine';
import { CompanionForm } from '../character/forms/ICompanionForm';
import { Damageable, DamageInfo } from '../combat/Damageable';
import { CombatController, PlayerDamageResult } from '../combat/CombatController';
import { gameConfig } from '../core/GameConfig';
import { PhysicsGroups } from '../core/PhysicsGroups';
import { sceneManager } from '../core/SceneManager';
import { spiritEnergySystem } from '../core/SpiritEnergySystem';
import { SequencePlayer } from '../fx/SequencePlayer';
import { StageTransition } from '../fx/StageTransition';
import { BossClone } from './BossClone';

/** Boss 阶段 */
export enum BossPhase {
    P1 = 'p1',
    Transition = 'transition',
    /** P1 打完、P2 未实现的占位态 */
    Stopped = 'stopped',
}

/** P1 子状态 */
const enum Step { Split, Idle, Reshuffle }

/** 染色：假身压暗（设计文档「假身为纯黑」），真身显灵炁纹路 */
const TINT_FAKE = new Color(70, 70, 90, 255);
const TINT_REAL = new Color(150, 245, 255, 255);

/** P2 尚未实现，P1 转场播完先跳这里把流程串通 */
const ENDING_SCENE = 'Ending';

/** 一个「身位」：真身或诱饵 */
interface CloneSlot {
    node: Node;
    player: SequencePlayer;
    /** 当前占用的散布位置下标 */
    posIndex: number;
    isReal: boolean;
}

/**
 * 九尾狐 Boss —— 第一阶段「幻影」。
 *
 * 玩法（依据 `docs/关于boss战的一些修改.md`，比 17 天计划新）：
 *   分裂出 3 身（1 真 2 假）→ **未识破前攻击无效** → 玩家切灵雾飞近识破
 *   → 真身显灵炁纹路、假身纯黑 → 切回实体输出 → 每 10 秒重排，需重新识破
 *   → HP 降到 70% 播全屏转场进入 P2（P2 尚未实现）。
 *
 * 模型上做了一处简化
 * ----------------
 * **真身永远是挂本组件的根节点**，另两个是程序化建出来的诱饵（只有立绘，
 * 没有碰撞体、没有血量）。重排时三者在三个位置间轮换、根节点直接移过去。
 * 这样血量只有一个来源，不必在多份 `Damageable` 之间搬运。
 *
 * 代价：打在诱饵上的刀会直接穿过去、没有打击反馈。想要反馈的话，
 * 得给诱饵也加碰撞体和 `Damageable`（置 `invulnerable`）再由它统一路由伤害。
 *
 * 契约：同节点要有 `RigidBody2D` + `Damageable`，以及一个 `Art` 子节点（带 `Sprite`）。
 * 数值全部读 `gameConfig.boss`（在 GameManager 的 Inspector 里调）。
 */
@ccclass('BossP1AI')
export class BossP1AI extends Component {

    @property({ displayName: '立绘节点名' })
    public artName = 'Art';

    /**
     * 立绘缩放，三身共用。
     *
     * ⚠️ 它乘的是**打包后**的帧尺寸（`manifest.canvas`），不是原始视频分辨率。
     * `pack_atlas.py` 的 `--scale` 一改，这里就得跟着成比例改：
     * 倍率 1.0 时帧是 768²、取 0.6 约合 460 世界单位高；
     * 倍率 0.5 时帧是 384²，同样的大小要填 **1.2**。
     */
    @property({ displayName: '立绘缩放', tooltip: '乘以打包后的帧尺寸；改动 pack_atlas 的 --scale 后要跟着调' })
    public artScale = 1;

    @property({ displayName: '动画名' })
    public idleAnimation = '九尾狐-幻影';

    @property({ displayName: '转场动画名' })
    public transitionAnimation = '九尾狐-幻影狂乱衔接';

    @property({ displayName: '转场节点路径', tooltip: '留空则自动找 Canvas/StageTransition' })
    public transitionPath = '';

    @property({ displayName: '开局自动分裂' })
    public autoStart = true;

    /**
     * 是否启用「幻影分身 + 灵雾识破」机制。
     *
     * 关掉时 Boss 就是**单个、原地不动、随时可打**的靶子 —— HP、阶段阈值、
     * 转场动画全都照常，只是没有分身和免伤。
     * 配合 `gameConfig.boss.cloneCount = 1` 使用（分身数 1 时本来就只有一个身位）。
     */
    @property({ displayName: '启用分身与识破' })
    public identifyEnabled = false;

    /**
     * P1 转场播完后是否直接跳结束页。
     *
     * 这是**临时的流程串通手段**：P2/P3 与设计里的「结局过场」（段落7）都还没做，
     * 打开它就能把「首页 → 关卡 → Boss P1 → 结束页」整条走一遍，用来验证链路。
     * **默认关掉** —— 打开时 Boss 战会显得「打完一阶段就通关」，容易误当成 bug。
     * P2 做出来后应当删掉这个开关。
     */
    @property({ displayName: 'P1 后跳结束页（临时）' })
    public goToEndingAfterP1 = false;

    /**
     * 临时自测：自动跑一遍 P1 交互循环并打日志。
     *
     * 为什么要它：模拟按键送不进编辑器的 Game View，而 `invoke_component_method`
     * 够到的是编辑态场景不是运行时，所以「切灵雾 → 识破 → 破防 → 转场」这条
     * 链路没法从外部驱动。让它自己跑一遍是目前唯一能验证的办法。
     * 正式验证完把这段和这个属性一起删掉。
     */
    @property({ displayName: '自测：自动跑一遍 P1' })
    public debugSelfTest = false;

    private testTimer = 0;
    private testStep = 0;
    /** 是否已经开打（begin / autoStart 只生效一次） */
    private started = false;

    private rigidBody: RigidBody2D | null = null;
    private damageable: Damageable | null = null;
    private target: Node | null = null;
    private targetCombat: CombatController | null = null;
    private targetForms: CompanionStateMachine | null = null;
    private transition: StageTransition | null = null;

    private phase: BossPhase = BossPhase.P1;
    private step: Step = Step.Split;
    private stepTimer = 0;

    /** 三个身位：槽位 0 是根节点（可能为真身，也可能是诱饵） */
    private slots: CloneSlot[] = [];
    /** 三个散布位置的 x（相对节点父级的本地坐标） */
    private spots: number[] = [];
    /** 本轮是否已被灵雾识破 */
    private revealed = false;
    private reshuffleLeft = 0;
    private spawnX = 0;

    protected onLoad(): void {
        this.rigidBody = this.getComponent(RigidBody2D);
        if (!this.rigidBody) {
            throw new Error('[BossP1AI] 同节点缺 RigidBody2D');
        }
        this.damageable = this.getComponent(Damageable);
        if (!this.damageable) {
            throw new Error('[BossP1AI] 同节点缺 Damageable');
        }
        // 刚体不允许休眠：休眠后 Box2D 不再评估接触，玩家会「打不中」
        // （项目在攻击命中盒上已经栽过一次，见 CLAUDE.md）
        this.rigidBody.allowSleep = false;
        this.rigidBody.wakeUp();

        // 归到 ENEMY 组：玩家砍得到它，但身体不会被它挡住
        // （见 core/PhysicsGroups.ts —— 命中盒那一组只和 ENEMY 碰）
        const bodyCol = this.getComponent(BoxCollider2D);
        if (bodyCol) {
            bodyCol.group = PhysicsGroups.ENEMY;
            bodyCol.apply();      // group 的 setter 只改 JS 字段，夹具要 apply() 才重建
        }

        this.spawnX = this.node.position.x;
        this.damageable.setMaxHp(gameConfig.boss.maxHp);
        this.damageable.onDeath = (): void => this.onBossDefeated();
        this.damageable.onDamaged = (_self: Damageable, info: DamageInfo): void => {
            log(`[Boss] 真身受击 ${info.amount.toFixed(1)}，剩余 ${this.damageable?.getHp().toFixed(0)}`);
        };

        this.resolveTarget();
        this.buildSlots();
        this.reshuffleLeft = gameConfig.boss.reshuffleInterval;

        if (this.autoStart) {
            this.begin();
        }
    }

    protected onDestroy(): void {
        if (this.damageable) {
            this.damageable.onDeath = null;
            this.damageable.onDamaged = null;
        }
        // 必须退订：否则打完 Boss 之后灵炁会永久停在战斗恢复档（1/s），玩家无从察觉
        spiritEnergySystem.setCombatSource(this, false);
    }

    /**
     * 开打。关卡流程里由 `LevelDirector` 在玩家踏进 Boss 战场时调用；
     * 场景没接流程时把 `autoStart` 打开即可。
     */
    public begin(): void {
        if (this.started) {
            return;
        }
        this.started = true;
        this.enterSplit();
    }

    public getPhase(): BossPhase {
        return this.phase;
    }

    /** 是否已开打。HUD 据此决定要不要显示（没进战场前不该有 Boss 血条）。 */
    public isEngaged(): boolean {
        return this.started;
    }

    /** 本轮是否已识破真身（HUD / 调试用） */
    public isRevealed(): boolean {
        return this.revealed;
    }

    /** 本组件的血量来源（BossHud 用） */
    public getDamageable(): Damageable | null {
        return this.damageable;
    }

    protected update(dt: number): void {
        // 没开打就整个不转。
        // ⚠️ 这一句不能省：`phase` 的默认值就是 P1，只判 phase 的话状态机会从
        // 第一帧就自己 Split→Idle→Reshuffle 转起来（`autoStart = false` 形同虚设），
        // 表现是玩家还没进战场，Boss 已经在那儿换位置了。
        if (!this.started) {
            return;
        }
        if (this.phase !== BossPhase.P1) {
            return;
        }
        if (!this.damageable || this.damageable.isDead()) {
            return;
        }

        // 阶段阈值：Damageable 不发血量变化事件，只能每帧比对（EnemyAI 也是这个做法）
        if (this.damageable.getHpRatio() <= gameConfig.boss.phase2HpRatio) {
            this.enterTransition();
            return;
        }

        this.stepTimer -= dt;
        this.syncClones();
        this.updateReveal();
        if (this.debugSelfTest) {
            this.runSelfTest(dt);
        }

        switch (this.step) {
            case Step.Split:
                if (this.stepTimer <= 0) {
                    this.enterIdle();
                }
                break;
            case Step.Idle:
                this.reshuffleLeft -= dt;
                if (this.reshuffleLeft <= 0) {
                    this.enterReshuffle();
                }
                break;
            case Step.Reshuffle:
                if (this.stepTimer <= 0) {
                    this.enterIdle();
                }
                break;
            default:
                break;
        }
    }

    // ================= 状态 =================

    private enterSplit(): void {
        this.step = Step.Split;
        this.stepTimer = 0.6;
        this.phase = BossPhase.P1;
        spiritEnergySystem.setCombatSource(this, true);
        for (const s of this.slots) {
            s.node.active = true;      // 分身登场（见 buildSlots 里为什么先藏）
        }

        this.scatterPositions();
        this.applyRoles(this.pickRealSlot());
        this.dealSplitDamage();
        log(`[Boss] P1 起手：分裂出 ${this.slots.length} 身`);
    }

    private enterIdle(): void {
        this.step = Step.Idle;
        this.reshuffleLeft = gameConfig.boss.reshuffleInterval;
    }

    private enterReshuffle(): void {
        this.step = Step.Reshuffle;
        this.stepTimer = 0.35;

        // 重排：位置重洗 + 真身换人 + 识破作废（设计文档「分身切换后重新识破」）
        this.scatterPositions();
        this.applyRoles(this.pickRealSlot());
        this.setRevealed(false);
        log('[Boss] 分身重排，真身转移');
    }

    private enterTransition(): void {
        this.phase = BossPhase.Transition;
        spiritEnergySystem.setCombatSource(this, false);
        this.setRevealed(true);            // 转场时让假身别继续染黑
        log('[Boss] HP 降至阈值，播放转场');

        const trans = this.resolveTransition();
        if (!trans) {
            warn('[Boss] 找不到 StageTransition，跳过转场直接停在占位态');
            this.phase = BossPhase.Stopped;
            return;
        }
        trans.play(this.transitionAnimation, {
            onComplete: () => {
                this.phase = BossPhase.Stopped;
                if (this.goToEndingAfterP1) {
                    log('[Boss] P1 转场结束 —— 按设置跳结束页（P2 未实现，这是临时串流程）');
                    sceneManager.loadScene(ENDING_SCENE);
                } else {
                    log('[Boss] P1 转场结束，停在占位态（P2 未实现）');
                }
            },
        });
    }

    private onBossDefeated(): void {
        this.phase = BossPhase.Stopped;
        spiritEnergySystem.setCombatSource(this, false);
        log('[Boss] 被击败');
    }

    /** 自测脚本：分步走一遍 P1，每步打日志（见 debugSelfTest 的说明） */
    private runSelfTest(dt: number): void {
        this.testTimer += dt;
        const say = (m: string): void => log(`[Boss自测] ${m}`);
        const hpNow = `${this.damageable?.getHp().toFixed(0)}/${this.damageable?.getMaxHp().toFixed(0)}`;

        switch (this.testStep) {
            case 0:
                if (this.testTimer < 1.5) {
                    return;
                }
                say(`① 起手：HP ${hpNow}  免伤=${this.damageable?.invulnerable}  `
                    + `识破=${this.revealed}（免伤应为 true、识破应为 false）`);
                say('② 把玩家切到灵雾形态');
                this.targetForms?.trySwitchTo(CompanionForm.Mist);
                this.testStep = 1;
                this.testTimer = 0;
                break;
            case 1:
                if (this.testTimer < 1.5) {
                    return;
                }
                say(`③ 灵雾靠近后：识破=${this.revealed}  免伤=${this.damageable?.invulnerable}`
                    + '（应双双翻转）');
                say('④ 对真身打 400（应跨过 70% 阈值触发转场）');
                this.damageable?.takeDamage({
                    amount: 400, knockback: new Vec2(0, 0),
                    sourceForm: CompanionForm.Entity,
                });
                this.testStep = 2;
                this.testTimer = 0;
                break;
            case 2:
                if (this.testTimer < 1.0) {
                    return;
                }
                say(`⑤ 伤害后：HP ${hpNow}  阶段=${this.phase}（应为 transition）`);
                this.testStep = 3;
                this.testTimer = 0;
                break;
            case 3:
                if (this.testTimer < 9) {
                    return;
                }
                say(`⑥ 转场播完：阶段=${this.phase}（应为 stopped）`);
                this.testStep = 4;
                break;
            default:
                break;
        }
    }

    /** 诱饵跟着真身的帧号走，三身必须长得一模一样 */
    private syncClones(): void {
        const root = this.slots[0];
        if (!root || !root.player.isPlaying) {
            return;
        }
        const i = root.player.frameIndex;
        for (let k = 1; k < this.slots.length; k += 1) {
            const p = this.slots[k].player;
            if (p.isPlaying && p.frameIndex !== i) {
                p.setFrame(i);
            }
        }
    }

    // ================= 识破 =================

    /**
     * 灵雾形态下靠近任一身位 → 整组识破。
     *
     * 用「靠近任一个就全组识破」而不是「逐个识破」：设计文档写的是
     * 「飞向 3 个分身观察 → 标记真身位置」，靠近之后玩家就能分辨出真身，
     * 逐个计数反而要多跑两趟、没有额外信息量。
     */
    private updateReveal(): void {
        if (!this.identifyEnabled || this.revealed || !this.target) {
            return;
        }
        if (!this.targetForms || this.targetForms.getCurrentForm() !== CompanionForm.Mist) {
            return;
        }
        const radius = gameConfig.boss.identifyRadius;
        const px = this.target.worldPosition.x;
        const py = this.target.worldPosition.y;
        for (const s of this.slots) {
            const dx = s.node.worldPosition.x - px;
            const dy = s.node.worldPosition.y - py;
            if (dx * dx + dy * dy <= radius * radius) {
                this.setRevealed(true);
                log('[Boss] 灵雾识破真身');
                return;
            }
        }
    }

    private setRevealed(on: boolean): void {
        this.revealed = on;
        // 未识破前一律免伤：「未识破前青禾的攻击无效」。
        // 关掉识破机制时**永远不免伤** —— 否则 Boss 会变成打不动的摆设。
        const invuln = this.identifyEnabled ? !on : false;
        if (this.damageable) {
            this.damageable.invulnerable = invuln;
        }
        if (!this.identifyEnabled) {
            for (const s of this.slots) {
                this.tintSlot(s, Color.WHITE);       // 不做真假区分，全部原色
            }
            return;
        }
        for (const s of this.slots) {
            const clone = s.node.getComponent(BossClone);
            if (clone) {
                clone.identified = on;
            }
            const tint = !on ? Color.WHITE : (s.isReal ? TINT_REAL : TINT_FAKE);
            this.tintSlot(s, tint);
        }
    }

    private tintSlot(slot: CloneSlot, color: Color): void {
        const art = slot.node.getChildByName(this.artName);
        const sp = art ? art.getComponent(Sprite) : null;
        if (sp) {
            sp.color = color;
        }
    }

    // ================= 分裂 =================

    /** 三个身位建好并挂上动画；槽位 0 复用根节点本身 */
    private buildSlots(): void {
        const rootArt = this.node.getChildByName(this.artName);
        if (!rootArt) {
            warn(`[Boss] 根节点下没有 "${this.artName}" 子节点，立绘不会显示`);
        }
        this.slots = [this.makeSlot(this.node, 0)];

        const count = Math.max(1, gameConfig.boss.cloneCount);
        // 幂等：编辑器可能把上次 onLoad 建出来的诱饵存进了场景，先清掉再建
        const parent = this.node.parent;
        if (parent) {
            for (const c of parent.children.slice()) {
                if (c !== this.node && c.name.startsWith(`${this.node.name}_分身`)) {
                    c.destroy();
                }
            }
        }

        for (let i = 1; i < count; i += 1) {
            const n = new Node(`${this.node.name}_分身${i}`);
            n.layer = this.node.layer;
            n.parent = this.node.parent;
            // 先藏起来：分身的位置要等 enterSplit 里的 scatterPositions 才定，
            // 在那之前它们会堆在 (0,0)，也就是屏幕左边缘露出一只狐狸（踩过）
            n.active = false;
            n.addComponent(BossClone);
            const art = new Node(this.artName);
            art.layer = this.node.layer;
            n.addChild(art);
            art.addComponent(UITransform).setContentSize(1, 1);
            const sp = art.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.type = Sprite.Type.SIMPLE;
            this.slots.push(this.makeSlot(n, i));
        }

        this.spots = this.makeSpots(this.slots.length);
        for (const s of this.slots) {
            s.player.play(this.idleAnimation, { loop: true });
        }
    }

    private makeSlot(node: Node, posIndex: number): CloneSlot {
        const art = node.getChildByName(this.artName) ?? node;
        let pl = art.getComponent(SequencePlayer);
        if (!pl) {
            pl = art.addComponent(SequencePlayer);
        }
        // 三身同时播，窗口收紧要省显存：只留当前页
        pl.aheadPages = 0;
        pl.behindPages = 0;
        art.setScale(this.artScale, this.artScale, 1);
        return { node, player: pl, posIndex, isReal: false };
    }

    /** 三个位置的本地 x：以出生点为中心左右展开 */
    private makeSpots(count: number): number[] {
        const spread = gameConfig.boss.cloneSpread;
        if (count <= 1) {
            return [this.spawnX];
        }
        const out: number[] = [];
        for (let i = 0; i < count; i += 1) {
            // 均匀铺在 [-spread, +spread]
            const t = i / (count - 1);
            out.push(this.spawnX + (t * 2 - 1) * spread);
        }
        return out;
    }

    private scatterPositions(): void {
        const order = this.spots.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        this.slots.forEach((s, i) => {
            s.posIndex = order[i % order.length];
            const x = this.spots[s.posIndex];
            s.node.setPosition(x, s.node.position.y, 0);
        });
    }

    /** 随机挑一个身位当真的（可能与上一次相同，那也没关系） */
    private pickRealSlot(): number {
        return Math.floor(Math.random() * this.slots.length);
    }

    private applyRoles(realIndex: number): void {
        this.slots.forEach((s, i) => {
            s.isReal = i === realIndex;
            const clone = s.node.getComponent(BossClone);
            if (clone) {
                clone.isReal = s.isReal;
            }
        });
        this.setRevealed(false);
        log(`[Boss] 真身移到位置 ${this.slots[realIndex]?.posIndex ?? -1}`);
    }

    // ================= 战斗结算 =================

    /**
     * 分裂瞬间的范围伤害 —— P1 唯一的伤害源。
     * 走 `receivePlayerDamage` 而不是直接扣灵炁，这样格挡/完美格挡语义自动生效。
     */
    private dealSplitDamage(): void {
        if (!this.target) {
            return;
        }
        const radius = gameConfig.boss.splitDamageRadius;
        const dx = this.target.worldPosition.x - this.node.worldPosition.x;
        const dy = this.target.worldPosition.y - this.node.worldPosition.y;
        if (dx * dx + dy * dy > radius * radius) {
            return;
        }

        const amount = gameConfig.boss.splitDamage;
        const result: PlayerDamageResult = this.targetCombat
            ? this.targetCombat.receivePlayerDamage(amount)
            : { spiritCost: amount, perfectBlocked: false };

        if (result.perfectBlocked) {
            log('[Boss] 分裂伤害被完美格挡');
            return;
        }
        if (result.spiritCost > 0) {
            spiritEnergySystem.damage(result.spiritCost);
        }
        log(`[Boss] 分裂命中玩家，扣灵炁 ${result.spiritCost.toFixed(1)}`);
    }

    // ================= 工具 =================

    private resolveTarget(): void {
        const scene = director.getScene();
        this.target = scene ? scene.getChildByPath('Canvas/Qinghe') : null;
        if (!this.target) {
            warn('[Boss] 找不到 Canvas/Qinghe，识破与分裂伤害都不会生效');
            return;
        }
        this.targetCombat = this.target.getComponent(CombatController);
        this.targetForms = this.target.getComponent(CompanionStateMachine);
    }

    private resolveTransition(): StageTransition | null {
        if (this.transition && this.transition.isValid) {
            return this.transition;
        }
        const scene = director.getScene();
        const path = this.transitionPath || 'Canvas/StageTransition';
        const n = scene ? scene.getChildByPath(path) : null;
        this.transition = n ? n.getComponent(StageTransition) : null;
        return this.transition;
    }
}
