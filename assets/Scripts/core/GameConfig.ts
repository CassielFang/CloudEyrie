export const GameConfig = {

    spirit: {

        max: 100, // 灵炁上限

        idleRegenPerSecond: 0.3, // 自然恢复

        damageCost: 15, // 受击

        springRestore: 50, // 灵泉

        physicalDrainPerSecond: 0.5, // 实体

        mistDrainPerSecond: 2.0, // 灵雾消耗

        mergeCost: 30, // 灵合消耗

        mergeDuration: 8.0, // 灵合持续

        mergeCooldown: 20.0, // 灵合冷却

        mergeSleepDuration: 10.0, // 灵合休眠

        mistForcedReturnThreshold: 10, // 强制灵雾下限
    }

} as const;
