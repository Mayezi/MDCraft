# 发布说明（Release Notes）

每个版本一个文件：`release-notes/v<版本号>.md`，内容就是 GitHub Release 正文，
也是应用内「检查更新」弹窗显示的更新说明（`latest.json` 的 `notes`）。

## 写法约定

- 文件名必须与 `src-tauri/tauri.conf.json` 的版本号一致，如 `v0.17.0.md`；
- **不要写一级标题**：正文直接从 `##` 开始（Release 名称已由工作流生成）；
- 用户向内容写前面，建议分类：`新增 / 改进 / 修复 / 破坏性变更`；
- 破坏性变更与迁移步骤放最前，工程细节（PR/commit 链接）放最后；
- 支持 GFM Markdown（标题、列表、代码块、表格、链接），应用内会渲染。

## 发版流程

```bash
# 1. 三处版本号同步：package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml
# 2. 新建 release-notes/v0.17.1.md 并写好说明
# 3. 提交推送
git add -A && git commit -m "feat: …；版本 0.17.1" && git push origin main

# 4. 打注释 tag（说明以 release-notes 文件为准，tag 只需标注版本）
git tag -a v0.17.1 -m "MDCraft v0.17.1" && git push origin v0.17.1
```

> 打了 tag 后，`release.yml` 会优先读取 `release-notes/v<版本>.md`；
> 文件不存在时回退到 tag 注释正文，两者都没有则使用占位文案。
