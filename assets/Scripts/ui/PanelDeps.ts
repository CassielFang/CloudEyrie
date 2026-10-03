import { Color, Label, Node } from 'cc';

/**
 * 子面板内容类需要的两个「舞台」能力。
 *
 * 面板内容（`TitleSubPanels` / `SettingsPanel` / 以后的成就页）都是**普通工具类**，
 * 拿不到 `ScreenStage` 的 `protected` 方法，只能由 `TitleScreen` 在构造时把这两个
 * 函数注入进来。
 *
 * 为什么单独一个文件：`TitleSubPanels` 要用它、`SettingsPanel` 也要用它 ——
 * 定义放在其中任意一个文件里，都会让这两个文件互相 import 成环。
 */
export interface PanelDeps {
    /** 建一个居中文本，复用首页那套字体与描边设置 */
    makeLabel(parent: Node, name: string, text: string, size: number,
        color: Color, outline?: number): Label;
    /** 克隆场景里的模板节点（面板贴图不在 resources/ 下，只能这样拿） */
    clone(templateName: string, name: string, parent: Node): Node | null;
}
