// 列表缩进（Tab / Shift+Tab）：Markdown 语义缩进 + 有序序号维护（主流编辑器行为）
//
// 缩进单位 = 行内列表标记宽度（标记符 + 一个空格，即 CommonMark 标记内容列）：
//   "- " = 2；"1. " = 3；"10) " = 4 —— 固定 +2 无法使有序标记形成子级（内容列 ≥ 3）。
//
// 有序序号维护：
//   · 缩进/反缩进后，该项序号 = 上方最近「同级有序项」+ 1；无则从 1 开始（新嵌套列表），
//     例：[1. 2. 3.] 中 Tab 第二项 → 1. / ␣␣␣1. / 2.（第三项自动补位重排）；
//   · 该项离开原层级后，原层级中位于其后的同级有序项依次补位重排（前一项 + 1）；
//   · 列表项的续行与子列表随项整体平移（相对层级与内部编号不变）。
//
// 非列表行返回 false，放行 CodeMirror 原生 indentWithTab。

import { type Command, type EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** 列表标记行结构 */
interface ListLine {
  indent: number;
  ordered: boolean;
  num: number; // 有序序号；无序为 0
  delim: string; // 有序分隔符 "." / ")"；无序即标记符
  markLen: number; // 标记符 + 其后空格（缩进一级的空格数）
}

const LIST_RE = /^( *)(?:([-*+])|(\d{1,9})([.)])) /;

function parseListLine(text: string): ListLine | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  const ordered = m[3] !== undefined;
  return {
    indent: m[1].length,
    ordered,
    num: ordered ? Number(m[3]) : 0,
    delim: ordered ? m[4] : m[2],
    markLen: ordered ? m[3].length + m[4].length + 1 : m[2].length + 1,
  };
}

/** pos 是否位于列表项范围内（含续行/子项） */
function inListItem(state: EditorState, pos: number): boolean {
  let found = false;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter(n) {
      if (n.name === "ListItem") found = true;
    },
  });
  return found;
}

/** 包含 pos 的最内层 ListItem 文档范围 [from, to]（嵌套时取最深：前序遍历最后覆盖） */
function listItemRange(state: EditorState, pos: number): { from: number; to: number } | null {
  let range: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter(n) {
      if (n.name === "ListItem") range = { from: n.from, to: n.to };
    },
  });
  return range;
}

/** 选区涉及的去重行号（升序） */
function selectedLines(view: EditorView): number[] {
  const seen = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(r.from).number;
    const last = view.state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/** 自 lineNo-1 向上找「缩进 == indent」层的最近有序项序号；
 *  同级换型（无序标记）或跨出列表 → null（新列表应从 1 开始） */
function prevOrderedNum(
  textAt: (n: number) => string,
  inList: (n: number) => boolean,
  lineNo: number,
  indent: number,
): number | null {
  for (let n = lineNo - 1; n >= 1; n--) {
    const t = textAt(n);
    if (t.trim() === "") continue; // 松散列表空行：继续向上
    const p = parseListLine(t);
    if (!p) {
      if (inList(n)) continue; // 项内续行：跳过
      return null; // 列表外块（段落/代码块）：链断
    }
    if (p.indent < indent) return null; // 上层项：indent 层尚未开始
    if (p.indent === indent) return p.ordered ? p.num : null;
    // 更深子级：跳过继续向上
  }
  return null;
}

/** 公共实现：dir=+1 缩进一级 / -1 反缩进一级（含序号维护与子树平移） */
function indentBy(view: EditorView, dir: 1 | -1): boolean {
  const state = view.state;
  const doc = state.doc;
  const total = doc.lines;

  const selAll = selectedLines(view);
  const lines = selAll.filter((n) => inListItem(state, doc.line(n).from));
  if (!lines.length) return false;

  const selSet = new Set(selAll); // 用户显式选中的行：子树平移须跳过，留待独立处理
  const memo = new Map<number, string>(); // 已变更行的新文本（级联判定用）
  const textAt = (n: number) => memo.get(n) ?? doc.line(n).text;
  const inList = (n: number) => inListItem(state, doc.line(n).from);

  const changes: { from: number; to: number; insert: string }[] = [];
  /** 行首替换（缩进/序号都作用于前导段；序号宽度变化天然安全） */
  const replaceHead = (n: number, head: string, headLen: number) => {
    const line = doc.line(n);
    changes.push({ from: line.from, to: line.from + headLen, insert: head });
    memo.set(n, head + line.text.slice(headLen));
  };

  const subtree = new Set<number>(); // 被整树平移过的行（补位重排须跳过）

  // ---- Pass 1：选区行逐行处理（升序，级联可见） ----
  let firstMark: { line: number; cur: number } | null = null; // 首个标记行 = 补位重排的原层基准
  let lastLine = 0;
  let moved = false; // 是否发生层级移动

  for (const n of lines) {
    lastLine = Math.max(lastLine, n);
    const text = textAt(n);
    const p = parseListLine(text);
    if (!p) {
      // 项内续行：仅平移 ±2（无标记可依，维持原语义）
      const lead = /^( *)/.exec(text)![1].length;
      const next = Math.max(0, lead + dir * 2);
      if (next !== lead) replaceHead(n, " ".repeat(next), lead);
      continue;
    }
    if (!firstMark) firstMark = { line: n, cur: p.indent };

    const unit = p.markLen;
    const nextIndent = Math.max(0, p.indent + dir * unit);
    if (nextIndent !== p.indent) moved = true;

    // 新序号：上方最近同级有序项 + 1；无则 1（新列表）
    if (p.ordered) {
      const newNum = (prevOrderedNum(textAt, inList, n, nextIndent) ?? 0) + 1;
      replaceHead(n, " ".repeat(nextIndent) + newNum + p.delim + " ", p.indent + p.markLen);
    } else if (nextIndent !== p.indent) {
      // 无序：平移并保留原标记（含任务项 "- [ ]" 前缀）
      replaceHead(n, " ".repeat(nextIndent) + text.slice(p.indent, p.indent + unit), p.indent + unit);
    }

    // 子树跟随：所在列表项范围内的续行/子列表同步平移 unit（选区行除外）
    const range = listItemRange(state, doc.line(n).from);
    if (range) {
      const endLine = doc.lineAt(Math.max(range.from, range.to - 1)).number;
      for (let m = n + 1; m <= endLine; m++) {
        if (selSet.has(m) || subtree.has(m)) continue;
        const t = doc.line(m).text;
        if (t.trim() === "") continue;
        subtree.add(m);
        const lead = /^( *)/.exec(t)![1].length;
        const nl = Math.max(0, lead + dir * unit);
        if (nl !== lead) replaceHead(m, " ".repeat(nl), lead);
      }
    }
  }

  // ---- Pass 2：原层级补位重排（该项离开后，后方同级有序项依次前移编号） ----
  if (firstMark && moved) {
    const target = firstMark.cur;
    let num = (prevOrderedNum(textAt, inList, firstMark.line, target) ?? 0) + 1;
    for (let m = lastLine + 1; m <= total; m++) {
      if (subtree.has(m) || selSet.has(m)) continue;
      const t = textAt(m);
      if (t.trim() === "") continue;
      const q = parseListLine(t);
      if (!q) {
        if (inList(m)) continue; // 项内续行：跳过
        break; // 列表外块：链止
      }
      if (q.indent < target) break; // 更浅层：原层级已结束
      if (q.indent > target) continue; // 更深子级：不动（编号独立）
      if (!q.ordered) break; // 同级换型：链止
      replaceHead(m, " ".repeat(q.indent) + num + q.delim + " ", q.indent + q.markLen);
      num++;
    }
  }

  if (!changes.length) return true; // 已到边界（如 0 缩进 outdent）：视为已处理，不再吞外层 Tab
  view.dispatch({ changes });
  return true;
}

export const listIndentCommand: Command = (view) => indentBy(view, 1);
export const listOutdentCommand: Command = (view) => indentBy(view, -1);
