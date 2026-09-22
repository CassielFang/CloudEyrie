import { _decorator, Component, director, log } from 'cc';
const { ccclass } = _decorator;

import { eventBus } from './EventBus';
import { spiritEnergySystem } from './SpiritEnergySystem';

@ccclass('GameManager')
export class GameManager extends Component {

    private static instance: GameManager | null = null;

    public static getInstance(): GameManager {
        if (!GameManager.instance) {
            throw new Error('[GameManager] GameManager has not been initialized.');
        }
        return GameManager.instance;
    }

    /** 灵炁冒烟测试开关。需要排查灵炁系统时手动置 true */
    private static readonly DEBUG_SPIRIT_SELFTEST = false;

    private initialize(): void {
        log('[GameManager] Initializing Yunxiu...');
        eventBus.emit('game-initialized');

        // 灵炁当前值看左上角的调试 HUD（DebugHud）。
        // 这里**不要**挂 spirit-energy-changed 监听打日志 —— 灵炁是逐帧变化的，
        // 一挂就会把控制台刷满，把战斗日志全淹掉。
        spiritEnergySystem.resetToInitial();

        if (GameManager.DEBUG_SPIRIT_SELFTEST) {
            this.runSpiritSelfTest();
        }
    }

    /** 冒烟测试：验证消耗 / 非战斗恢复 / 战斗恢复 / 灵泉恢复四档数值 */
    private runSpiritSelfTest(): void {
        const s = spiritEnergySystem;
        s.resetToInitial();
        log('[SpiritEnergy][自测] 初始 -> ', s.getCurrent());
        s.consume(30);
        log('[SpiritEnergy][自测] 消耗30 -> ', s.getCurrent());
        s.setInCombat(false);
        s.update(2);
        log('[SpiritEnergy][自测] 非战斗恢复2秒(+10) -> ', s.getCurrent());
        s.setInCombat(true);
        s.update(2);
        log('[SpiritEnergy][自测] 战斗恢复2秒(+2) -> ', s.getCurrent());
        s.setInSpring(true);
        s.update(1);
        log('[SpiritEnergy][自测] 灵泉恢复1秒(+30) -> ', s.getCurrent());
        s.setInCombat(false);
        s.setInSpring(false);
        s.resetToInitial();
        log('[SpiritEnergy][自测] 结束，复位 -> ', s.getCurrent());
    }

    protected onLoad(): void {
        // 防止重复创建
        if (GameManager.instance !== null) {
            this.destroy()
            return;
        }

        GameManager.instance = this;

        // 跨场景保存
        director.addPersistRootNode(this.node);

        this.initialize();
    }

    protected onDestroy(): void {
        if (GameManager.instance === this) {
            GameManager.instance = null;
        }
    }

    protected update(dt: number): void {
        // 全局灵炁自然恢复 / 灵泉恢复（每帧）
        spiritEnergySystem.update(dt);
    }

}


