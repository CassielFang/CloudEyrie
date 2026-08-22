import { _decorator, Component, director, log } from 'cc';
const { ccclass, property } = _decorator;

import { eventBus } from './EventBus';

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
            log('[GameManager] Received:', data);
        });
        eventBus.emit('test-event', { message: 'Hello Yunxiu!' });

        eventBus.emit('game-initialized');
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


