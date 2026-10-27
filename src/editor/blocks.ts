// 块级装饰（表格整体替换 + 公式块浮层编辑 + Frontmatter 属性卡 + 原生 HTML 块渲染）
// CodeMirror 限制：插件级 ViewPlugin 的 decorations 不允许替换换行符，
// 跨行的块级 replace / block widget 必须由 StateField 提供 —— 本模块即为此而设。
//
// 公式块（$$，思源式交互）：
// · 渲染恒保持——编辑发生在浮层，不在文档内；
// · 光标进入块范围（点击公式）→ 公式块下方插入「公式块」编辑浮层
//   （widgets.ts 的 FormulaEditorWidget：标题栏 + 带行号输入区），
//   输入实时写回文档、公式原地重渲染；光标移出（点击外部 / Esc）→ 浮层消失。
// · 行内 $x$ 不走浮层：由 livepreview 在光标进入时直接显示源码。

import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { type Command, EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import {
  TableWidget,
  BlockMathWidget,
  FormulaEditorWidget,
  FrontmatterWidget,
  CodeBlockWidget,
  tableRangeAt,
} from "./widgets";
import { HTMLBlockWidget } from "./htmlblock";
import { frontmatterRange } from "./livepreview";
import { DiagramWidget, isDiagramLanguage } from "./diagram";

/** 选区与范围是否相交（无余量：光标贴边即进入） */
function touchesRange(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
}

/** 插入光标是否严格位于区间内部（边界及非空选区不算）——公式浮层触发专用：
 *  atomicRanges 使键盘导航停在公式区间边界，开区间判定确保导航不误触浮层；
 *  点击进入由 livepreview 的 mousedown handler 把光标显式放到区间内部 */
function insideRange(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.empty && r.from > from && r.from < to) return true;
  }
  return false;
}

function buildBlockDecorations(state: EditorState): DecorationSet {
  const decos: ReturnType<Decoration["range"]>[] = [];
  const fm = frontmatterRange(state);
  const fmEndPos = fm ? state.doc.line(fm[1]).to : -1;

  // ---- Frontmatter：渲染态整块替换为属性卡（Obsidian 式）；
  //      光标进入块内显示源码（livepreview 的 L_FRONT 行样式接手，含底部收口） ----
  if (fm) {
    const first = state.doc.line(fm[0]);
    const last = state.doc.line(fm[1]);
    if (!touchesRange(state, first.from, last.to)) {
      decos.push(
        Decoration.replace({
          widget: new FrontmatterWidget(state.sliceDoc(first.from, last.to)),
          block: true,
        }).range(first.from, last.to),
      );
    }
  }

  syntaxTree(state).iterate({
    enter(node) {
      const from = node.from;
      const to = node.to;
      if (fm && node.name !== "Document" && from < fmEndPos) return;

      // ---- 原生 HTML 块（GitHub 徽章行 / <p align=center> / 内嵌表格等）：
      //      恒定整块替换渲染（htmlblock.ts 白名单净化），不做光标进入显源码；
      //      编辑统一走源码模式（左下角开关 / Ctrl+/）。原子区间让方向键导航
      //      整块跨过，光标不滞留块内 ----
      if (node.name === "HTMLBlock") {
        const first = state.doc.lineAt(from);
        const last = state.doc.lineAt(Math.min(to, state.doc.length));
        decos.push(
          Decoration.replace({
            widget: new HTMLBlockWidget(state.sliceDoc(first.from, last.to)),
            block: true,
          }).range(first.from, last.to),
        );
        return;
      }

      // ---- GFM 表格：恒渲染交互件（不显源码）——单元格就地编辑 + 工具栏（widgets.ts） ----
      if (node.name === "Table") {
        const lineFrom = state.doc.lineAt(from).from;
        const lastLine = state.doc.lineAt(Math.min(to, state.doc.length));
        if (lastLine.number === from) return;
        decos.push(
          Decoration.replace({
            widget: new TableWidget(state.sliceDoc(from, to), lineFrom),
            block: true,
          }).range(lineFrom, lastLine.to),
        );
        return;
      }

      // ---- 围栏代码块：整块替换为块级 widget（内嵌横向滚动 + 块内就地编辑） ----
      if (node.name === "FencedCode") {
        const firstLine = state.doc.lineAt(from);
        const lastLine = state.doc.lineAt(Math.min(to, state.doc.length));
        // 多行围栏块才替换；单行 ```x``` 保持源码
        if (lastLine.number > firstLine.number) {
          // 围栏内容区间包含“闭围栏前的那一个换行”（结构换行），
          // 展示时去掉它，避免代码块首尾多出空行；写回时再补回。
          const contentFrom = Math.min(firstLine.to + 1, lastLine.from);
          const contentTo = lastLine.from;
          const code = state.sliceDoc(contentFrom, contentTo).replace(/\n$/, "");
          const lang = firstLine.text.replace(/^\s*```\s*/, "").trim();
          if (isDiagramLanguage(lang)) {
            decos.push(
              Decoration.replace({
                widget: new DiagramWidget(code, lang, from),
                block: true,
              }).range(firstLine.from, lastLine.to),
            );
          } else {
            decos.push(
              Decoration.replace({
                widget: new CodeBlockWidget(code, lang, from),
                block: true,
              }).range(firstLine.from, lastLine.to),
            );
          }
        }
        return;
      }

      // ---- 公式：块公式（$$）渲染恒保持 + 光标进入弹编辑浮层；
      //      行内 $x$ 由 livepreview 在光标进入时直接显源码 ----
      if (node.name === "Formula") {
        const text = state.sliceDoc(from, to);
        const isBlock = text.startsWith("$$") && text.endsWith("$$");
        const firstLine = state.doc.lineAt(from);
        const lastLine = state.doc.lineAt(Math.min(to, state.doc.length));
        const oneLine = firstLine.number === lastLine.number;

        // 跨行块：整块替换渲染（恒保持——编辑在浮层，源码行不进文档流）
        if (isBlock && !oneLine) {
          decos.push(
            Decoration.replace({
              widget: new BlockMathWidget(text.slice(2, -2).trim()),
              block: true,
            }).range(firstLine.from, lastLine.to),
          );
        }
        // 单行整行块 / 行内 $x$ 的默认渲染由 livepreview 的 MathWidget 完成；
        // 行内公式在光标进入时由 livepreview 改为源码

        // 仅块公式（$$）由浮层编辑；行内 $x$ 直接显源码，不弹浮层
        if (isBlock && insideRange(state, from, to)) {
          const ln = lastLine.number;
          const pos = ln < state.doc.lines ? state.doc.line(ln + 1).from : state.doc.line(ln).to;
          decos.push(Decoration.widget({ widget: new FormulaEditorWidget(from), block: true }).range(pos));
        }
        return;
      }

      // ---- 分割线上方空行压缩：CM6 行模型中「空行 + ---」的空行仍是独立行、占整行行高，
      //      视觉上在分割线上方多出大段空隙（思源等块模型产品仅为普通段落间距）。
      //      这里给该空行打标压成 0 高——保留空行保证「分割线」语法的同时，让分割线贴紧正文 ----
      if (node.name === "HorizontalRule") {
        const ln = state.doc.lineAt(from).number;
        if (ln > 1) {
          const prev = state.doc.line(ln - 1);
          if (!prev.text.trim()) {
            decos.push(Decoration.line({ class: "md-hr-gap" }).range(prev.from));
          }
        }
        return;
      }
    },
  });

  return Decoration.set(decos, true);
}

/** 表格/公式/Frontmatter 装饰（StateField：跨行块替换）+ 原子区间：
 *  方向键等键盘导航把 replace 区间（公式/表格块/属性卡）当整体跨过，
 *  保证浮层只在点击进入时触发，导航穿越不误触 */
const blockDecoField = StateField.define<DecorationSet>({
  create: (state) => buildBlockDecorations(state),
  update(value, tr) {
    // 未完成解析时：小预算内强制完成增量解析（通常 <1ms）再重建，
    // 避免连续键入期间装饰停在旧状态、而后续无事务触发恢复；
    // 预算仍不够（超大文档）才保留旧值映射
    const tree = ensureSyntaxTree(tr.state, tr.state.doc.length, 50);
    if (!tree) return value.map(tr.changes);
    return buildBlockDecorations(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function blockWidgets(): Extension {
  return [
    blockDecoField,
    EditorView.atomicRanges.of((view) => view.state.field(blockDecoField, false) ?? Decoration.none),
  ];
}

// ---- 方向键进出表格（Obsidian 式）：块 replace 区间是原子的，默认行为
//      一跨就整个跳过；贴邻表格的方向键在此接管，把光标交给表格交互件 ----

/** 把光标交给表格交互件：head=true 聚焦表头首列（从上迈入），false 聚焦末行首列（从下迈入）。
 *  focus 触发 widget 的 focusin → 活动格/工具栏/CM 选区同步由表格件自管 */
function focusTableCell(
  view: EditorView,
  range: { from: number; to: number },
  head: boolean,
): boolean {
  for (const el of Array.from(view.dom.querySelectorAll<HTMLElement>(".md-table-wrapper"))) {
    let pos: number;
    try {
      pos = view.posAtDOM(el, 0);
    } catch {
      continue;
    }
    if (pos < range.from || pos > range.to) continue;
    const rows = el.querySelectorAll("tr");
    const row = head ? rows[0] : rows[rows.length - 1];
    const cell = (head
      ? row?.querySelector("th[contenteditable]")
      : row?.querySelector("td[contenteditable]")) as HTMLElement | null;
    if (!cell) return false;
    cell.focus();
    return true;
  }
  return false;
}

/** ↓：当前行的下一行是表格首行 → 聚焦表头首格 */
export const tableArrowDown: Command = (view) => {
  const doc = view.state.doc;
  const line = doc.lineAt(view.state.selection.main.head);
  if (line.number >= doc.lines) return false;
  const range = tableRangeAt(view.state, doc.line(line.number + 1).from);
  if (!range || doc.line(range.from).number !== line.number + 1) return false;
  return focusTableCell(view, range, true);
};

/** ↑：当前行的上一行是表格末行 → 聚焦末行首格 */
export const tableArrowUp: Command = (view) => {
  const doc = view.state.doc;
  const line = doc.lineAt(view.state.selection.main.head);
  if (line.number <= 1) return false;
  const range = tableRangeAt(view.state, doc.line(line.number - 1).from);
  if (!range || doc.line(range.to).number !== line.number - 1) return false;
  return focusTableCell(view, range, false);
};
