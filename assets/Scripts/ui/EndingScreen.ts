import {
    _decorator, Node, Sprite, UITransform, UIOpacity, game,
} from 'cc';
const { ccclass } = _decorator;

import { COLOR_GLOW, COLOR_SUB, COLOR_TITLE, ScreenStage } from './ScreenStage';

/**
 * 结束页（`assets/Scene/Ending.scene` 的唯一组件）。
 *
 * 首页的「退出」不是直接掐进程，而是切到这一页再退 —— 切场景会把首页和关卡的
 * 资源、正在跑的 AI 与物理全部卸干净，`game.end()` 落在一个空场景里执行，
 * 不会在游戏逻辑还在跑的时候把进程掐掉。
 *
 * 背景、暗角、光点、字体这些和首页一样，都由基类 `ScreenStage` 提供。
 *
 * ⚠️ 这里**只调 `game.end()`，不做任何平台判断，也不再响应任何输入**。
 * 别再往这里加 `window.close()` 之类的"网页端补偿"：真实浏览器里它只对
 * 脚本打开的标签页有效（加了也是白加），而编辑器预览的 Game View 是 Electron
 * `<webview>`，`close()` 会把预览视图真的销毁、编辑器预览卡死只能强制重启。
 * 实测踩过两次，`cc/env` 的 `PREVIEW` 常量也挡不住（预览 target 里它是 false）。
 */

@ccclass('EndingScreen')
export class EndingScreen extends ScreenStage {

    private time = 0;
    private contentRoot: Node | null = null;
    private contentOpacity: UIOpacity | null = null;
    private wispLayer: Node | null = null;
    private glowOpacity: UIOpacity | null = null;

    protected onLoad(): void {
        this.setupStage();
        this.wispLayer = this.makeNode('WispLayer', this.node);
        this.buildContent();
        this.buildWisps(this.wispLayer);
        this.loadFont();

        // game.end();
    }

    // ============================================================ 搭建

    private buildContent(): void {
        const root = this.makeNode('ContentRoot', this.node);
        this.contentRoot = root;
        this.contentOpacity = root.addComponent(UIOpacity);
        this.contentOpacity.opacity = 0;

        // 标题背后的柔光，和首页同一套做法
        const glow = this.cloneTemplate('WispTemplate', 'EndingGlow', root);
        if (glow) {
            glow.active = true;
            this.fit(glow, 900, 420);
            glow.setPosition(0, 76, 0);
            const sp = glow.getComponent(Sprite);
            if (sp) { sp.color = COLOR_GLOW; }
            this.glowOpacity = glow.addComponent(UIOpacity);
            this.glowOpacity.opacity = 140;
        }

        const title = this.makeNode('Title', root);
        this.makeLabel('TitleText', title, '感 谢 游 玩', 92, COLOR_TITLE, 0);
        title.setPosition(0, 76, 0);

        const rule = this.makeNode('Rule', root);
        rule.addComponent(UITransform);
        this.drawRule(rule, 170);
        rule.setPosition(0, -6, 0);

        const sub = this.makeNode('SubTitle', root);
        this.makeLabel('SubText', sub, 'C L O U D   E Y R I E', 24, COLOR_SUB, 2);
        sub.setPosition(0, -52, 0);

        const hint = this.makeNode('Hint', root);
        this.makeLabel('HintText', hint, '可 以 直 接 关 闭', 22, COLOR_SUB, 2);
        hint.setPosition(0, -170, 0);

        this.layout();
    }

    // ============================================================ 每帧

    protected update(dt: number): void {
        this.time += dt;
        this.layout();
        this.updateBackdrop(this.time);
        this.updateWisps(dt, this.time);

        if (this.ready && this.contentOpacity && this.contentOpacity.opacity < 255) {
            this.contentOpacity.opacity = Math.min(255,
                this.contentOpacity.opacity + dt * 150);
        }
        if (this.glowOpacity) {
            this.glowOpacity.opacity = 120 + Math.round(50 * (0.5 + 0.5 * Math.sin(this.time * 1.1)));
        }
    }

    private layout(): void {
        this.layoutStage(this.contentRoot);
    }
}
