# MDCraft

所见即所得 Markdown 编辑器。**快**（Tauri 2 + Rust，目标 <15MB）且**好用**（块级实时渲染）。

> 架构要点：Rust 核心与桌面壳解耦；编辑器内核基于 CodeMirror 6 decoration 实现块级实时渲染，单文档无预览窗分离。
>
> 设计参考：界面结构与交互思路参考了 [dbx](https://github.com/t8y2/dbx) 的优秀设计，MDCraft 是面向 Markdown 写作场景的独立实现。

## 技术栈

| 层 | 选型 |
| ---|--- |
| 桌面壳 | Tauri 2（系统 WebView，无捆绑 Chromium） |
| 核心后端 | Rust：`crates/md-core`（文件/搜索/监听，与壳解耦） |
| 编辑器 | CodeMirror 6 + Lezer + decoration 块级实时渲染 |
| 公式 | KaTeX（$ 行内 / $$ 块级，自定义 Lezer inline parser） |
| 前端 | React 19 + Vite 8 + Tailwind + zustand |
| 搜索 | ripgrep 内核（`ignore` + `grep-searcher` crate，进程内） |
| 主题 | CSS 变量多主题（主题模式 × 13 套配色方案）+ 用户主题目录机制 |

## 快速开始

```bash
pnpm install

# 浏览器模式（无需 Rust，立即可用）
pnpm dev        # http://localhost:5173

# 桌面模式（需要 Rust 工具链）
pnpm tauri dev

# 打包
pnpm tauri build
```

### 桌面构建环境要求

- Node.js ≥ 18、pnpm
- Rust ≥ 1.88（`rustup` msvc 工具链）
- **Visual Studio Build Tools（含 "使用 C++ 的桌面开发" 工作负载）** —— Rust msvc 目标链接 `link.exe` 必需。
  本机已安装 VS Build Tools 17.14（MSVC 14.44 + Windows SDK 10.0.26100），`cargo check --workspace` 与 `cargo build -p mdcraft` 均验证通过。

## 目录结构

```
mdcraft/
├── src/                    # 前端（React + CM6）
│   ├── editor/             # 编辑器核心
│   │   ├── livepreview.ts  # ★ 行内/行级装饰（ViewPlugin）
│   │   ├── blocks.ts       # ★ 跨行块替换 + block widget（StateField + atomicRanges）
│   │   ├── markdown-config.ts # $ / $$ 公式、==高亮==、<u> 的 Lezer 解析扩展
│   │   ├── widgets.ts      # 表格/公式/图片/分割线/复选框/属性卡部件
│   │   ├── slash.ts        # 斜杠快速插入面板
│   │   ├── commands.ts     # 加粗/斜体/标题/表格等命令
│   │   └── setup.ts        # 扩展装配 + 源码模式切换（compartment）
│   ├── ui/                 # 菜单/文件树/大纲/标签页/状态栏
│   ├── lib/                # 后端抽象（Tauri/浏览器双模式）、导出、统计
│   └── styles/             # 主题变量 + editor.css 渲染样式
├── crates/md-core/         # Rust 核心（fsutil/workspace/search/watcher，不依赖 Tauri）
├── src-tauri/              # Tauri 壳（命令层，薄）
└── public/                 # 图标与静态资源
```

## 已实现（v0.1）

**所见即所得渲染（行内按元素显源码）**
- 行内标记默认隐藏；光标进入某个元素时显示该元素源码（加粗/斜体/删除线/行内代码/链接/`==高亮==`/`<u>` 下划线），移出后恢复渲染
- 表格单元格内同样渲染行内格式；点击单元格切回该格源码编辑，失焦恢复渲染
- 标题 H1–H6（字号分级；点击标题显示/编辑 `#`，H1/H2 下边框）
- 链接（点击显示完整 `[]()` 源码，Ctrl+点击打开）、图片（自动渲染 + 加载失败降级）
- 代码块（140+ 语言语法高亮 + 圆角背景）、GFM 表格（保持渲染为交互件）
- 任务列表（真实复选框，点击即切换 `[x]`；点击文字进入源码编辑）、无序列表圆点（按嵌套层级递减）
- 引用块（含嵌套层级竖线）、分割线、frontmatter 属性卡
- 行内 `$` 与块级 `$$` 公式（KaTeX 实时渲染；行内公式点击显源码，块公式保持渲染 + 浮层编辑）
- 块级元素（表格/围栏代码块/`$$` 公式块/Frontmatter）整块渲染为部件，键盘导航当整体跨过（`atomicRanges`），点击才进入编辑浮层——文档流里不出现源码

**编辑器**
- 快捷键：`Ctrl+B/I/K/E` 格式化，`Ctrl+1..6/0` 标题层级，`Ctrl+F/H` 查找替换（正则支持），`Ctrl+S` 保存，`Ctrl+Shift+S` 另存为，`Ctrl+N` 新建，`Ctrl+/` 源码模式
- 斜杠面板（`/` 快速插入内容）、源码模式一键切换、自动配对、多光标、撤销历史
- 表格/公式原地编辑浮层（方向键在单元格间进出，Esc/点击外部关闭）
- 图片：粘贴/拖拽落盘到文档同级 `assets/`，经资源协议安全加载
- 自动保存（800ms 防抖 + 原子写）、本地草稿持久化

**界面**
- 顶部菜单（文件/帮助）、多标签页、最近打开列表
- 文件夹树：打开文件夹后建树 + 文件监听（外部变更自动刷新），右键新建/重命名/导出/打开方式/打开文件位置/删除（进系统回收站）
- 编辑器不认的文件（exe、pdf、无后缀等）单击弹系统「选择应用」框，由用户自己选程序打开
- 面包屑「定位」：在文件树中展开祖先目录并闪烁高亮当前文件
- 大纲（点击跳转）、文内查找替换（中文查找面板）
- 状态栏（行列/字数/字符/源码模式开关）、字数统计（CJK 按字、英文按词）
- 设置面板：左侧分类 tab（外观 / 文件与启动 / 配置 / 更新 / 关于）+ 右侧顶部全局搜索（结果按分类分组，点击直达对应设置项并高亮）
- 源码模式开关在状态栏左下角（Ctrl+/），主题与配色在工具栏右侧按钮

**外观系统（主题模式 × 配色方案）**

外观拆成两个独立维度：
- **主题模式**：浅色 / 深色（首次启动按系统偏好落定，之后手动切换）
- **配色方案**：13 套预设，选项前带色块预览

| 配色方案 | 主色 | 配色方案 | 主色 |
|---|---|---|---|
| 洁白（默认） | `#171717` | VS Code | `#007acc` |
| 雾灰 | `#2e5fa6` | IDEA | `#4b6eaf` |
| 钛灰 | `#48505d` | Xcode | `#0a84ff` |
| 钴蓝 | `#2b63b7` | JetBrains | `#7b61ff` |
| 青绿 | `#3a7b6a` | Cursor | `#6ba4ff` |
| 暖黄 | `#b07d1a` | Claude Code | `#c47a50` |
| 樱粉 | `#b5476b` | | |

每套配色都有浅色/深色两版，切换主题模式即生效；排版（字体/字号/行高）与配色解耦，正文字号、行高、宽度仍可在设置中单独覆盖。入口：工具栏右侧调色板按钮，或设置面板「外观」；选择持久化（localStorage + mdcraft.json）。

**导出**：独立 HTML（内联样式 + KaTeX 自动渲染公式），入口在文件树右键（草稿在标签右键）；PDF 等格式预留。

**更新**：`tauri-plugin-updater` + minisign 签名校验，产物托管 GitHub Releases，Actions 流水线自动构建发布。

**Rust 后端**（已验证：`cargo check` + `cargo build` 通过）
- 原子写（tmp+fsync+rename）、目录树、文件监听（notify 去抖批量推送）、删除走系统回收站

## 路线图

**P1 — 图表与富编辑**
- mermaid / flowchart / sequence 图渲染（按需懒加载）
- 表格富编辑增强（行列拖拽增删、Tab 单元格导航）

**P2 — 导出与检索增强**
- PDF 导出（headless 打印）、Word（pandoc 子进程）
- 全文索引（SQLite FTS5）替代明文 grep；行内拼写检查（中文可关）
- 图片上传（PicGo/自定义 API）、脚注、TOC、[TOC] 组件

**P3 — 形态扩展**
- `mdcraft-mcp`：MCP Server crate，让 AI 直接检索/读写笔记库
- CLI（npm 分发 Rust 二进制）、Web 版（axum 复用 md-core）
- 主题市场（用户主题目录 + 签名校验）、自定义 CSS、i18n、自定义快捷键

## 设计要点

- **单一数据源**：文档永远是无损 Markdown 文本，渲染只是"视图层装饰"——这是主流所见即所得编辑器验证过的路线，且规避了双向转换的语义丢失。
- **行内按元素显源码**：行内标记默认隐藏；光标进入某个元素时只显示该元素的 Markdown 源码（标记 / 链接地址 / 行内公式），移出恢复渲染。块级元素（表格/围栏代码块/`$$` 公式块/Frontmatter）由 `touchesSelection` 判定是否进入编辑，编辑交由块级 widget / 浮层接管，文档流里不出现源码。
- **核心与壳分离**：`md-core` 不依赖 Tauri，未来 CLI/Web/MCP 形态直接复用。

> AI生成