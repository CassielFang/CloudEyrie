import { _decorator, Component, Node, director, log } from 'cc';
const { ccclass, property } = _decorator;

import { ParallaxBackground } from './ParallaxBackground';

/**
 * 横版相机跟随。
 *
 * 本作原本没有相机运动——所有节点都在 Canvas 下由一台固定相机渲染。
 * 这里直接**移动 Canvas 里的 Camera 节点**：UI 节点是 UI 坐标系里的，
 * 相机移过去就等于视角平移，物理世界坐标不受影响（这点很关键，
 * 换成「移动世界根节点」的写法会和玩家刚体打架）。
 *
 * 代价：HUD 也会跟着跑掉，所以屏幕固定的东西要挂 `ScreenFixed` 反向补偿。
 */
@ccclass('CameraFollow')
export class CameraFollow extends Component {

    @property({ displayName: '目标节点路径' })
    public targetPath = 'Canvas/Qinghe';

    @property({ displayName: '背景节点路径', tooltip: '视差层挂在别的节点上，这样它才能排在最底层' })
    public backgroundPath = 'Canvas/Background';

    @property({ displayName: '跟随速度', tooltip: '0 = 硬跟（瞬时对齐）' })
    public smooth = 6;

    @property({ displayName: '关卡左端' })
    public levelLeft = 0;

    @property({ displayName: '关卡右端' })
    public levelRight = 2600;

    @property({ displayName: '锁定', tooltip: 'Boss 战场等固定场地用；锁住后相机不再跟随' })
    public locked = false;

    private target: Node | null = null;
    private cam: Node | null = null;
    private viewW = 1280;
    private bg: ParallaxBackground | null = null;

    /** 相机当前的 x（Canvas 本地坐标）。视差层与 ScreenFixed 都读它 */
    public cameraX = 0;

    protected onLoad(): void {
        const scene = director.getScene();
        this.target = scene ? scene.getChildByPath(this.targetPath) : null;
        this.cam = scene ? scene.getChildByPath('Canvas/Camera') : null;
        const bgNode = scene ? scene.getChildByPath(this.backgroundPath) : null;
        this.bg = bgNode ? bgNode.getComponent(ParallaxBackground) : null;
        if (!this.target || !this.cam) {
            log('[CameraFollow] 找不到目标或相机，跟随不生效');
            return;
        }
        // 背景层的宽度由相机行程反推，必须在建层前（setRange 会触发重建布局）给到
        if (this.bg) {
            const half = this.viewW / 2;
            this.bg.setRange(this.levelLeft + half, this.levelRight - half, this.viewW);
        }
        this.cameraX = this.clampX(this.target.position.x);
        this.sync(0);
    }

    /** 锁定相机到当前位置（进入 Boss 战场时调） */
    public lock(): void {
        this.locked = true;
    }

    public unlock(): void {
        this.locked = false;
    }

    /** 重设关卡两端（关卡长度由 LevelDirector 决定）。会连带重算背景层的宽度。 */
    public setBounds(left: number, right: number): void {
        this.levelLeft = left;
        this.levelRight = right;
        const half = this.viewW / 2;
        this.bg?.setRange(left + half, right - half, this.viewW);
        this.cameraX = this.clampX(this.cameraX);
        this.sync(0);
    }

    protected update(dt: number): void {
        if (this.locked || !this.target) {
            return;
        }
        const want = this.clampX(this.target.position.x);
        if (this.smooth <= 0) {
            this.cameraX = want;
        } else {
            // 指数趋近，帧率无关
            const k = 1 - Math.exp(-this.smooth * dt);
            this.cameraX += (want - this.cameraX) * k;
        }
        this.sync(dt);
    }

    private sync(_dt: number): void {
        if (this.cam) {
            this.cam.setPosition(this.cameraX, 0, 0);
        }
        if (this.bg) {
            this.bg.setCameraX(this.cameraX);
        }
    }

    private clampX(x: number): number {
        const half = this.viewW / 2;
        const lo = this.levelLeft + half;
        const hi = this.levelRight - half;
        if (hi <= lo) {
            return (this.levelLeft + this.levelRight) / 2;
        }
        return Math.max(lo, Math.min(hi, x));
    }
}
