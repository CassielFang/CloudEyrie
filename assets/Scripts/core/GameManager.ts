import { _decorator, Component, director, log } from 'cc';
const { ccclass } = _decorator;

import { eventBus } from './EventBus';
import { spiritEnergySystem, SpiritEnergyChangedEvent } from './SpiritEnergySystem';

@ccclass('GameManager')
export class GameManager extends Component {

    private static instance: GameManager | null = null;

    public static getInstance(): GameManager {
        if (!GameManager.instance) {
            throw new Error('[GameManager] GameManager has not been initialized.');
        }
        return GameManager.instance;
    }

    private initialize(): void {
        log('[GameManager] Initializing Yunxiu...');
        eventBus.emit('game-initialized');

        // 自测 SpiritEnergySystem（v1 参数）
        eventBus.on<SpiritEnergyChangedEvent>('spirit-energy-changed', (data) => {
            log('[SpiritEnergy] changed: ', data);
        });

        spiritEnergySystem.resetToInitial();
        log('[SpiritEnergy] 初始 80/100 -> ', spiritEnergySystem.getCurrent());

        spiritEnergySystem.consume(30);
        log('[SpiritEnergy] 消耗30 -> ', spiritEnergySystem.getCurrent());

        spiritEnergySystem.setInCombat(false);
        spiritEnergySystem.update(2);
        log('[SpiritEnergy] 非战斗恢复2秒(+10) -> ', spiritEnergySystem.getCurrent());

        spiritEnergySystem.setInCombat(true);
        spiritEnergySystem.update(2);
        log('[SpiritEnergy] 战斗恢复2秒(+2) -> ', spiritEnergySystem.getCurrent());

        spiritEnergySystem.setInSpring(true);
        spiritEnergySystem.update(1);
        log('[SpiritEnergy] 灵泉恢复1秒(+30) -> ', spiritEnergySystem.getCurrent());

        // 复位，避免自测污染游戏状态
        spiritEnergySystem.setInCombat(false);
        spiritEnergySystem.setInSpring(false);
        spiritEnergySystem.resetToInitial();
        log('[SpiritEnergy] 自测结束，复位 -> ', spiritEnergySystem.getCurrent());
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


