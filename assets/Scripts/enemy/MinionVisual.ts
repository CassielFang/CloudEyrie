import { _decorator, Component, RigidBody2D, Sprite, warn } from 'cc';
const { ccclass, property } = _decorator;

import { gameConfig } from '../core/GameConfig';
import { SequencePlayer } from '../fx/SequencePlayer';
import { EnemyAI, EnemyState } from './EnemyAI';

/**
 * 阳浊小怪的表现层：按 AI 状态切序列帧动画。
 *
 * 美术组给的是**逐帧动画**（视频转的），不是骨骼，所以「走路」「攻击」是两段
 * 独立的序列，得由状态驱动着切：
 *
 *   Patrol / Discover / Chase / Attack 前的移动  → 小怪-行走（循环）
 *   Attack                                       → 小怪-攻击（一次性，播完回走路）
 *   Dead                                         → 停播（死亡表现交给 EnemyAI 的缩放淡出）
 *
 * 挂在**小怪节点**上（和 `EnemyAI`、`Damageable` 同节点），
 * `Art` 子节点会被自动接上 `SequencePlayer`。
 *
 * 注意朝向：`EnemyAI` 已经在翻转 `Art` 节点（`FacingFlip`），这里只管播哪一段，
 * **不要再自己翻一次**，否则会翻回去。
 */
@ccclass('MinionVisual')
export class MinionVisual extends Component {

    @property({ displayName: '立绘节点名' })
    public artName = 'Art';

    @property({ displayName: '行走动画' })
    public walkAnimation = '小怪-行走';

    @property({ displayName: '攻击动画' })
    public attackAnimation = '小怪-攻击';

    @property({ displayName: '立绘缩放', tooltip: '乘以打包后的帧尺寸；改动 pack_atlas 的 --scale 后要跟着调' })
    public artScale = 1;

    /**
     * 走路动画的播放倍速。默认原速。
     *
     * 曾试过压到 0.5 去迁就巡逻速度，但那样步子显得拖沓 —— 反馈是「又有点慢了」。
     * 改成「动画保持原速、把移动速度提上去」来对节奏（`gameConfig.enemy` 的
     * 巡逻/追击速度已 ×1.2）。
     */
    @property({ displayName: '走路倍速', tooltip: '1 = 原速；和巡逻速度搭配着调' })
    public walkTimeScale = 1;

    /**
     * 攻击动画的播放区间与倍速。
     *
     * 美术给的是 97 帧 / 4.04 秒的**完整表演**，逐帧分析（帧间差）得到：
     *
     *   f2~ 5  起步
     *   f6~42  抬弓 + 拉弓
     *   f43~54 拉满后微调
     *   f55~61 满弓保持（静止）
     *   f62~69 【放箭】
     *   f70~96 箭飞 + 收势
     *
     * **整段从头播、不剪**（`from = 2`）—— 之前只从 f42「已拉满」起播，
     * 结果是走路姿势**直接跳到满弓**，硬切很明显（实测反馈「动画切换还是有问题」）。
     * 保留抬弓那一段，衔接才自然。
     *
     * 但 4 秒太慢，所以用 `TIME_SCALE = 2.5` 把它压到约 **1.5 秒**：
     * 抬弓 ≈0.65s（可读的前摇）→ 撒手 → 收势。
     */
    public static readonly ATTACK_FROM = 2;
    public static readonly ATTACK_TO = 90;
    /** 撒手那一帧：箭在此时生成，和动画严格同步 */
    public static readonly RELEASE_FRAME = 62;

    /**
     * 张弓搭箭的倍速**从配置读**（`gameConfig.enemy.rangedAttackTimeScale`），
     * 这样在 GameManager 的 Inspector 里就能调，不必改代码重编译。
     * 惰性读取、不缓存 —— `GameConfig.onLoad` 的覆盖晚于模块初始化。
     */
    private get attackTimeScale(): number {
        return gameConfig.enemy.rangedAttackTimeScale;
    }

    /**
     * 判定「算不算在移动」的速度阈值（米/秒，刚体单位）。
     * 巡逻速度是 1.44，站住时理论上为 0，留一点余量盖住数值抖动。
     */
    private static readonly MOVE_EPS = 0.05;

    private ai: EnemyAI | null = null;
    private player: SequencePlayer | null = null;
    private rb: RigidBody2D | null = null;
    private lastState: EnemyState | null = null;
    private attacking = false;
    /** 本次攻击是否已经放过箭（防止同一段动画里重复触发） */
    private released = false;

    protected onLoad(): void {
        this.ai = this.getComponent(EnemyAI);
        this.rb = this.getComponent(RigidBody2D);
        if (!this.ai) {
            warn('[MinionVisual] 同节点没有 EnemyAI，动画不会随状态切换');
        }
        const art = this.node.getChildByName(this.artName);
        if (!art) {
            warn(`[MinionVisual] 找不到 "${this.artName}" 子节点`);
            return;
        }
        art.setScale(this.artScale, this.artScale, 1);
        let pl = art.getComponent(SequencePlayer);
        if (!pl) {
            pl = art.addComponent(SequencePlayer);
        }
        // 小怪同屏可能好几只，各留 1 页就够
        pl.aheadPages = 0;
        pl.behindPages = 0;
        this.player = pl;
        this.playWalk();
    }

    private playWalk(): void {
        this.attacking = false;
        this.player?.play(this.walkAnimation, {
            loop: true,
            timeScale: this.walkTimeScale,
        });
    }

    /**
     * 站着不动时把走路动画**冻住**，要动了再继续。
     *
     * 判据取**刚体速度**而不是 AI 状态 —— 巡逻里有一段「到点停留」（`patrolPause`）、
     * 攻击冷却时也会站着，这些都属同一状态但人没动。
     * 按状态切的话那些时候会原地踏步（实测反馈「没移动的时候就静止」）。
     */
    private syncWalkPlayback(): void {
        const pl = this.player;
        if (!pl || this.attacking) {
            return;                       // 攻击中由攻击动画自己管
        }
        const moving = this.rb
            ? Math.abs(this.rb.linearVelocity.x) > MinionVisual.MOVE_EPS
            : true;
        if (moving && !pl.isPlaying) {
            pl.resume();
        } else if (!moving && pl.isPlaying) {
            pl.pause();
        }
    }

    private playAttack(): void {
        this.attacking = true;
        this.released = false;
        this.player?.play(this.attackAnimation, {
            loop: false,
            from: MinionVisual.ATTACK_FROM,
            to: MinionVisual.ATTACK_TO,
            timeScale: this.attackTimeScale,
            onComplete: () => {
                // 播完回走路；若这期间已死则让死亡逻辑接手
                if (this.ai?.getState() !== EnemyState.Dead) {
                    this.playWalk();
                }
            },
        });
    }

    protected update(): void {
        const ai = this.ai;
        if (!ai || !this.player) {
            return;
        }
        // 到了撒手那一帧才放箭，动画和抛射物严格同步
        if (this.attacking && !this.released
            && this.player.frameIndex >= MinionVisual.RELEASE_FRAME) {
            this.released = true;
            ai.releaseArrow();
        }
        this.syncWalkPlayback();

        const s = ai.getState();
        if (s === this.lastState) {
            return;
        }
        this.lastState = s;

        if (s === EnemyState.Attack) {
            this.playAttack();
        } else if (s === EnemyState.Dead) {
            this.player.stop();
        } else if (!this.attacking) {
            // 巡逻 / 发现 / 追击 都走走路循环
            this.playWalk();
        }
    }
}
