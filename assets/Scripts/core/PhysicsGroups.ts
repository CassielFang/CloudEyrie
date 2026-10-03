import { PhysicsSystem2D } from 'cc';

/**
 * 2D 物理分组与碰撞矩阵。
 *
 * 为什么需要它
 * ------------
 * 玩家和小怪都是 **Dynamic 刚体 + 实心碰撞体**，默认同组（`DEFAULT = 1`），
 * 于是它们**物理上互相阻挡**：小怪追击时会把玩家顶开，玩家走进小怪则被卡住
 * （实测反馈「人物被小怪挤跑」「像黏在一起、跳不起来」）。
 *
 * 常规做法是把敌人碰撞体做成 sensor（彼此穿过不阻挡），但**本作不行**：
 * `CombatController` 的 `AttackHitBox` 本身就是 sensor，而 Box2D **不产生
 * 传感器与传感器之间的接触** —— 敌人也变 sensor 的话，玩家就再也打不到它了。
 *
 * 所以改用碰撞矩阵，把「谁挡谁」和「谁能打谁」拆开：
 *
 * | 分组 | 与谁碰撞 |
 * |---|---|
 * | `WORLD`  | 所有（地面、机关、屏障…） |
 * | `PLAYER` | 只有 WORLD —— **不挡小怪、也不被小怪挡** |
 * | `ENEMY`  | WORLD + HITBOX —— 玩家身体穿得过去，但刀能砍到 |
 * | `HITBOX` | 只有 ENEMY —— 命中盒不参与任何阻挡 |
 *
 * ⚠️ 新建**敌人的**碰撞体时记得 `col.group = PhysicsGroups.ENEMY`，
 * 否则上面的 `HITBOX` 那一行会把它排除掉、玩家砍不动它。
 */
export const PhysicsGroups = {
    WORLD: 1 << 0,
    PLAYER: 1 << 1,
    ENEMY: 1 << 2,
    HITBOX: 1 << 3,
    /** 敌人的抛射物（箭）。sensor，只和 PLAYER 碰 */
    ARROW: 1 << 4,
} as const;

/** 本作的分组名，写进碰撞矩阵后 inspector 里也认得出 */
export const PHYSICS_GROUP_NAMES: Array<{ name: string; index: number }> = [
    { name: 'WORLD', index: 0 },
    { name: 'PLAYER', index: 1 },
    { name: 'ENEMY', index: 2 },
    { name: 'HITBOX', index: 3 },
];

let applied = false;

/**
 * 把上表写进运行时碰撞矩阵。幂等，重复调用无副作用。
 *
 * `PhysicsSystem2D.collisionMatrix` 按**位值**索引（不是组序号），
 * 见 engine `physics-2d/box2d/shapes/shape-2d.ts` 的 `maskBits` 取值。
 */
export function applyPhysicsGroups(): void {
    if (applied) {
        return;
    }
    applied = true;
    const m = PhysicsSystem2D.instance.collisionMatrix as unknown as Record<number, number>;
    m[PhysicsGroups.WORLD] = PhysicsGroups.WORLD | PhysicsGroups.PLAYER
        | PhysicsGroups.ENEMY | PhysicsGroups.HITBOX | PhysicsGroups.ARROW;
    // 玩家身体与地面、以及敌人的箭「碰撞」。
    // ⚠️ 这一位**不能省**：Box2D 的过滤要**两个方向都通过**才算接触，
    // 只写 `m[ARROW] = PLAYER` 的话箭永远碰不到玩家。
    // 而箭是 **sensor**，所以即使这一位在着也不会产生物理推力、不会推玩家。
    m[PhysicsGroups.PLAYER] = PhysicsGroups.WORLD | PhysicsGroups.ARROW;
    m[PhysicsGroups.ENEMY] = PhysicsGroups.WORLD | PhysicsGroups.HITBOX;
    m[PhysicsGroups.HITBOX] = PhysicsGroups.ENEMY;
    m[PhysicsGroups.ARROW] = PhysicsGroups.PLAYER;
}
