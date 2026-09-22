import { Node } from 'cc';

/** 素材的天然朝向：1 = 这张图本身画的是朝右；-1 = 画的是朝左 */
export type NaturalFacing = 1 | -1;

/**
 * 按角色朝向水平翻转节点（正数朝右、负数朝左）。
 *
 * **务必传对 `naturalFacing`** —— 它表示素材本身画的是朝哪边，而不是角色朝向。
 * 传错的后果是"攻击跑到背后"：判定盒和特效都在按角色朝向摆位，
 * 立绘却停在反方向，看起来就是在往身后打。
 *
 * 美术目前只提供单侧朝向的素材，左右靠镜像表示 —— **这是临时方案**，
 * 正式美术（双向立绘 / 骨骼动画）接入后整个文件可以删掉。
 *
 * 用 `Math.abs(s.x) * sign` 而不是直接赋 ±1，有两个原因：
 *   1. 保留美术可能在 Inspector 里预设的缩放倍数；
 *   2. 幂等 —— 同一个朝向重复调用不会把自己翻回去。
 */
export function applyFacingFlip(node: Node | null, facing: number, naturalFacing: NaturalFacing): void {
    if (!node) {
        return;
    }
    // 素材朝向与角色朝向同侧 -> 不翻；异侧 -> 翻
    const sameSide = (facing >= 0) === (naturalFacing >= 0);
    const want = Math.abs(node.scale.x) * (sameSide ? 1 : -1);
    const s = node.scale;
    if (s.x !== want) {
        node.setScale(want, s.y, s.z);
    }
}
