// 斜杠快速插入面板（思源 / Notion 式交互）
// 在行首或空白后输入 "/" 唤起，支持中文 / 拼音 / 英文关键词过滤；
// ↑↓ 选择、Enter 插入、Esc 关闭（由 @codemirror/autocomplete 提供交互）。
// 高频最近使用：选中即按 entryKey 计数持久化，面板置顶显示前 5（对齐思源 frequentSlash）。
// 每个选项 apply 时先删除 "/查询词" 再执行对应命令 → 也直接服务后续顶部菜单栏。

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { frontmatterRange } from "./livepreview";
import { fenceLangSource } from "./fence-lang";
import {
  boldCommand,
  clearFormat,
  codeCommand,
  highlightCommand,
  insertBlockMath,
  insertFence,
  insertFlowchart,
  insertFrontMatter,
  insertHr,
  insertImage,
  insertInlineMath,
  insertLink,
  insertMermaid,
  insertSequence,
  insertTable,
  insertToc,
  italicCommand,
  setHeading,
  strikeCommand,
  subCommand,
  supCommand,
  toggleLinePrefix,
  underlineCommand,
} from "./commands";

interface SlashItem {
  /** 展示标签（纯文字，图标由 lucide mask 渲染） */
  label: string;
  /** 右侧语法标记（思源 getHotkeyOrMarker 同款：无快捷键时显示语法） */
  detail: string;
  /** 过滤关键词：英文 / 拼音 / 中文 */
  keywords: string[];
  /** 稳定入口标识（高频使用统计的键 + 图标类名，对齐思源 entryKey） */
  entryKey: string;
  run: (view: EditorView) => boolean;
  /** 分组标记：有 section 则在该组首项前渲染一条分隔线（思源式，不显示文字） */
  section?: { name: string; rank: number };
}

const BLOCK = { name: "块级", rank: 0 };
const INLINE = { name: "行内", rank: 1 };

export const SLASH_ITEMS: SlashItem[] = [
  // ---------- 块级 ----------
  { label: "标题一", detail: "#", keywords: ["h1", "标题", "biaoti", "heading"], entryKey: "heading1", run: setHeading(1), section: BLOCK },
  { label: "标题二", detail: "##", keywords: ["h2", "标题", "biaoti", "heading"], entryKey: "heading2", run: setHeading(2), section: BLOCK },
  { label: "标题三", detail: "###", keywords: ["h3", "标题", "biaoti", "heading"], entryKey: "heading3", run: setHeading(3), section: BLOCK },
  { label: "标题四", detail: "####", keywords: ["h4", "标题", "biaoti", "heading"], entryKey: "heading4", run: setHeading(4), section: BLOCK },
  { label: "标题五", detail: "#####", keywords: ["h5", "标题", "biaoti", "heading"], entryKey: "heading5", run: setHeading(5), section: BLOCK },
  { label: "标题六", detail: "######", keywords: ["h6", "标题", "biaoti", "heading"], entryKey: "heading6", run: setHeading(6), section: BLOCK },
  { label: "无序列表", detail: "-", keywords: ["ul", "无序", "wuxu", "列表", "liebiao", "bullet"], entryKey: "list", run: toggleLinePrefix("bullet"), section: BLOCK },
  { label: "有序列表", detail: "1.", keywords: ["ol", "有序", "youxu", "列表", "ordered"], entryKey: "orderedList", run: toggleLinePrefix("ordered"), section: BLOCK },
  { label: "任务列表", detail: "[]", keywords: ["task", "任务", "renwu", "todo", "清单", "checkbox", "列表"], entryKey: "check", run: toggleLinePrefix("task"), section: BLOCK },
  { label: "引用块", detail: ">", keywords: ["quote", "引用", "yinyong", "blockquote"], entryKey: "quote", run: toggleLinePrefix("quote"), section: BLOCK },
  { label: "代码块", detail: "```", keywords: ["code", "代码", "daima", "fence", "daimakuai"], entryKey: "code", run: (v) => insertFence(v), section: BLOCK },
  { label: "公式块", detail: "$$", keywords: ["math", "公式", "gongshi", "latex", "katex"], entryKey: "mathBlock", run: insertBlockMath, section: BLOCK },
  { label: "Mermaid 图表", detail: "mermaid", keywords: ["mermaid", "图表", "tubiao", "chart"], entryKey: "code", run: insertMermaid, section: BLOCK },
  { label: "流程图", detail: "flowchart", keywords: ["flowchart", "流程图", "liucheng"], entryKey: "code", run: insertFlowchart, section: BLOCK },
  { label: "时序图", detail: "sequence", keywords: ["sequence", "时序图", "shixu"], entryKey: "code", run: insertSequence, section: BLOCK },
  { label: "表格", detail: "3×3", keywords: ["table", "表格", "biaoge", "biao"], entryKey: "table", run: (v) => insertTable(v, 3, 3), section: BLOCK },
  { label: "分割线", detail: "---", keywords: ["hr", "分割", "fenge", "fengexian", "horizontal", "线"], entryKey: "line", run: insertHr, section: BLOCK },
  { label: "目录", detail: "[toc]", keywords: ["toc", "目录", "mulu", "大纲", "content"], entryKey: "toc", run: insertToc, section: BLOCK },
  { label: "元数据", detail: "---", keywords: ["frontmatter", "元数据", "yuanshu", "属性", "shuxing", "fm"], entryKey: "frontmatter", run: insertFrontMatter, section: BLOCK },

  // ---------- 行内 ----------
  { label: "加粗", detail: "**", keywords: ["bold", "加粗", "jiacu", "粗体"], entryKey: "bold", run: boldCommand, section: INLINE },
  { label: "斜体", detail: "*", keywords: ["italic", "斜体", "xieti", "斜"], entryKey: "italic", run: italicCommand, section: INLINE },
  { label: "删除线", detail: "~~", keywords: ["strike", "删除", "shanchu", "del"], entryKey: "strike", run: strikeCommand, section: INLINE },
  { label: "行内代码", detail: "`", keywords: ["code", "代码", "daima", "行内", "hangnei", "inline"], entryKey: "inlineCode", run: codeCommand, section: INLINE },
  { label: "高亮", detail: "==", keywords: ["highlight", "高亮", "gaoliang", "标记", "biaoji"], entryKey: "mark", run: highlightCommand, section: INLINE },
  { label: "上标", detail: "^", keywords: ["sup", "上标", "shangbiao", "superscript"], entryKey: "sup", run: supCommand, section: INLINE },
  { label: "下标", detail: "~", keywords: ["sub", "下标", "xiabiao", "subscript"], entryKey: "sub", run: subCommand, section: INLINE },
  { label: "下划线", detail: "<u>", keywords: ["underline", "下划", "xiahuaxian", "u"], entryKey: "underline", run: underlineCommand, section: INLINE },
  { label: "行内公式", detail: "$", keywords: ["math", "公式", "gongshi", "inline", "行内", "hangnei"], entryKey: "inlineMath", run: insertInlineMath, section: INLINE },
  { label: "链接", detail: "[]", keywords: ["link", "链接", "lianjie", "url"], entryKey: "link", run: insertLink, section: INLINE },
  { label: "图片", detail: "![]", keywords: ["image", "图片", "tupian", "img", "图"], entryKey: "image", run: insertImage, section: INLINE },
  { label: "清除格式", detail: "", keywords: ["clear", "清除", "qingchu", "格式", "geshi"], entryKey: "clearFormat", run: clearFormat, section: INLINE },
];

// ---------- 高频最近使用（对齐思源 frequentSlashStorage / frequentSlash） ----------

const USAGE_KEY = "mdcraft:slash-usage";
const RECENT_MAX = 5;

/** 读取并校验使用计数（key 非空、正整数），坏数据静默丢弃 */
function readUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return {};
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k.length > 0 && k.length <= 64 && Number.isSafeInteger(v) && (v as number) > 0) {
        out[k] = v as number;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 选中执行时计数 +1 并持久化 */
function recordUsage(entryKey: string) {
  if (!entryKey || entryKey.length > 64) return;
  const usage = readUsage();
  usage[entryKey] = Math.min((usage[entryKey] ?? 0) + 1, 1_000_000);
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    /* 存储失败不阻断编辑 */
  }
}

/** 按使用次数降序（次数相同保持原顺序）取前 5，从候选中挑出最近使用项 */
function rankFrequent(items: SlashItem[], usage: Record<string, number>): SlashItem[] {
  const seen = new Set<string>();
  return items
    .map((item, index) => ({ item, index, key: item.entryKey }))
    .filter(({ key }) => {
      if (!key || seen.has(key) || !Object.prototype.hasOwnProperty.call(usage, key) || !(usage[key] > 0)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => usage[b.key] - usage[a.key] || a.index - b.index)
    .slice(0, RECENT_MAX)
    .map(({ item }) => item);
}

// ---------- 过滤与触发 ----------

/** 过滤：query 命中标签 / 说明 / 关键词即入选（正向包含已天然支持拼音打到一半的场景） */
function matchItem(it: SlashItem, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return [it.label, it.detail, ...it.keywords].some((h) => h.toLowerCase().includes(ql));
}

export const slashSource: CompletionSource = (ctx: CompletionContext) => {
  const state = ctx.state;
  const line = state.doc.lineAt(ctx.pos);

  // 1. 触发形态：(行首 | 空白) "/" [过滤词]$ —— 词中 / 不触发（URL 等场景天然免疫）
  const before = line.text.slice(0, ctx.pos - line.from);
  const m = /(?:^|\s)\/([A-Za-z0-9\u4e00-\u9fa5_]*)$/.exec(before);
  if (!m) return null;

  // 2. frontmatter 内不触发
  const fm = frontmatterRange(state);
  if (fm && line.number <= fm[1]) return null;

  // 3. 代码块内不触发
  let inCode = false;
  syntaxTree(state).iterate({
    from: line.from,
    to: Math.min(ctx.pos + 1, line.to),
    enter(n) {
      if (n.name === "FencedCode" || n.name === "CodeBlock") inCode = true;
    },
  });
  if (inCode) return null;

  const query = m[1];
  const slashFrom = line.from + m[0].length - m[1].length - 1; // "/" 起点
  const list = SLASH_ITEMS.filter((it) => matchItem(it, query));
  if (!list.length) return null;

  // 高频项复制到顶部（不加分隔线，与思源一致：frequent 区与后续区之间仅一条线）；
  // 同 label 的两份经 CM6 排序后相邻自动去重，保留顶部那份
  const frequent = rankFrequent(list, readUsage()).map((it) => ({ ...it, section: undefined }));
  const ordered = frequent.length ? [...frequent, ...list] : list;

  const options: Completion[] = ordered.map((it) => ({
    label: it.label,
    detail: it.detail,
    type: it.entryKey, // 图标类名锚点（optionClass 消费）
    section: it.section,
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      // 先删除 "/查询词"，再执行命令；执行成功才计入高频
      view.dispatch({ changes: { from, to } });
      if (it.run(view)) recordUsage(it.entryKey);
    },
  }));

  // filter: false —— 过滤/排序完全由本 source 负责（库默认会拿 from~to 文本 "/xxx" 再做
  // 一轮模糊匹配，会把所有 label 都筛掉）；filter:false 时不可再给 validFor
  return { from: slashFrom, options, filter: false };
};

/** 挂到编辑器扩展上（图标由 CSS mask 渲染，详情见 styles/slash-icons.css）
 *  override 同时挂斜杠面板与代码块语言选择（互斥触发条件，共用同一交互与视觉） */
export const slashPanel = () =>
  autocompletion({
    override: [slashSource, fenceLangSource],
    icons: false,
    activateOnTyping: true,
    maxRenderedOptions: 40,
    closeOnBlur: true,
    optionClass: (c) => (c.type ? `md-si md-si-${c.type}` : "md-si"),
  });
