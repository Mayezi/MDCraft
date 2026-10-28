# AGENTS.md

MDCraft — 所见即所得 Markdown 编辑器（Tauri 2 + Rust 核心 + React 19 / CodeMirror 6）。项目语言为**中文**（README、代码注释、UI 文案、文档均中文），新增注释/文案请保持一致。

## 命令（已核实；无测试、无 lint、无 CI，不要去找 `npm test` / eslint）

- `pnpm dev` — 纯浏览器模式（无需 Rust），http://localhost:5173
- `pnpm build` — 前端校验+构建：`tsc --noEmit && vite build`（这是 TS 类型检查入口）
- `pnpm check:rs` — `cargo check --workspace`（Rust 校验入口）
- `pnpm tauri dev` / `pnpm tauri build` — 桌面模式开发/打包
- `pnpm icon` — 由 `public/app-icon.png` 重新生成 `src-tauri/icons`
- 改动后至少跑：改前端 → `pnpm build`；改 Rust → `pnpm check:rs`。

## 版本号规则

版本号需两处同步：`package.json` 与 `src-tauri/Cargo.toml`。`src-tauri/tauri.conf.json` 的 `version` 字段已省略，由 Tauri 2 自动从 `package.json` 读取。

- **每次小改动完成后立即自增**（不等提交 git 时才加），并两处同步 + 用 `cargo check` 更新根目录 `Cargo.lock`。
- **修复已有功能的 bug / 对已有功能的小优化** → 加版本号**最后一位**（patch，如 `0.3.1` → `0.3.2`）。
- **新开功能**（新增能力/交互/界面）→ 加版本号**中间一位**（minor，patch 归零，如 `0.3.2` → `0.4.0`）。
- 每次提交前先按此规则校准版本号并两处同步，构建通过后一起 `git commit`。
- **只提交，不推送**：日常改动 `git commit` 完就停，**不要**自己 `git push`（推送与打 tag 由维护者决定）。
- **日常提交不写 `release-notes/`**：不是每个版本号都会发版，发布说明只在**发版时**（打 tag 前）写 `release-notes/v<版本>.md`；日常改动只需在提交信息里说清改了什么。

## 发布流程（发版只做这些，别多做）

1. 两处同步版本号（`package.json` / `src-tauri/Cargo.toml`），`cargo check` 更新 `Cargo.lock`。
2. 写 `release-notes/v<版本>.md`（Release 正文 + 应用内更新提示的来源）—— **写完先给用户确认，用户认可后再提交**（发布说明会直接面向用户，不要擅自定稿）。
   - 格式：**只列 `### 新增` / `### 改进` / `### 修复` 等分类下的条目**，一条一个 `- **小标题**：说明`；**不要写顶部 `## 本次更新` 标题，也不要写开头的总结段落**。
   - 早期的 `release-notes/v0.24.4.md` 等仍带总结段，属旧格式，不要照抄。
3. `git add -A && git commit`（推送由维护者执行）。
4. 维护者推送后打 tag：`git tag -a v<版本> -m "MDCraft v<版本>" && git push origin v<版本>` → 触发 `.github/workflows/release.yml`。

**推完 tag 就结束，不要再管 GitHub Actions**：不轮询运行状态、不取消/重跑 run、不调 GitHub API 发布 Release、不用 gh CLI（未安装）。CI 产物与草稿 Release 由维护者自行在 GitHub 上处理。文档/chore 类提交不带版本号。

## 双模式后端（关键陷阱）

`src/lib/backend.ts` 以 `isTauri`（`__TAURI_INTERNALS__`）分流：浏览器模式用 `localStorage`/内存示例文档，桌面模式走 Rust 命令。**打开文件夹、文件管理、文件监听、导出等仅桌面模式可用**——纯 `pnpm dev` 下这些功能是 no-op 或降级，别据此判定功能坏了。

## Rust 工作区边界

两个 crate（`Cargo.toml` workspace members）：
- `crates/md-core`（包名 `mdcraft-core`）——**与 Tauri 解耦**的纯逻辑（fsutil/workspace/search/watcher），未来 CLI/Web/MCP 复用，**不要在此引入 Tauri 依赖**。
- `src-tauri`（包名 `mdcraft`，lib `mdcraft_lib`）——薄命令壳。

新增一个 Tauri 命令需三处同步：`src-tauri/src/commands.rs` 实现 → `src-tauri/src/lib.rs` 的 `invoke_handler` 注册 → `src/lib/backend.ts` 前端封装。插件权限加到 `src-tauri/capabilities/default.json`。文件写用 `fsutil::atomic_write`（tmp+fsync+rename），删除走系统回收站（`trash` crate），不做永久删除。

## 编辑器架构不变量（改渲染前必读）

单一数据源：**文档始终是无损 Markdown 文本，渲染只是 decoration 视图层**。行内元素默认纯渲染；**光标进入某个元素时按元素显示该元素的源码**（标记 / 链接地址 / 行内公式），移出后恢复渲染。块级元素（表格/围栏代码块/$$ 公式块/Frontmatter）仍由 `touchesSelection` 判定 + 思源式浮层 / 块级 widget 接管，不在文档流里显源码；表格单元格内部复用同一套行内渲染（未聚焦渲染，聚焦后在该格内显源码）。这个语义不要随意推翻。

装饰分工（CodeMirror 限制，容易踩）：
- `src/editor/livepreview.ts`（`ViewPlugin`）——行内/行级装饰，**不能替换换行符、不能做跨行块 replace / block widget**。
- `src/editor/blocks.ts`（`StateField` `blockDecoField`）——**跨行块替换、block widget 必须走这里**。含 `atomicRanges`，键盘导航把块当整体跨过，浮层只在点击进入时触发（`insideRange` 开区间判定）。
- `src/editor/markdown-config.ts`——Lezer 自定义 inline parser（`$`/`$$` 公式、`==高亮==`、`<u>`下划线）。语法扩展加这里并装进 `setup.ts` 的 `mdLanguage`。
- 渲染样式在 `src/styles/editor.css`（以装饰 class / `data-*` 属性驱动）。

## 状态与外观

- 编辑器状态池在 React 之外：`src/store.ts` 的 `editorStates: Map<docId, EditorState>`；应用状态用 zustand `useStore`。避免把 EditorState 放进 React state。
- 外观是两个独立维度（对齐 dbx）：**主题模式**（浅色/深色）写到 `<html data-theme-mode>`，**配色方案**（13 套预设）写到 `<html data-palette>`。Tailwind `darkMode` 绑定 `[data-theme-mode="dark"]`。首次启动（无历史值）按系统偏好落成固定模式，之后不再随系统变化。
- 配色方案只提供原始色（`--bg` / `--fg` / `--accent` / `--border` 等 10 个），其余语义变量（`--accent-soft` / `--selection` / `--link-color` / 表格与引用等）由 `src/styles/themes/base.css` 用 `color-mix` 从原始色推导——新增配色只需在 `src/styles/themes/palettes.css` 补一段浅色 + 一段深色。
- 排版（字体/字号/行高）与配色解耦，唯一一套在 `themes/base.css`；语法高亮按深浅两套固定在同一文件。
- 注册表在 `lib/types.ts`（`THEME_MODES` / `THEME_PALETTES`），应用逻辑在 `lib/theme.ts`，持久化键 `mdcraft:theme-mode` / `mdcraft:theme-palette`（旧键 `mdcraft:theme` 在 `store.ts` 迁移）。新增配色需：`lib/types.ts` 注册 + `styles/themes/palettes.css` 补色值。

## 约定

- 路径别名 `@` → `src`（vite + tsconfig 双配置）。
- TS 严格且 `noUnusedLocals`/`noUnusedParameters` 开启——未使用的导入/变量会让 `pnpm build` 失败。
- UI 组件 `src/ui/`，编辑器逻辑 `src/editor/`，后端抽象与导出 `src/lib/`。
