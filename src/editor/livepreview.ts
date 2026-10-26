// Live Preview 核心渲染插件
// 单一数据源是 Markdown 源码；通过 CodeMirror decoration 把语法标记隐藏/替换为渲染结果。
// 行内元素默认纯渲染；光标进入某个元素时，按元素显示该元素的 Markdown 源码
// （标记 / 链接地址 / 行内公式），移出后恢复渲染。表格、围栏代码块、$$ 公式块
// 仍由块级 widget / 思源式浮层接管，不在文档流里显示源码（blocks.ts）。

import {
  EditorView,
  Decoration,
  ViewPlugin,
  type ViewUpdate,
  type DecorationSet,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { EditorSelection, EditorState, Range } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import { startCompletion } from "@codemirror/autocomplete";
import { MathWidget, ImageWidget, HrWidget, CheckboxWidget, BulletWidget } from "./widgets";
import { BrWidget, safeUrl } from "./htmlblock";
import { openUrl } from "../lib/backend";

const D = Decoration;

// ---------- 装饰器实例 ----------

const hideReplace = D.replace({}); // 隐藏源码标记（零宽替换，位置映射精确 → 光标点击准确）
const markFade = D.mark({ class: "md-fade" }); // 弱化但保留
const clsBold = D.mark({ class: "md-bold" });
const clsItalic = D.mark({ class: "md-italic" });
const clsStrike = D.mark({ class: "md-strike" });
const clsCode = D.mark({ class: "md-code" });
const clsListMark = D.mark({ class: "md-listmark" });
const clsHighlight = D.mark({ class: "md-highlight" });
const clsSub = D.mark({ class: "md-sub" });
const clsSup = D.mark({ class: "md-sup" });
const clsUnderline = D.mark({ class: "md-underline" });

const lineOf = (cls: string) => D.line({ class: cls });
const L_H = [1, 2, 3, 4, 5, 6].map((i) => lineOf(`md-line-h${i}`));
const L_FRONT = lineOf("md-line-front");
const L_FRONT_LAST = lineOf("md-line-front md-front-last"); // 末 --- 行：底部圆角收口
const L_PARA = lineOf("md-line-para");

/** 块类型 gutter 标签（思源式：hover/光标行左缘显示块类型，如 h1/code/list）
 *  每行标注所属块类型，显示与否由 CSS hover/activeLine 控制 */
const GUTTER_CACHE = new Map<string, Decoration>();
const gutterOf = (type: string) => {
  let d = GUTTER_CACHE.get(type);
  if (!d) {
    d = D.line({ class: "md-gutter", attributes: { "data-btype": type } });
    GUTTER_CACHE.set(type, d);
  }
  return d;
};

/** 列表行视觉缩进装饰（渲染态）：按层级 data-depth，CSS 逐级 padding-left 递进
 *  缓存并存深度，>10 级钳制（超深列表罕见，CSS 规则到 10 级即可） */
const LIST_INDENT_CACHE = new Map<number, Decoration>();
const listIndentLine = (depth: number) => {
  const d = Math.min(depth, 10);
  let deco = LIST_INDENT_CACHE.get(d);
  if (!deco) {
    deco = D.line({ class: "md-list-line", attributes: { "data-depth": String(d) } });
    LIST_INDENT_CACHE.set(d, deco);
  }
  return deco;
};

/** 引用内列表行装饰：列表视觉缩进叠加引用缩进。
 *  引用(md-line-quote)与列表(md-list-line)都设 padding-left，CSS 层叠会被列表覆盖，
 *  导致引用内列表图标不体现引用缩进、与引用文本错位——改用内联 style 显式叠加两者 */
const LIST_QUOTE_CACHE = new Map<string, Decoration>();
const listIndentLineQ = (listDepth: number, quoteDepth: number) => {
  const key = `${listDepth}:${quoteDepth}`;
  let d = LIST_QUOTE_CACHE.get(key);
  if (!d) {
    const ld = Math.min(listDepth, 10);
    d = D.line({
      class: "md-list-line",
      attributes: {
        "data-depth": String(ld),
        "data-qdepth": String(quoteDepth),
        style: `padding-left: calc(var(--md-quote-base, 6px) + ${quoteDepth * 1.1}em + ${2 * ld - 0.6}em) !important;`,
      },
    });
    LIST_QUOTE_CACHE.set(key, d);
  }
  return d;
};

/** 引用行装饰（渲染态）：按嵌套层级 data-depth，CSS 逐层画竖线 + 递进缩进
 *  无背景色（仅左侧竖线）；>5 层钳制（超深嵌套罕见，CSS 渐变竖线枚举到 5 层） */
const QUOTE_LINE_CACHE = new Map<number, Decoration>();
const quoteLine = (depth: number) => {
  const d = Math.min(depth, 5);
  let deco = QUOTE_LINE_CACHE.get(d);
  if (!deco) {
    deco = D.line({ class: "md-line-quote", attributes: { "data-depth": String(d) } });
    QUOTE_LINE_CACHE.set(d, deco);
  }
  return deco;
};

// ---------- 选择区判定 ----------

/** 光标/选区是否接触 [from,to]（块级编辑入口 + 行内元素源码态判定；pad=0 为精确判定） */
function touchesSelection(sel: EditorSelection, from: number, to: number, pad = 1): boolean {
  for (const r of sel.ranges) {
    if (r.from <= to + pad && r.to >= from - pad) return true;
  }
  return false;
}

function childrenOf(node: SyntaxNodeRef): { name: string; from: number; to: number }[] {
  const out: { name: string; from: number; to: number }[] = [];
  let ch = node.node.firstChild;
  while (ch) {
    out.push({ name: ch.name, from: ch.from, to: ch.to });
    ch = ch.nextSibling;
  }
  return out;
}

/** frontmatter 行范围（文档以 --- 开头）；斜杠面板同样需要 → 导出 */
export function frontmatterRange(state: EditorState): [number, number] | null {
  if (state.doc.lines === 0) return null;
  const first = state.doc.line(1);
  if (first.text.trim() !== "---") return null;
  const limit = Math.min(state.doc.lines, 60);
  for (let n = 2; n <= limit; n++) {
    const t = state.doc.line(n).text.trim();
    if (t === "---" || t === "...") return [1, n];
  }
  return null;
}

// ---------- 主构建函数 ----------

interface LiveDecorations {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

function buildDecorations(view: EditorView): LiveDecorations {
  const state = view.state;
  const deco: Range<Decoration>[] = [];
  const sel = state.selection;
  const fm = frontmatterRange(state);
  const fmEndPos = fm ? state.doc.line(fm[1]).to : -1;

  /** mark 装饰守卫：空区间（from>=to）不允许，直接跳过 */
  const pushMark = (d: Decoration, from: number, to: number) => {
    if (from < to) deco.push(d.range(from, to));
  };
  /** 隐藏替换守卫：replace 装饰必须非空且不跨行 */
  const pushHide = (from: number, to: number) => {
    if (from < to) deco.push(hideReplace.range(from, to));
  };

  // Frontmatter（渲染态被 blocks.ts 的属性卡整块覆盖；光标进入时显示源码，行样式在此）
  if (fm) {
    for (let n = fm[0]; n <= fm[1]; n++) {
      deco.push((n === fm[1] ? L_FRONT_LAST : L_FRONT).range(state.doc.line(n).from));
      if (n === fm[0]) deco.push(gutterOf("front").range(state.doc.line(n).from));
    }
  }

  const headingLevels: Record<string, number> = {
    ATXHeading1: 1,
    ATXHeading2: 2,
    ATXHeading3: 3,
    ATXHeading4: 4,
    ATXHeading5: 5,
    ATXHeading6: 6,
    SetextHeading1: 1,
    SetextHeading2: 2,
  };

  syntaxTree(state).iterate({
    enter(node) {
      const from = node.from;
      const to = node.to;
      const name = node.name;

      // ---- frontmatter 内部节点全部跳过 ----
      // （语法树不识别 frontmatter，其边界 --- 会被误判为分割线/标题下划线）
      if (fm && node.name !== "Document" && from < fmEndPos) {
        return false;
      }

      // ---- 标题 ----
      const hLevel = headingLevels[name];
      if (hLevel) {
        const ln = state.doc.lineAt(from);
        deco.push(L_H[hLevel - 1].range(ln.from));
        deco.push(gutterOf(`h${hLevel}`).range(ln.from));
        // 光标进入标题文字（标记之后）才显示 # / setext 下划线源码；
        // 光标落在行首标记区（如打开文件时）保持纯渲染，实现「打开不聚焦」。
        const isAtx = name.startsWith("ATX");
        const m = isAtx ? /^#{1,6} +/.exec(ln.text) : null;
        const markerEnd = m ? ln.from + m[0].length : from;
        const headingActive = sel.ranges.some((r) => r.head >= markerEnd && r.head <= to);
        if (isAtx) {
          if (m && !headingActive) pushHide(ln.from, ln.from + m[0].length);
        } else {
          // setext 下划线行（=== / ---）：标题被点击时整段显示源码
          const under = state.doc.lineAt(to);
          if (!headingActive && under.text.trim() !== "") pushHide(under.from, under.to);
        }
        return;
      }

      switch (name) {
        // ---- 引用块 ----
        // 嵌套层级：祖先链 Blockquote 计数（直接引用=1）。
        // 本层独占行 = 自身范围内剔除直接嵌套 Blockquote 覆盖的行——
        // 子层行由子节点按自身深度装饰，避免同层行叠加多份 data-depth。
        // gutter 图标：仅 Document 直接子级的引用块挂、覆盖其完整行范围
        // （含嵌套行），与旧行为一致，嵌套节点不重复挂。
        case "Blockquote": {
          let depth = 1;
          let anc = node.node.parent;
          while (anc) {
            if (anc.name === "Blockquote") depth++;
            anc = anc.node.parent;
          }
          const first = state.doc.lineAt(from).number;
          const last = state.doc.lineAt(Math.max(from, to - 1)).number;
          if (node.node.parent?.name === "Document") {
            for (let n = first; n <= last; n++) deco.push(gutterOf("quote").range(state.doc.line(n).from));
          }
          const childQuotes = childrenOf(node).filter((c) => c.name === "Blockquote");
          const segs: [number, number][] = [];
          let cursor = first;
          for (const cq of childQuotes) {
            const cf = state.doc.lineAt(cq.from).number;
            const cl = state.doc.lineAt(Math.max(cq.from, cq.to - 1)).number;
            if (cf > cursor) segs.push([cursor, cf - 1]);
            cursor = Math.max(cursor, cl + 1);
          }
          if (cursor <= last) segs.push([cursor, last]);
          for (const [a, b] of segs) {
            for (let n = a; n <= b; n++) deco.push(quoteLine(depth).range(state.doc.line(n).from));
          }
          break;
        }
        case "QuoteMark": {
          const ln = state.doc.lineAt(from);
          // 光标在引用行内 → 显示 > 源码；按行判定，点正文也能进入编辑
          if (touchesSelection(sel, ln.from, ln.to, 0)) break;
          const rel = from - ln.from;
          const m = /^>+ ?/.exec(ln.text.slice(rel));
          if (m) pushHide(from, from + m[0].length);
          break;
        }

        // ---- 列表 ----
        case "ListMark": {
          const parent = node.node.parent;
          // 列表项首行：gutter 标记 list（parent=ListItem，标记行即列表项首行）
          const ln = state.doc.lineAt(from);
          if (parent && state.doc.lineAt(parent.from).number === ln.number) {
            deco.push(gutterOf("list").range(ln.from));
          }
          const taskNode = parent ? parent.getChild("Task") : null;
          // 语法树层级：OrderedList/BulletList > ListItem > ListMark
          // ListMark 的直接父级是 ListItem，有序判定须看祖父节点
          const grandparent = parent?.node.parent;
          // 层级：祖先链中 ListItem 计数（含自身），顶层=1
          let depth = 0;
          let quoteDepth = 0;
          let anc: SyntaxNodeRef | null = node.node.parent;
          while (anc) {
            if (anc.name === "ListItem") depth++;
            if (anc.name === "Blockquote") quoteDepth++;
            anc = anc.node.parent;
          }
          // 引用内列表：列表缩进叠加引用缩进（内联 style），避免两套 padding 层叠错位
          const lineDeco = quoteDepth > 0 ? listIndentLineQ(depth, quoteDepth) : listIndentLine(depth);
          // 列表项换行后的续行也要继承正文起始位置，形成悬挂缩进。
          if (parent) {
            const itemFirst = state.doc.lineAt(parent.from).number;
            const itemLast = state.doc.lineAt(Math.max(parent.from, parent.to - 1)).number;
            for (let n = itemFirst; n <= itemLast; n++) {
              deco.push(lineDeco.range(state.doc.line(n).from));
            }
          }
          // 渲染态视觉缩进：源码 2 空格/级视觉太紧凑，隐藏行首缩进空格，
          // 层级改由行级 padding 表达（CSS 2em/级递进，随字号自适应）。
          // 语法树不含 ListMark 前导空白（已实测确认），[ln.from, from) 恰为缩进空格列。
          // 点击列表项只还原标记本身，缩进仍由 padding 表达——避免空格与 padding 叠加跳动。
          const listActive = touchesSelection(sel, ln.from, ln.to, 0);
          if (from > ln.from && ln.text.slice(0, from - ln.from).trim() === "") {
            pushHide(ln.from, from);
          }
          if (taskNode) {
            // 任务项：渲染态隐藏圆点，复选框承载交互；源码态显示 "- [ ]"
            if (!listActive) pushHide(from, to);
          } else if (grandparent?.name === "OrderedList") {
            // 有序列表：渲染态淡显序号；源码态恢复普通颜色
            if (!listActive) pushMark(clsListMark, from, to);
          } else {
            // 无序列表：渲染态替换为圆点；源码态显示 - / * / +
            if (!listActive) {
              deco.push(D.replace({ widget: new BulletWidget(depth) }).range(from, to));
            }
          }
          break;
        }
        case "TaskMarker": {
          const ln = state.doc.lineAt(from);
          // 光标在任务项行内 → 显示 [ ] 源码；否则渲染复选框
          if (touchesSelection(sel, ln.from, ln.to, 0)) break;
          const text = state.sliceDoc(from, to);
          const checked = /[xX]/.test(text);
          deco.push(D.replace({ widget: new CheckboxWidget(checked, from, to) }).range(from, to));
          break;
        }

        // ---- 表格（块内每一行 gutter） ----
        case "Table": {
          const tFirst = state.doc.lineAt(from).number;
          const tLast = state.doc.lineAt(Math.min(to, state.doc.length)).number;
          for (let n = tFirst; n <= tLast; n++) deco.push(gutterOf("table").range(state.doc.line(n).from));
          break;
        }

        // ---- 数学公式 ----
        // ① 块公式 gutter：$$..$$ 跨行块；单行 $$x$$ 且占整行也标 math，行内 $x$ 不标
        // ② 行内 $x$：默认渲染为 KaTeX；光标进入时显源码，直接编辑 tex
        // ③ 块公式 $$x$$（含单行整行形态）：保持渲染，编辑由 blocks.ts 浮层接管
        // ⚠ switch 中 case 标签不可重复（仅首个命中）：此处曾出现两个 case "Formula"，
        //   行内公式渲染成死分支，已合并为单 case
        case "Formula": {
          const text = state.sliceDoc(from, to);
          const isBlock = text.startsWith("$$");
          if (isBlock) {
            const mFirst = state.doc.lineAt(from).number;
            const mLast = state.doc.lineAt(Math.min(to, state.doc.length)).number;
            const singleLineFormula = mFirst === mLast;
            if (!singleLineFormula || state.doc.line(mFirst).text.trim() === text) {
              for (let n = mFirst; n <= mLast; n++) deco.push(gutterOf("math").range(state.doc.line(n).from));
            }
          }
          const tex = isBlock ? text.slice(2, -2) : text.slice(1, -1);
          const formulaActive = touchesSelection(sel, from, to, 0);
          if (
            state.doc.lineAt(from).number === state.doc.lineAt(to).number &&
            (isBlock || !formulaActive)
          ) {
            deco.push(D.replace({ widget: new MathWidget(tex.trim(), isBlock) }).range(from, to));
          }
          break;
        }

        // ---- 分割线 ----
        // 块级 replace：无论即时渲染开关，光标触碰即显源码（编辑入口）
        case "HorizontalRule": {
          if (!touchesSelection(sel, from, to, 0)) {
            deco.push(D.replace({ widget: new HrWidget() }).range(from, to));
          }
          break;
        }

        // ---- 代码块 ----
        // 围栏式（FencedCode）已由 blocks.ts 整块替换为只读件 + 浮层编辑（见 widgets.ts），
        // 此处仅处理缩进式代码块（4 空格缩进、无围栏，blocks 不接管）：保留块内行渲染
        case "CodeBlock": {
          const first = state.doc.lineAt(from).number;
          const lastLn = state.doc.lineAt(Math.min(to, state.doc.length));
          for (let n = first; n <= lastLn.number; n++) {
            deco.push(gutterOf("code").range(state.doc.line(n).from));
          }
          break;
        }
        case "CodeMark":
        case "CodeInfo": {
          // 行内代码的标记由 InlineCode 按元素显隐；此处只处理围栏代码
          if (node.node.parent?.name === "InlineCode") break;
          pushHide(from, to); // 隐藏 ``` / 语言名
          break;
        }

        // ---- 行内强调 ----
        case "Emphasis":
        case "StrongEmphasis":
        case "Strikethrough": {
          const active = touchesSelection(sel, from, to, 0);
          const kids = childrenOf(node);
          const marks = kids.filter((c) => c.name === "EmphasisMark" || c.name === "StrikethroughMark");
          if (marks.length >= 2) {
            if (!active) {
              for (const m of marks) pushHide(m.from, m.to);
            }
            const cls = name === "StrongEmphasis" ? clsBold : name === "Emphasis" ? clsItalic : clsStrike;
            pushMark(cls, marks[0].to, marks[marks.length - 1].from);
          }
          break;
        }

        // ---- 行内代码 ----
        case "InlineCode": {
          const active = touchesSelection(sel, from, to, 0);
          const marks = childrenOf(node).filter((c) => c.name === "CodeMark");
          if (marks.length >= 2) {
            if (!active) {
              for (const m of marks) pushHide(m.from, m.to);
            }
            pushMark(clsCode, marks[0].to, marks[marks.length - 1].from);
          }
          break;
        }

        // ---- 高亮 ==text==（整体节点：默认隐藏头尾标记 + 内容加底色） ----
        case "Highlight": {
          if (to - from > 4) {
            if (!touchesSelection(sel, from, to, 0)) {
              pushHide(from, from + 2);
              pushHide(to - 2, to);
            }
            pushMark(clsHighlight, from + 2, to - 2);
          }
          break;
        }

        // ---- 下划线 <u>text</u> ----
        case "Underline": {
          const openLen = 3;
          const closeLen = 4;
          if (to - from > openLen + closeLen) {
            if (!touchesSelection(sel, from, to, 0)) {
              pushHide(from, from + openLen);
              pushHide(to - closeLen, to);
            }
            pushMark(clsUnderline, from + openLen, to - closeLen);
          }
          break;
        }

        // ---- 上标 ^text^ / 下标 ~text~ ----
        case "Subscript":
        case "Superscript": {
          const active = touchesSelection(sel, from, to, 0);
          const marks = childrenOf(node).filter(
            (c) => c.name === "SubscriptMark" || c.name === "SuperscriptMark",
          );
          if (marks.length >= 2) {
            if (!active) {
              for (const m of marks) pushHide(m.from, m.to);
            }
            pushMark(name === "Subscript" ? clsSub : clsSup, marks[0].to, marks[marks.length - 1].from);
          }
          break;
        }

        // ---- 行内 HTML 标签（HTMLTag）----
        // void 标签渲染：<br/> 分行 / <img> 徽章 / <hr> 分隔线；
        // 配对行内标签（<sub> 等需跨节点配对）暂保持源码显示
        case "HTMLTag": {
          const text = state.sliceDoc(from, to).trim();
          const m = /^<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>$/s.exec(text);
          if (!m) break;
          const tag = m[1].toLowerCase();
          const attrs = m[2] || "";
          if (tag === "br") {
            // 光标进入标签 → 显示 <br/> 源码
            if (!touchesSelection(sel, from, to, 0)) {
              deco.push(D.replace({ widget: new BrWidget() }).range(from, to));
            }
            break;
          }
          if (tag === "img") {
            if (touchesSelection(sel, from, to, 0)) break; // 触碰显源码（同 Image 交互）
            const sm = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
            const src = sm ? (sm[1] ?? sm[2] ?? sm[3] ?? "").trim() : "";
            if (!src) break; // 无图源：保持源码
            if (!safeUrl(src)) break; // 不安全协议（data:svg / javascript: 等）拒收，保持源码
            const am = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
            const alt = am ? (am[1] ?? am[2] ?? "").trim() : "";
            deco.push(D.replace({ widget: new ImageWidget(src, alt) }).range(from, to));
            break;
          }
          if (tag === "hr") {
            if (!touchesSelection(sel, from, to, 0)) {
              deco.push(D.replace({ widget: new HrWidget() }).range(from, to));
            }
            break;
          }
          break; // 其余行内标签保持源码
        }

        // ---- 链接 ----
        // 结构：LinkMark("[") 文本 LinkMark("]") LinkMark("(") URL LinkMark(")")
        case "Link": {
          const active = touchesSelection(sel, from, to, 0);
          const marks = childrenOf(node).filter((c) => c.name === "LinkMark");
          if (marks.length >= 4) {
            const url = state.sliceDoc(marks[2].to, marks[3].from).trim();
            if (!active) {
              for (const m of marks) pushHide(m.from, m.to);
              pushHide(marks[2].to, marks[3].from);
            }
            pushMark(
              D.mark({ class: "md-link", attributes: { "data-href": url } }),
              marks[0].to,
              marks[1].from,
            );
          }
          break;
        }
        case "URL": {
          pushMark(markFade, from, to);
          break;
        }

        // ---- 图片 ----
        // 结构：LinkMark("![") alt LinkMark("]") LinkMark("(") URL LinkMark(")")
        // 块级 replace：无论即时渲染开关，光标触碰即显源码（编辑入口）
        case "Image": {
          if (touchesSelection(sel, from, to, 0)) break;
          const marks = childrenOf(node).filter((c) => c.name === "LinkMark");
          if (marks.length >= 4) {
            const alt = state.sliceDoc(marks[0].to, marks[1].from).trim();
            const src = state.sliceDoc(marks[2].to, marks[3].from).trim();
            deco.push(D.replace({ widget: new ImageWidget(src, alt) }).range(from, to));
          }
          break;
        }

        // ---- 段落间距（仅顶层段落） ----
        case "Paragraph": {
          if (node.node.parent?.name === "Document") {
            const ln = state.doc.lineAt(from);
            if (ln.number > (fm ? fm[1] : 1)) deco.push(L_PARA.range(ln.from));
            // 段落默认类型 ¶（未被其他块类型覆盖时兜底显示）
            deco.push(gutterOf("para").range(ln.from));
          }
          break;
        }
      }
    },
  });

  // 只有 replace 装饰（隐藏标记 / 行内 widget）是原子区间。
  // mark 装饰覆盖的是可编辑正文，若混入 atomicRanges，点击会吸附到首尾、
  // 方向键整段跳跃、Backspace 一次删除整段格式文本。
  const atomic = deco.filter((r) => r.value === hideReplace || r.value.spec?.widget != null);
  return {
    decorations: Decoration.set(deco, true),
    atomic: Decoration.set(atomic, true),
  };
}

// ---------- 插件 ----------

/** LivePreview 视图插件（模块级常量：atomicRanges 需按插件实例取装饰） */
const livePreviewPlugin = ViewPlugin.fromClass(
  class LivePreviewPlugin {
    decorations: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      const built = buildDecorations(view);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        const built = buildDecorations(u.view);
        this.decorations = built.decorations;
        this.atomic = built.atomic;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(event: MouseEvent, view: EditorView) {
        const target = event.target as HTMLElement;

        // 任务复选框：切换 [ ] / [x]
        const cb = target.closest?.(".md-task-checkbox") as HTMLInputElement | null;
          if (cb) {
            const from = Number(cb.dataset.from);
            const to = Number(cb.dataset.to);
            if (!Number.isNaN(from) && !Number.isNaN(to) && to > from) {
              const cur = view.state.sliceDoc(from, to);
              const checked = !/[xX]/.test(cur);
              view.dispatch({
                changes: { from, to, insert: checked ? "[x]" : "[ ]" },
              });
              event.preventDefault();
              return true;
            }
          }

          // 代码块语言 tag：点击 → 光标定位语言词尾 + 立即弹语言选择面板
          // （换语言直接改词，面板过滤即时跟随）
          const tag = target.closest?.(".md-lang-tag") as HTMLElement | null;
          if (tag) {
            const pos = view.posAtDOM(tag, 0);
            const line = view.state.doc.lineAt(pos);
            if (line.text.startsWith("```")) {
              view.dispatch({
                selection: { anchor: line.to }, // 语言词尾（空选区，startCompletion 立即生效）
              });
              startCompletion(view);
            }
            event.preventDefault();
            return true;
          }

          // 点击 fence 薄条行（隐藏的 ``` 定界行）→ 光标重定向，避免落在隐形行
          const fenceLine = target.closest?.(".md-fence-first, .md-fence-last") as HTMLElement | null;
          if (fenceLine && !fenceLine.contains(tag ?? null)) {
            const pos = view.posAtDOM(fenceLine, 0);
            const line = view.state.doc.lineAt(pos);
            if (line.text.startsWith("```")) {
              let t = line.number;
              if (fenceLine.classList.contains("md-fence-first")) {
                t = line.number + 1; // 薄顶条 → 代码内容第一行
              } else {
                t = line.number + 1; // 薄底条 → 块外下一行
              }
              const anchor = t <= view.state.doc.lines ? view.state.doc.line(Math.min(t, view.state.doc.lines)).from : view.state.doc.length;
              view.dispatch({ selection: { anchor } });
              event.preventDefault();
              return true;
            }
          }

          // 点击公式：行内 $x$ → 光标进入后显示源码；块公式 → 光标进入后由 blocks.ts 弹浮层
          // （blocks.ts 的浮层触发为严格内部判定：键盘导航停在边界不弹，仅点击进入）
          // 必须返回 true：阻止 CM6 mouseup 按旧坐标把光标重定位回边界（会关掉浮层）
          const math = target.closest?.(".md-math") as HTMLElement | null;
          if (math && !math.classList.contains("md-formula-editor")) {
            const pos = view.posAtDOM(math, 0);
            const anchor = Math.min(pos + 1, view.state.doc.length);
            view.dispatch({ selection: { anchor } });
            event.preventDefault();
            return true;
          }

          // 点击行内 <br/> → 光标移入标签区间，显示 <br/> 源码
          const br = target.closest?.(".md-inline-br") as HTMLElement | null;
          if (br) {
            const pos = view.posAtDOM(br, 0);
            view.dispatch({ selection: { anchor: Math.min(pos + 1, view.state.doc.length) } });
            event.preventDefault();
            return true;
          }

          // Ctrl/Cmd + 点击链接 → 打开
          const link = target.closest?.("[data-href]") as HTMLElement | null;
          if (link && (event.ctrlKey || event.metaKey)) {
            const href = link.dataset.href;
            if (href) void openUrl(href);
            event.preventDefault();
            return true;
          }

          // 点击图片 → 光标移入该区间（显示源码）
          // 必须返回 true 阻止 CM6 默认光标处理：mousedown 后 DOM 已从 widget 变为文本，
          // mouseup 时按旧坐标计算会把光标落到相邻行（错行）
          const img = target.closest?.(".md-image-wrap");
          if (img) {
            const pos = view.posAtDOM(img, 0);
            view.dispatch({ selection: { anchor: Math.min(pos + 1, view.state.doc.length) } });
            event.preventDefault();
            return true;
          }

          // 点击分割线 → 移入区间显示源码
          const hr = target.closest?.(".md-hr");
          if (hr) {
            const pos = view.posAtDOM(hr, 0);
            view.dispatch({ selection: { anchor: Math.min(pos + 1, view.state.doc.length) } });
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
    },
  );

/** Live Preview 扩展集：渲染插件 + 原子区间。
 *  原子区间仅含 replace 装饰（隐藏标记 / 行内 widget），供方向键整体跨过；
 *  覆盖正文的 mark 装饰不能原子化，否则无法按字符定位与编辑 */
export function livePreview() {
  return [
    livePreviewPlugin,
    EditorView.atomicRanges.of(
      (view) => view.plugin(livePreviewPlugin)?.atomic ?? Decoration.none,
    ),
  ];
}
