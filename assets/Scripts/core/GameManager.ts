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
        log('[GameManager] EventBus ready.');

        // 测试 EventBus
        eventBus.on('test-event', (data) => {
            log('[GameManager] Received: ', data);
        });
        eventBus.emit('test-event', { message: 'Hello Yunxiu!' });

        eventBus.emit('game-initialized');

        // 测试 SpiritEnergySystem
        eventBus.on<SpiritEnergyChangedEvent>('spirit-energy-changed', (data) => {
            log('[SpiritEnergy] Received: ', data);
        });
        log('[SpiritEnergy] ', spiritEnergySystem.getCurrent(), '/', spiritEnergySystem.getMax());
        spiritEnergySystem.consume(15);
        log('[SpiritEnergy] after consume 15: ', spiritEnergySystem.getCurrent());
        spiritEnergySystem.restore(50);
        log('[SpiritEnergy] after restore 50: ', spiritEnergySystem.getCurrent());
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

}


