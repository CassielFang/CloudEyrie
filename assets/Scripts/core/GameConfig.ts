import { _decorator, Component } from 'cc';
const { ccclass, property } = _decorator;

import { eventBus } from './EventBus';

// ============================================================
// 配置结构定义（与 week1 v1 参数表一一对应）
// ============================================================

export interface SpiritConfig {
    // 灵炁池基础
    max: number;                    // 灵炁池上限
    initial: number;                // 灵炁初始值（游戏开始）
    regenOutOfCombat: number;       // 非战斗恢复速率 /秒
    regenInCombat: number;          // 战斗恢复速率 /秒
    springRestoreRate: number;      // 灵泉恢复速率 /秒
    springRestoreCapRatio: number;  // 灵泉恢复上限比率（1 = 100%）

    // 形态切换
    switchEntityToMist: number;     // 实体 → 灵雾
    switchMistToEntity: number;     // 灵雾 → 实体
    switchMistToMerge: number;      // 灵雾 → 灵合
    mergeMinSpirit: number;         // 进入灵合的最低灵炁
    switchMergeToEntity: number;    // 灵合 → 实体
    switchMergeToMist: number;      // 灵合 → 灵雾
    forcedMistThreshold: number;    // 灵炁低于此值强制切灵雾
    switchLockDuration: number;     // 形态切换硬直 /秒

    // 战斗消耗
    lightAttackCost: number;        // 轻击（每次）
    heavyAttackCost: number;        // 重击（蓄力斩）
    cloudDashCost: number;          // 踏云闪
    mistShotCost: number;           // 灵雾普攻 /发
    mergePurifyCostPerSec: number;  // 灵合净化 /秒
    mergeBurstCost: number;
    // ---- 灵合形态的输出（以前只有消耗、没有伤害）----
    mergePurifyDamagePerSec: number;  // 净化光环：范围内每秒对目标造成的伤害
    mergePurifyRadius: number;        // 净化光环半径
    mergeBurstDamage: number;         // 灵炁爆发：单次 AOE 伤害
    mergeBurstRadius: number;         // 灵炁爆发半径         // 灵合范围攻击
    blockCost: number;              // 格挡（完美格挡不扣）

    // 灵雾形态持续消耗
    mistBaseDrain: number;          // 灵雾基础消耗 /秒
    mistFlyDrainExtra: number;      // 高速飞行额外消耗 /秒
    mistPassObstacleCost: number;   // 穿越灵界屏障 /次

    // 敌人伤害（扣灵炁）
    enemyYangMeleeDamage: number;   // 阳浊型·普攻
    enemyYinRangedDamage: number;   // 阴浊型·远程
    bossMeleeDamage: number;        // BOSS·普攻
    bossSkillDamage: number;        // BOSS·特殊技能
    corruptionContactDrain: number; // 浊湮接触伤害 /秒

    // 灵合冷却与休眠（沿用老 GDD，v1 未写）
    mergeCooldown: number;
    mergeSleepDuration: number;
}

export interface TideConfig {
    period: number;                     // 灵脉潮汐周期 /秒
    highTideRegenMult: number;          // 高潮恢复倍率
    highTideEnemyActivityMult: number;  // 高潮敌人活性倍率
    lowTideRegenMult: number;           // 低潮恢复倍率
}

export interface CombatConfig {
    baseLightDamage: number;        // 轻击基础伤害（倍率作用于它）
    comboDamageMult: number[];      // 三段伤害倍率 [1, 1.2, 1.5]（不暴露 Inspector）
    comboKnockback: number;         // 第三段击退距离 /米
    comboWindow: number;            // 连击窗口 /秒
    lightTapThreshold: number;      // 点按判定阈值（<此值=轻击，否则蓄力）
    heavyChargeTime: number;        // 满蓄时长 /秒
    heavyFullDamageMult: number;    // 满蓄伤害倍率
    heavyHalfDamageMult: number;    // 半蓄伤害倍率
    heavyKnockback: number;         // 重击击退距离 /米
    blockReduction: number;         // 格挡减伤比例（0.7 = 70%）
    perfectBlockWindow: number;     // 完美格挡窗口 /秒
    mistShotDamageRatio: number;    // 灵弹伤害比例（相对轻击）
    mistShotKnockback: number;      // 灵弹击退（作为水平速度直接施加，比近战小得多）
    mistShotSpeed: number;          // 灵弹飞行速度
    mistShotLifetime: number;       // 灵弹存活 /秒
}

export interface EnemyConfig {
    patrolSpeed: number;        // 巡逻速度 (物理单位/秒)
    chaseSpeed: number;         // 追击速度 (物理单位/秒)
    sightRange: number;         // 发现玩家距离 (像素，与节点坐标同尺度)
    attackRange: number;        // 攻击判定距离 (像素)
    verticalTolerance: number;  // 垂直容差 (像素)：|Δy| 超过它就算「不在同一层」，既不发现也不攻击
    attackCooldown: number;     // 攻击间隔 /秒
    attackStartup: number;      // 攻击前摇 /秒
    attackDuration: number;     // 攻击总时长 /秒
    hitStunDuration: number;    // 受击硬直 /秒（硬直期间不写状态机速度，只跑击退曲线）
    patrolRange: number;        // 巡逻往返范围（相对出生点，像素）
    patrolPause: number;        // 巡逻点停留 /秒
    discoverDuration: number;   // 发现反应时间 /秒
    deathDuration: number;      // 死亡表现时长 /秒
    // ---- 远程型（持弓的阳浊小怪）----
    rangedAttackRange: number;  // 远程攻击距离（比近战大得多，弓箭本来就该离远打）
    rangedAttackDuration: number; // 远程攻击总时长，要**和攻击动画对齐**（见 MinionVisual 的帧区间）
    rangedAttackTimeScale: number; // 张弓搭箭的播放倍速（越大越快）；会反过来改变实际时长
    arrowDamage: number;        // 箭的伤害（扣灵炁）
    arrowSpeed: number;         // 箭的飞行速度（像素/秒）
}

/**
 * 九尾狐 Boss 数值。
 *
 * ⚠️ 别和 BOSS 面板里的 `bossMeleeDamage` / `bossSkillDamage` 搞混 ——
 * 那两个其实是 `SpiritConfig` 的字段（「Boss 打玩家扣多少灵炁」），
 * 不是 Boss 自身属性，而且目前全项目无人消费。
 *
 * 取值依据 `docs/关于boss战的一些修改.md`（比 17 天计划新，冲突时以它为准）：
 * 总血 1000，P1 300 点 → 70% 处转场。
 */
export interface BossConfig {
    maxHp: number;              // Boss 总血量
    phase2HpRatio: number;      // 进入 P2 的血量比（P1 掉到这个比例就转场）
    phase3HpRatio: number;      // 进入 P3 的血量比
    cloneCount: number;         // P1 分身数量（1 真 N-1 假）
    cloneSpread: number;        // 分身散布的半宽（像素）
    splitDamage: number;        // 分裂瞬间对玩家的伤害
    splitDamageRadius: number;  // 分裂伤害的作用半径（像素）
    reshuffleInterval: number;  // 分身重排间隔 /秒
    identifyRadius: number;     // 灵雾靠近多远算「识破」（像素）
}

function createDefaultSpiritConfig(): SpiritConfig {
    return {
        max: 100,
        initial: 80,
        regenOutOfCombat: 5,
        regenInCombat: 1,
        springRestoreRate: 30,
        springRestoreCapRatio: 1,

        switchEntityToMist: 10,
        switchMistToEntity: 5,
        switchMistToMerge: 30,
        mergeMinSpirit: 50,
        switchMergeToEntity: 15,
        switchMergeToMist: 10,
        forcedMistThreshold: 10,
        switchLockDuration: 0.5,

        lightAttackCost: 8,
        heavyAttackCost: 15,
        cloudDashCost: 12,
        mistShotCost: 5,
        mergePurifyCostPerSec: 20,
        mergeBurstCost: 30,
        mergePurifyDamagePerSec: 30,
        mergePurifyRadius: 220,
        mergeBurstDamage: 50,
        mergeBurstRadius: 340,
        blockCost: 10,

        mistBaseDrain: 3,
        mistFlyDrainExtra: 2,
        mistPassObstacleCost: 20,

        enemyYangMeleeDamage: 15,
        enemyYinRangedDamage: 10,
        bossMeleeDamage: 20,
        bossSkillDamage: 35,
        corruptionContactDrain: 5,

        mergeCooldown: 20,
        mergeSleepDuration: 10,
    };
}

function createDefaultTideConfig(): TideConfig {
    return {
        period: 120,
        highTideRegenMult: 2.0,
        highTideEnemyActivityMult: 1.2,
        lowTideRegenMult: 0.5,
    };
}

function createDefaultEnemyConfig(): EnemyConfig {
    return {
        patrolSpeed: 1.44,
        chaseSpeed: 3.84,
        sightRange: 140,
        attackRange: 72,
        verticalTolerance: 70,
        attackCooldown: 2.16,
        attackStartup: 0.3,
        attackDuration: 0.55,
        hitStunDuration: 0.3,
        patrolRange: 140,
        patrolPause: 0.8,
        discoverDuration: 0.45,
        deathDuration: 0.5,
        rangedAttackRange: 460,
        rangedAttackDuration: 1.5,
        rangedAttackTimeScale: 2.0,
        arrowDamage: 15,
        arrowSpeed: 900,
    };
}

function createDefaultBossConfig(): BossConfig {
    return {
        maxHp: 1000,
        phase2HpRatio: 0.70,
        phase3HpRatio: 0.35,
        cloneCount: 1,   // 1 = 不分裂（幻影机制未启用）
        cloneSpread: 260,
        splitDamage: 25,
        splitDamageRadius: 220,
        reshuffleInterval: 10,
        identifyRadius: 260,
    };
}

function createDefaultCombatConfig(): CombatConfig {
    return {
        baseLightDamage: 15,
        comboDamageMult: [1.0, 1.2, 1.5],
        comboKnockback: 1.5,
        comboWindow: 0.3,
        lightTapThreshold: 0.2,
        heavyChargeTime: 1.0,
        heavyFullDamageMult: 2.5,
        heavyHalfDamageMult: 1.5,
        heavyKnockback: 3.0,
        blockReduction: 0.7,
        perfectBlockWindow: 0.2,
        mistShotDamageRatio: 0.6,
        mistShotKnockback: 0.15,
        mistShotSpeed: 10,
        mistShotLifetime: 2.0,
    };
}

// ============================================================
// 运行时配置单例 —— 所有系统从这里读取数值
// 默认值即 v1 参数表；GameConfig 组件 onLoad 时用 Inspector
// 里的可调值覆盖它，因此系统需惰性读取（getter），不要缓存。
// ============================================================

export const gameConfig: {
    spirit: SpiritConfig; tide: TideConfig; combat: CombatConfig;
    enemy: EnemyConfig; boss: BossConfig;
} = {
    spirit: createDefaultSpiritConfig(),
    tide: createDefaultTideConfig(),
    combat: createDefaultCombatConfig(),
    enemy: createDefaultEnemyConfig(),
    boss: createDefaultBossConfig(),
};

// ============================================================
// 可调组件 —— 挂到常驻 GameManager 节点，参数即可在 Inspector 中调整
//
// 分组约定（别再"顺手统一"成接口的顺序）：
//   - **面板**按「调什么的时候一起看」分组（青禾·战斗、小怪…），
//     所以同一组里可能混着来自 SpiritConfig / CombatConfig 不同接口的字段
//     —— 比如「青禾·战斗」里轻击的灵炁花费在 SpiritConfig、基础伤害在 CombatConfig。
//   - **接口**按「哪个系统读它」划分，onLoad 里的赋值块逐项镜像接口顺序。
//   两者是刻意不同的两个视角，改分组只动 group / displayName，**不要动字段名**：
//   序列化按字段名走，改名会让 main.scene 里已存的值静默失效、回落到默认值。
//
// 组数刻意压在 8 个以内：Inspector 里每个分组标题都要占一行，面板高度有限，
// 组一多就会把后面的属性挤出可视区（真出过，16 组时后面几组够不着）。
// 所以**用组内顺序表达子概念**：「小怪」里 移动4 → 感知3 → 攻击6 → 受击与死亡2
// 依次排下来，而不是再拆成四个组。
// ============================================================

@ccclass('GameConfig')
export class GameConfig extends Component {

    // ---- 灵炁 ----
    @property({ group: '灵炁', displayName: '上限' })
    private spiritMax = 100;
    @property({ group: '灵炁', displayName: '初始值' })
    private spiritInitial = 80;
    @property({ group: '灵炁', displayName: '非战斗恢复/秒' })
    private regenOutOfCombat = 5;
    @property({ group: '灵炁', displayName: '战斗恢复/秒' })
    private regenInCombat = 1;
    @property({ group: '灵炁', displayName: '灵泉恢复/秒' })
    private springRestoreRate = 30;
    @property({ group: '灵炁', displayName: '灵泉恢复上限比率' })
    private springRestoreCapRatio = 1;

    // ---- 灵脉潮汐 ----
    @property({ group: '灵脉潮汐', displayName: '周期/秒' })
    private tidePeriod = 120;
    @property({ group: '灵脉潮汐', displayName: '高潮恢复倍率' })
    private highTideRegenMult = 2.0;
    @property({ group: '灵脉潮汐', displayName: '低潮恢复倍率' })
    private lowTideRegenMult = 0.5;
    @property({ group: '灵脉潮汐', displayName: '高潮敌人活性倍率' })
    private highTideEnemyActivityMult = 1.2;

    // ---- 形态 ----
    @property({ group: '形态', displayName: '切换硬直/秒' })
    private switchLockDuration = 0.5;
    @property({ group: '形态', displayName: '强制切灵雾阈值' })
    private forcedMistThreshold = 10;
    @property({ group: '形态', displayName: '实体→灵雾' })
    private switchEntityToMist = 10;
    @property({ group: '形态', displayName: '灵雾→实体' })
    private switchMistToEntity = 5;
    @property({ group: '形态', displayName: '灵雾基础消耗/秒' })
    private mistBaseDrain = 3;
    @property({ group: '形态', displayName: '灵雾飞行额外/秒' })
    private mistFlyDrainExtra = 2;
    @property({ group: '形态', displayName: '灵雾穿越障碍/次' })
    private mistPassObstacleCost = 20;
    @property({ group: '形态', displayName: '灵雾→灵合' })
    private switchMistToMerge = 30;
    @property({ group: '形态', displayName: '进入灵合最低灵炁' })
    private mergeMinSpirit = 50;
    @property({ group: '形态', displayName: '灵合→实体' })
    private switchMergeToEntity = 15;
    @property({ group: '形态', displayName: '灵合→灵雾' })
    private switchMergeToMist = 10;
    @property({ group: '形态', displayName: '灵合净化/秒' })
    private mergePurifyCostPerSec = 20;
    @property({ group: '形态', displayName: '灵合净化伤害/秒' })
    private mergePurifyDamagePerSec = 30;
    @property({ group: '形态', displayName: '灵合净化半径' })
    private mergePurifyRadius = 220;
    @property({ group: '形态', displayName: '灵合爆发伤害' })
    private mergeBurstDamage = 50;
    @property({ group: '形态', displayName: '灵合爆发半径' })
    private mergeBurstRadius = 340;
    @property({ group: '形态', displayName: '灵合范围攻击' })
    private mergeBurstCost = 30;
    @property({ group: '形态', displayName: '灵合冷却/秒' })
    private mergeCooldown = 20;
    @property({ group: '形态', displayName: '灵合结束后休眠/秒' })
    private mergeSleepDuration = 10;

    // ---- 青禾·战斗 ----
    @property({ group: '青禾·战斗', displayName: '轻击灵炁花费' })
    private lightAttackCost = 8;
    @property({ group: '青禾·战斗', displayName: '轻击基础伤害' })
    private baseLightDamage = 15;
    @property({ group: '青禾·战斗', displayName: '轻击第三段击退' })
    private comboKnockback = 1.5;
    @property({ group: '青禾·战斗', displayName: '轻击连击窗口/秒' })
    private comboWindow = 0.3;
    @property({ group: '青禾·战斗', displayName: '重击灵炁花费' })
    private heavyAttackCost = 15;
    @property({ group: '青禾·战斗', displayName: '重击点按阈值/秒' })
    private lightTapThreshold = 0.2;
    @property({ group: '青禾·战斗', displayName: '重击满蓄时长/秒' })
    private heavyChargeTime = 1.0;
    @property({ group: '青禾·战斗', displayName: '重击满蓄倍率' })
    private heavyFullDamageMult = 2.5;
    @property({ group: '青禾·战斗', displayName: '重击半蓄倍率' })
    private heavyHalfDamageMult = 1.5;
    @property({ group: '青禾·战斗', displayName: '重击击退' })
    private heavyKnockback = 3.0;
    @property({ group: '青禾·战斗', displayName: '格挡灵炁花费' })
    private blockCost = 10;
    @property({ group: '青禾·战斗', displayName: '格挡减伤比例' })
    private blockReduction = 0.7;
    @property({ group: '青禾·战斗', displayName: '完美格挡窗口/秒' })
    private perfectBlockWindow = 0.2;
    @property({ group: '青禾·战斗', displayName: '踏云闪灵炁花费' })
    private cloudDashCost = 12;

    // ---- 灵雾·灵弹 ----
    @property({ group: '灵雾·灵弹', displayName: '灵炁花费/发' })
    private mistShotCost = 5;
    @property({ group: '灵雾·灵弹', displayName: '伤害比例（相对轻击）' })
    private mistShotDamageRatio = 0.6;
    @property({ group: '灵雾·灵弹', displayName: '击退' })
    private mistShotKnockback = 0.15;
    @property({ group: '灵雾·灵弹', displayName: '速度' })
    private mistShotSpeed = 10;
    @property({ group: '灵雾·灵弹', displayName: '存活/秒' })
    private mistShotLifetime = 2.0;

    // ---- 小怪 ----
    @property({ group: '小怪', displayName: '巡逻速度' })
    private enemyPatrolSpeed = 1.44;
    @property({ group: '小怪', displayName: '追击速度' })
    private enemyChaseSpeed = 3.84;
    @property({ group: '小怪', displayName: '巡逻范围' })
    private enemyPatrolRange = 140;
    @property({ group: '小怪', displayName: '巡逻点停留/秒' })
    private enemyPatrolPause = 0.8;
    @property({ group: '小怪', displayName: '发现距离' })
    private enemySightRange = 140;
    @property({ group: '小怪', displayName: '垂直容差（像素）' })
    private enemyVerticalTolerance = 70;
    @property({ group: '小怪', displayName: '发现反应/秒' })
    private enemyDiscoverDuration = 0.45;
    @property({ group: '小怪', displayName: '攻击距离' })
    private enemyAttackRange = 72;
    @property({ group: '小怪', displayName: '攻击前摇/秒' })
    private enemyAttackStartup = 0.3;
    @property({ group: '小怪', displayName: '攻击总时长/秒' })
    private enemyAttackDuration = 0.55;
    @property({ group: '小怪', displayName: '攻击间隔/秒' })
    private enemyAttackCooldown = 2.16;
    @property({ group: '小怪', displayName: '对玩家伤害（阳浊普攻）' })
    private enemyYangMeleeDamage = 15;
    @property({ group: '小怪', displayName: '对玩家伤害（阴浊远程）' })
    private enemyYinRangedDamage = 10;
    @property({ group: '小怪', displayName: '受击硬直/秒' })
    private enemyHitStunDuration = 0.3;
    @property({ group: '小怪', displayName: '死亡表现/秒' })
    private enemyDeathDuration = 0.5;
    @property({ group: '小怪', displayName: '远程攻击距离' })
    private enemyRangedAttackRange = 460;
    @property({ group: '小怪', displayName: '张弓搭箭倍速', tooltip: '越大越快；改了它实际时长也跟着变' })
    private enemyRangedAttackTimeScale = 2.0;
    @property({ group: '小怪', displayName: '远程攻击时长/秒', tooltip: '要和攻击动画的帧区间对齐' })
    private enemyRangedAttackDuration = 1.5;
    @property({ group: '小怪', displayName: '箭伤害' })
    private enemyArrowDamage = 15;
    @property({ group: '小怪', displayName: '箭速度' })
    private enemyArrowSpeed = 900;

    // ---- BOSS ----
    // 注意：上面这两个不是 Boss 自身数值，是「Boss 打玩家扣多少灵炁」，
    // 归属 SpiritConfig。九尾狐自己的数值在下面。
    @property({ group: 'BOSS', displayName: '普攻' })
    private bossMeleeDamage = 20;
    @property({ group: 'BOSS', displayName: '技能' })
    private bossSkillDamage = 35;
    @property({ group: 'BOSS', displayName: '· 九尾狐 总血量' })
    private bossMaxHp = 1000;
    @property({ group: 'BOSS', displayName: '· 转 P2 血量比' })
    private bossPhase2HpRatio = 0.70;
    @property({ group: 'BOSS', displayName: '· 转 P3 血量比' })
    private bossPhase3HpRatio = 0.35;
    @property({ group: 'BOSS', displayName: '· 分身数量' })
    private bossCloneCount = 1;
    @property({ group: 'BOSS', displayName: '· 分身散布半宽' })
    private bossCloneSpread = 260;
    @property({ group: 'BOSS', displayName: '· 分裂伤害' })
    private bossSplitDamage = 25;
    @property({ group: 'BOSS', displayName: '· 分裂伤害半径' })
    private bossSplitDamageRadius = 220;
    @property({ group: 'BOSS', displayName: '· 分身重排间隔/秒' })
    private bossReshuffleInterval = 10;
    @property({ group: 'BOSS', displayName: '· 灵雾识破半径' })
    private bossIdentifyRadius = 260;

    // ---- 环境伤害 ----
    @property({ group: '环境伤害', displayName: '浊湮接触/秒' })
    private corruptionContactDrain = 5;

    protected onLoad(): void {
        gameConfig.spirit = {
            max: this.spiritMax,
            initial: this.spiritInitial,
            regenOutOfCombat: this.regenOutOfCombat,
            regenInCombat: this.regenInCombat,
            springRestoreRate: this.springRestoreRate,
            springRestoreCapRatio: this.springRestoreCapRatio,

            switchEntityToMist: this.switchEntityToMist,
            switchMistToEntity: this.switchMistToEntity,
            switchMistToMerge: this.switchMistToMerge,
            mergeMinSpirit: this.mergeMinSpirit,
            switchMergeToEntity: this.switchMergeToEntity,
            switchMergeToMist: this.switchMergeToMist,
            forcedMistThreshold: this.forcedMistThreshold,
            switchLockDuration: this.switchLockDuration,

            lightAttackCost: this.lightAttackCost,
            heavyAttackCost: this.heavyAttackCost,
            cloudDashCost: this.cloudDashCost,
            mistShotCost: this.mistShotCost,
            mergePurifyCostPerSec: this.mergePurifyCostPerSec,
            mergeBurstCost: this.mergeBurstCost,
            mergePurifyDamagePerSec: this.mergePurifyDamagePerSec,
            mergePurifyRadius: this.mergePurifyRadius,
            mergeBurstDamage: this.mergeBurstDamage,
            mergeBurstRadius: this.mergeBurstRadius,
            blockCost: this.blockCost,

            mistBaseDrain: this.mistBaseDrain,
            mistFlyDrainExtra: this.mistFlyDrainExtra,
            mistPassObstacleCost: this.mistPassObstacleCost,

            enemyYangMeleeDamage: this.enemyYangMeleeDamage,
            enemyYinRangedDamage: this.enemyYinRangedDamage,
            bossMeleeDamage: this.bossMeleeDamage,
            bossSkillDamage: this.bossSkillDamage,
            corruptionContactDrain: this.corruptionContactDrain,

            mergeCooldown: this.mergeCooldown,
            mergeSleepDuration: this.mergeSleepDuration,
        };

        gameConfig.tide = {
            period: this.tidePeriod,
            highTideRegenMult: this.highTideRegenMult,
            highTideEnemyActivityMult: this.highTideEnemyActivityMult,
            lowTideRegenMult: this.lowTideRegenMult,
        };

        gameConfig.combat = {
            baseLightDamage: this.baseLightDamage,
            // 三段倍率不暴露 Inspector，沿用默认 [1, 1.2, 1.5]
            comboDamageMult: [1.0, 1.2, 1.5],
            comboKnockback: this.comboKnockback,
            comboWindow: this.comboWindow,
            lightTapThreshold: this.lightTapThreshold,
            heavyChargeTime: this.heavyChargeTime,
            heavyFullDamageMult: this.heavyFullDamageMult,
            heavyHalfDamageMult: this.heavyHalfDamageMult,
            heavyKnockback: this.heavyKnockback,
            blockReduction: this.blockReduction,
            perfectBlockWindow: this.perfectBlockWindow,
            mistShotDamageRatio: this.mistShotDamageRatio,
            mistShotKnockback: this.mistShotKnockback,
            mistShotSpeed: this.mistShotSpeed,
            mistShotLifetime: this.mistShotLifetime,
        };

        gameConfig.enemy = {
            patrolSpeed: this.enemyPatrolSpeed,
            chaseSpeed: this.enemyChaseSpeed,
            sightRange: this.enemySightRange,
            attackRange: this.enemyAttackRange,
            verticalTolerance: this.enemyVerticalTolerance,
            attackCooldown: this.enemyAttackCooldown,
            attackStartup: this.enemyAttackStartup,
            attackDuration: this.enemyAttackDuration,
            hitStunDuration: this.enemyHitStunDuration,
            patrolRange: this.enemyPatrolRange,
            patrolPause: this.enemyPatrolPause,
            discoverDuration: this.enemyDiscoverDuration,
            deathDuration: this.enemyDeathDuration,
            rangedAttackRange: this.enemyRangedAttackRange,
            rangedAttackDuration: this.enemyRangedAttackDuration,
            rangedAttackTimeScale: this.enemyRangedAttackTimeScale,
            arrowDamage: this.enemyArrowDamage,
            arrowSpeed: this.enemyArrowSpeed,
        };

        gameConfig.boss = {
            maxHp: this.bossMaxHp,
            phase2HpRatio: this.bossPhase2HpRatio,
            phase3HpRatio: this.bossPhase3HpRatio,
            cloneCount: this.bossCloneCount,
            cloneSpread: this.bossCloneSpread,
            splitDamage: this.bossSplitDamage,
            splitDamageRadius: this.bossSplitDamageRadius,
            reshuffleInterval: this.bossReshuffleInterval,
            identifyRadius: this.bossIdentifyRadius,
        };

        eventBus.emit('game-config-ready', gameConfig);
    }

}
