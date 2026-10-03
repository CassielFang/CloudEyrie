import { _decorator, Component, director } from 'cc';
const { ccclass, property } = _decorator;

import { CameraFollow } from './CameraFollow';

/**
 * 把节点钉在屏幕上，不随相机滚动。
 *
 * 相机是直接移动 `Canvas/Camera` 实现的（见 `CameraFollow`），所以 Canvas 下
 * 的一切都会被推走 —— HUD、全屏转场叠层这些必须反向补偿。
 * 补偿量就是相机的位移，所以每帧把自己的 x 设成 `cameraX + 基准x`。
 *
 * 正式做法是给 UI 单开一层 + 第二台相机；这里是灰盒期的省事做法。
 */
@ccclass('ScreenFixed')
export class ScreenFixed extends Component {

    @property({ displayName: '挂着 CameraFollow 的节点路径' })
    public cameraPath = 'Canvas/Level';

    /** 不含相机位移时的本来位置 */
    private baseX = 0;

    protected onLoad(): void {
        this.baseX = this.node.position.x;
    }

    protected update(): void {
        const scene = director.getScene();
        const holder = scene ? scene.getChildByPath(this.cameraPath) : null;
        const follow = holder ? holder.getComponent(CameraFollow) : null;
        if (!follow) {
            return;
        }
        this.node.setPosition(follow.cameraX + this.baseX, this.node.position.y, 0);
    }
}
