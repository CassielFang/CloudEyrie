# 推荐 Git 提交规范

> commit message = subject + ':' + space + content
> ```bash
> git commit -m "commit message"
> ```

- **feat** 新功能（feature）
- **fix** 修复 bug
- **docs** 文档变更
- **style** 代码风格变动（不影响代码逻辑）
- **refactor** 代码重构（既不是新增功能也不是修复 bug）
- **perf** 性能优化
- **test** 添加或修改测试文件
- **chore** 杂项（辅助工具等的变动）
- **build** 构建系统或外部依赖的变更
- **revert** 回滚

# Git 提交流程

1. 可以最开始时 pull 一次最新代码

```bash
git pull --rebase origin main
```

2. 本地开发，多次 comment

```bash
git add .
git commit -m "feat: 添加了A功能"

git add .
git commit -m "fix: 修复了B问题"
```

3. 推送前再次拉取，防止队友在自己开发时 push 了新代码

```bash
git pull --rebase origin main
```

4. 推送

```bash
git push origin main
```
