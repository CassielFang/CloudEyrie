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
    mergeBurstCost: number;         // 灵合范围攻击
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

// ============================================================
// 运行时配置单例 —— 所有系统从这里读取数值
// 默认值即 v1 参数表；GameConfig 组件 onLoad 时用 Inspector
// 里的可调值覆盖它，因此系统需惰性读取（getter），不要缓存。
// ============================================================

export const gameConfig: { spirit: SpiritConfig; tide: TideConfig } = {
    spirit: createDefaultSpiritConfig(),
    tide: createDefaultTideConfig(),
};

// ============================================================
// 可调组件 —— 挂到常驻 GameManager 节点，参数即可在 Inspector 中调整
// ============================================================

@ccclass('GameConfig')
export class GameConfig extends Component {

    // ---- 灵炁池 ----
    @property({ group: '灵炁池', displayName: '上限' })
    private spiritMax = 100;
    @property({ group: '灵炁池', displayName: '初始值' })
    private spiritInitial = 80;
    @property({ group: '灵炁池', displayName: '非战斗恢复/秒' })
    private regenOutOfCombat = 5;
    @property({ group: '灵炁池', displayName: '战斗恢复/秒' })
    private regenInCombat = 1;
    @property({ group: '灵炁池', displayName: '灵泉恢复/秒' })
    private springRestoreRate = 30;
    @property({ group: '灵炁池', displayName: '灵泉恢复上限比率' })
    private springRestoreCapRatio = 1;

    // ---- 形态切换 ----
    @property({ group: '形态切换', displayName: '实体→灵雾' })
    private switchEntityToMist = 10;
    @property({ group: '形态切换', displayName: '灵雾→实体' })
    private switchMistToEntity = 5;
    @property({ group: '形态切换', displayName: '灵雾→灵合' })
    private switchMistToMerge = 30;
    @property({ group: '形态切换', displayName: '进入灵合最低灵炁' })
    private mergeMinSpirit = 50;
    @property({ group: '形态切换', displayName: '灵合→实体' })
    private switchMergeToEntity = 15;
    @property({ group: '形态切换', displayName: '灵合→灵雾' })
    private switchMergeToMist = 10;
    @property({ group: '形态切换', displayName: '强制切灵雾阈值' })
    private forcedMistThreshold = 10;
    @property({ group: '形态切换', displayName: '切换硬直/秒' })
    private switchLockDuration = 0.5;

    // ---- 战斗消耗 ----
    @property({ group: '战斗消耗', displayName: '轻击' })
    private lightAttackCost = 8;
    @property({ group: '战斗消耗', displayName: '重击' })
    private heavyAttackCost = 15;
    @property({ group: '战斗消耗', displayName: '踏云闪' })
    private cloudDashCost = 12;
    @property({ group: '战斗消耗', displayName: '灵雾普攻/发' })
    private mistShotCost = 5;
    @property({ group: '战斗消耗', displayName: '灵合净化/秒' })
    private mergePurifyCostPerSec = 20;
    @property({ group: '战斗消耗', displayName: '灵合范围攻击' })
    private mergeBurstCost = 30;
    @property({ group: '战斗消耗', displayName: '格挡' })
    private blockCost = 10;

    // ---- 灵雾持续消耗 ----
    @property({ group: '灵雾消耗', displayName: '基础/秒' })
    private mistBaseDrain = 3;
    @property({ group: '灵雾消耗', displayName: '飞行额外/秒' })
    private mistFlyDrainExtra = 2;
    @property({ group: '灵雾消耗', displayName: '穿越障碍/次' })
    private mistPassObstacleCost = 20;

    // ---- 敌人伤害 ----
    @property({ group: '敌人伤害', displayName: '阳浊普攻' })
    private enemyYangMeleeDamage = 15;
    @property({ group: '敌人伤害', displayName: '阴浊远程' })
    private enemyYinRangedDamage = 10;
    @property({ group: '敌人伤害', displayName: 'BOSS普攻' })
    private bossMeleeDamage = 20;
    @property({ group: '敌人伤害', displayName: 'BOSS技能' })
    private bossSkillDamage = 35;
    @property({ group: '敌人伤害', displayName: '浊湮接触/秒' })
    private corruptionContactDrain = 5;

    // ---- 灵合冷却与休眠 ----
    @property({ group: '灵合', displayName: '冷却/秒' })
    private mergeCooldown = 20;
    @property({ group: '灵合', displayName: '结束后休眠/秒' })
    private mergeSleepDuration = 10;

    // ---- 灵脉潮汐 ----
    @property({ group: '灵脉潮汐', displayName: '周期/秒' })
    private tidePeriod = 120;
    @property({ group: '灵脉潮汐', displayName: '高潮恢复倍率' })
    private highTideRegenMult = 2.0;
    @property({ group: '灵脉潮汐', displayName: '高潮敌人活性倍率' })
    private highTideEnemyActivityMult = 1.2;
    @property({ group: '灵脉潮汐', displayName: '低潮恢复倍率' })
    private lowTideRegenMult = 0.5;

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

        eventBus.emit('game-config-ready', gameConfig);
    }

}
