import { _decorator, Component } from 'cc';
const { ccclass } = _decorator;

/**
 * 九尾狐 P1 的「分身」标记。
 *
 * 三身里**只有一个是真身**，且真身永远是挂了 `BossP1AI` 的那个根节点；
 * 另外两身是 `BossP1AI` 程序化建出来的诱饵（只有立绘，没有碰撞体、没有血量）。
 *
 * 单独做成组件而不是塞进父组件的私有数组，是为了在编辑器的层级面板里
 * 一眼能看出哪个是诱饵，调位置/染色时不必去翻代码。
 */
@ccclass('BossClone')
export class BossClone extends Component {

    /** 是否真身（由 BossP1AI 每次重排时重设） */
    public isReal = false;

    /** 本轮是否已被灵雾识破 */
    public identified = false;
}
