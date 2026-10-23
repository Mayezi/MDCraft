// 浏览器模式下内置的示例文档（同时作为功能演示用例）

export const WELCOME = `---
title: Markdown 语法速查
tags: [Markdown, 语法速查, 所见即所得]
---

# Markdown 语法速查

MDCraft 支持全功能所见即所得 Markdown 排版。行内标记即时渲染，表格、公式、代码块点击即可直接编辑。

本文档汇总了 MDCraft 支持的全部 Markdown 语法与格式示例，供日常写作随时查阅。

## 标题：六级 ATX + Setext

### 这是三级标题 H3
#### 这是四级标题 H4
##### 这是五级标题 H5
###### 这是六级标题 H6

Setext 式标题用下划线行定义层级（上一行文字 + 本行 \`===\` / \`---\`）：

Setext 一级标题
===

Setext 二级标题
---

## 行内格式

**加粗**、*斜体*、***加粗斜体***、~~删除线~~、==高亮==、<u>下划线</u>、\`行内代码\`，以及[外部链接](https://tauri.app)。

上标：x^2^ + y^2^ = z^2^；下标：H~2~O、CO~2~。

行内公式：质能方程 $E = mc^2$，欧拉公式 $e^{i\\pi} + 1 = 0$。

## 列表

无序列表支持多级嵌套（试试 Tab / Shift+Tab 调整层级）：

- 一级列表项
  - 二级列表项
    - 三级列表项
  - 另一个二级项
- 回到一级

有序列表同样支持嵌套（Tab 后序号自动从 1 接续）：

1. 有序第一项
   1. 嵌套有序项
2. 有序第二项

任务列表（点击复选框试试）：

- [ ] 未完成的任务
- [x] 已完成的任务

## 引用

> 引用块第一层
>
> > 嵌套引用第二层，引用支持多行与嵌套。

## 代码块

\`\`\`rust
fn main() {
    let greeting = "Hello, MDCraft!";
    println!("{}", greeting);
    // 语言标签可点击更换语言
}
\`\`\`

\`\`\`python
def fib(n: int) -> int:
    """Fibonacci"""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\`\`\`

## 图表与绘图（Mermaid / 流程图 / 时序图）

支持 Mermaid 语法按需懒加载并实时渲染矢量图表，双击或点击「编辑代码」可直接修改：

### 流程图（Flowchart）

\`\`\`flowchart
flowchart TD
    Start([开始]) --> Input[/输入 Markdown 文本/]
    Input --> Parse{解析语法树}
    Parse -->|行内元素| Inline[行内实时渲染]
    Parse -->|块级元素| Block[块级 Widget 接管]
    Parse -->|图表语法| Diagram[Mermaid 矢量渲染]
    Inline --> Finish([呈现优质排版])
    Block --> Finish
    Diagram --> Finish
\`\`\`

### 时序图（Sequence Diagram）

\`\`\`sequence
sequenceDiagram
    actor 用户
    participant 编辑器 as MDCraft
    participant 内核 as Rust md-core
    用户->>编辑器: 编辑文档内容
    编辑器-->>用户: 实时所见即所得渲染
    编辑器->>内核: 防抖触发原子写入
    内核-->>编辑器: 保存成功通知
\`\`\`

### 架构图（Mermaid）

\`\`\`mermaid
graph LR
    A[客户端 UI] -->|Tauri IPC| B(Rust 命令层)
    B --> C[(文件系统)]
    B --> D[ripgrep 搜索]
\`\`\`

## 表格

支持左 / 中 / 右三种对齐：

| 功能 | 传统 Electron 方案 | MDCraft |
| :--- | :---: | ---: |
| 渲染方式 | 预览窗分离 | 块级所见即所得 |
| 安装体积 | 100MB+ | <15MB |
| 启动速度 | 慢 | 快 |
| 授权 | 因产品而异 | 开源 |

## 数学公式（块级）

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}
$$

$$
\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
$$

## 图片与分割线

![MDCraft](/app-icon.png)

---

光标离开这条分割线后它会渲染成一条横线。

## 快捷键速查

- \`Ctrl+B\` 加粗 / \`Ctrl+I\` 斜体 / \`Ctrl+K\` 插入链接
- \`Ctrl+1\` ~ \`Ctrl+6\` 设置标题层级，\`Ctrl+0\` 恢复正文
- \`Ctrl+F\` 文内查找，\`Ctrl+H\` 替换（支持正则、全词匹配）
- 输入 \`/\` 唤起快速插入面板（标题、列表、表格、公式一键插入）
- 源码模式（\`Ctrl+/\`）：入口在左下角状态栏，全文档显示 Markdown 源码

开始写作吧！
`;

export const SAMPLE_DOCS: { name: string; content: string }[] = [
  { name: "Markdown 语法速查.md", content: WELCOME },
];
