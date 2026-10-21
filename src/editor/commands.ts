// Markdown 编辑命令：加粗/斜体/删除线/行内代码/链接/公式/标题层级/表格插入
// 逻辑对齐主流编辑器习惯：光标在词中按 Ctrl+B 直接加粗整词；重复按同一级标题 = 清除

import { EditorSelection, type EditorState } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import { focusCodeBlockEditor } from "./widgets";

/** 词范围扩展：空选择时自动选中光标所在单词 */
function effectiveRange(state: EditorState, from: number, to: number) {
  if (from !== to) return { from, to };
  const word = state.wordAt(from);
  if (word && !/\s/.test(state.sliceDoc(word.from, word.to))) return { from: word.from, to: word.to };
  return { from, to };
}

/** 切换包裹语法（** * ~~ ` $），再次执行则取消 */
export function toggleWrap(view: EditorView, open: string, close = open): boolean {
  const tr = view.state.changeByRange((range) => {
    const { from, to } = effectiveRange(view.state, range.from, range.to);

    // 场景 A：选区两侧已有相同标记 → 移除
    const before = view.state.sliceDoc(Math.max(0, from - open.length), from);
    const after = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + close.length));
    if (before === open && after === close) {
      return {
        changes: [
          { from: from - open.length, to: from },
          { from: to, to: to + close.length },
        ],
        range: EditorSelection.range(from - open.length, to - open.length),
      };
    }

    // 场景 B：选中文本本身带完整包裹 → 去掉内层包裹
    const text = view.state.sliceDoc(from, to);
    if (
      text.length >= open.length + close.length &&
      text.startsWith(open) &&
      text.endsWith(close)
    ) {
      const inner = text.slice(open.length, text.length - close.length);
      return {
        changes: { from, to, insert: inner },
        range: EditorSelection.range(from, from + inner.length),
      };
    }

    // 场景 C：空选择 → 插入占位并选中，便于直接输入
    if (from === to) {
      const placeholder = "文本";
      const insert = open + placeholder + close;
      return {
        changes: { from, insert },
        range: EditorSelection.range(from + open.length, from + open.length + placeholder.length),
      };
    }

    // 场景 D：普通包裹
    return {
      changes: [
        { from, insert: open },
        { from: to, insert: close },
      ],
      range: EditorSelection.range(from + open.length, to + open.length),
    };
  });
  view.dispatch(tr);
  return true;
}

/** 插入链接：有选区 → [选区](url)；无选区 → [](url) 光标停在文本处 */
export function insertLink(view: EditorView): boolean {
  const tr = view.state.changeByRange((range) => {
    const text = range.empty ? "链接文字" : view.state.sliceDoc(range.from, range.to);
    const insert = `[${text}](https://)`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(
        range.from + text.length + 3,
        range.from + text.length + 3 + 8,
      ),
    };
  });
  view.dispatch(tr, { scrollIntoView: true });
  return true;
}

/** 插入行内公式 */
export function insertInlineMath(view: EditorView): boolean {
  return toggleWrap(view, "$");
}

/** 插入块级公式 */
export function insertBlockMath(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const useBlank = line.text.trim() !== "" ? "\n\n" : "";
  view.dispatch({
    changes: { from: pos, insert: `${useBlank}$$\n\n$$\n` },
    selection: { anchor: pos + useBlank.length + 3 },
  });
  return true;
}

/** 设置标题层级（0 = 清除，同级别重复按 = 切换清除） */
export function setHeading(level: number): Command {
  return (view) => {
    const changes: { from: number; to?: number; insert?: string }[] = [];
    const seen = new Set<number>();
    for (const r of view.state.selection.ranges) {
      const first = view.state.doc.lineAt(r.from).number;
      const last = view.state.doc.lineAt(r.to).number;
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = view.state.doc.line(n);
        const m = /^(#{1,6} +)/.exec(line.text);
        const current = m ? m[1].trim().length : 0;
        const target = current === level ? 0 : level;
        if (target === 0) {
          if (m) changes.push({ from: line.from, to: line.from + m[1].length });
        } else {
          const prefix = "#".repeat(target) + " ";
          if (m) changes.push({ from: line.from, to: line.from + m[1].length, insert: prefix });
          else changes.push({ from: line.from, insert: prefix });
        }
      }
    }
    if (!changes.length) return false;
    view.dispatch({ changes });
    return true;
  };
}

/** 插入表格（行 × 列，含表头） */
export function insertTable(view: EditorView, rows: number, cols: number): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const head = line.text.trim() !== "" ? "\n" : "";
  const mkRow = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const out: string[] = [];
  const headers = Array.from({ length: cols }, (_, i) => `列${i + 1}`);
  const sep = Array.from({ length: cols }, () => "---");
  out.push(mkRow(headers));
  out.push(mkRow(sep));
  for (let r = 1; r < Math.max(rows, 1); r++) {
    out.push(mkRow(Array.from({ length: cols }, () => " ")));
  }
  const insert = `${head}${out.join("\n")}\n`;
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + head.length + out[0].length + 1 },
  });
  return true;
}

/** 插入代码块骨架，并直接聚焦块内 contenteditable；
 *  语言在代码块左上角点击切换（不再先强制选语言，避免插入后停在语言位） */
export function insertFence(view: EditorView, lang = ""): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const head = line.text.trim() !== "" ? "\n" : "";
  const fenceStart = pos + head.length;
  const contentStart = fenceStart + 3 + lang.length + 1;
  view.dispatch({
    changes: { from: pos, insert: `${head}\`\`\`${lang}\n\n\`\`\`\n` },
    selection: { anchor: contentStart },
    scrollIntoView: true,
  });
  // 装饰/widget 渲染是异步的，内部会 rAF 重试直到找到 .md-code-edit
  focusCodeBlockEditor(view, fenceStart);
  return true;
}

export const boldCommand: Command = (v) => toggleWrap(v, "**");
export const italicCommand: Command = (v) => toggleWrap(v, "*");
export const strikeCommand: Command = (v) => toggleWrap(v, "~~");
export const codeCommand: Command = (v) => toggleWrap(v, "`");
export const highlightCommand: Command = (v) => toggleWrap(v, "==");
export const underlineCommand: Command = (v) => toggleWrap(v, "<u>", "</u>");

// ---------- 列表 / 引用行前缀切换（斜杠面板与段落菜单共用） ----------

type PrefixKind = "bullet" | "ordered" | "task" | "quote";

/** 解析行首结构：缩进 + 既有前缀类型与长度 */
function parsePrefix(text: string): { indent: number; type: PrefixKind | null; len: number } {
  const indent = /^ */.exec(text)![0].length;
  const rest = text.slice(indent);
  const task = /^[-*+] \[[ xX]\] /.exec(rest);
  if (task) return { indent, type: "task", len: task[0].length };
  const bullet = /^[-*+] /.exec(rest);
  if (bullet) return { indent, type: "bullet", len: bullet[0].length };
  const ordered = /^\d+\. /.exec(rest);
  if (ordered) return { indent, type: "ordered", len: ordered[0].length };
  const quote = /^> ?/.exec(rest);
  if (quote) return { indent, type: "quote", len: quote[0].length };
  return { indent, type: null, len: 0 };
}

/**
 * 切换行前缀：同类再按取消；异类替换；引用插入时保留列表前缀。
 * 有序列表对选区连续行重编号（1. 2. 3. …）。
 */
export function toggleLinePrefix(kind: PrefixKind): Command {
  return (view) => {
    const changes: { from: number; to?: number; insert?: string }[] = [];
    const seen = new Set<number>();
    let counter = 0;
    for (const r of view.state.selection.ranges) {
      const first = view.state.doc.lineAt(r.from).number;
      const last = view.state.doc.lineAt(r.to).number;
      if (r.from !== r.to || first === last) counter = 0; // 每个独立选区重新编号
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = view.state.doc.line(n);
        const p = parsePrefix(line.text);
        const start = line.from + p.indent;

        if (kind === "quote") {
          // 引用：已有 > 取消；其他前缀保留，仅在最前插入
          if (p.type === "quote") changes.push({ from: start, to: start + p.len, insert: "" });
          else changes.push({ from: start, insert: "> " });
          continue;
        }

        if (p.type === kind) {
          changes.push({ from: start, to: start + p.len, insert: "" }); // 取消
        } else {
          const insert =
            kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${++counter}. `;
          // 引用行切换列表：连同 > 一起替换；其他列表互换；裸行直接加
          const consume = p.type === null ? 0 : p.len;
          changes.push({ from: start, to: start + consume, insert });
        }
      }
    }
    if (!changes.length) return false;
    view.dispatch({ changes });
    return true;
  };
}

// ---------- 标题层级平移 ----------

/** 提升标题（-1）：普通行 → H1，Hn → H(n-1)；降低标题（+1）：H6 → 普通行 */
export function shiftHeading(dir: -1 | 1): Command {
  return (view) => {
    const changes: { from: number; to?: number; insert?: string }[] = [];
    const seen = new Set<number>();
    for (const r of view.state.selection.ranges) {
      const first = view.state.doc.lineAt(r.from).number;
      const last = view.state.doc.lineAt(r.to).number;
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = view.state.doc.line(n);
        const m = /^(#{1,6} +)/.exec(line.text);
        const current = m ? m[1].trim().length : 0;
        let target: number;
        if (dir === -1) target = current === 0 ? 1 : Math.max(current - 1, 1);
        else {
          if (current === 0) continue; // 普通行降低无意义
          target = current + 1 > 6 ? 0 : current + 1;
        }
        if (target === 0) {
          if (m) changes.push({ from: line.from, to: line.from + m[1].length });
        } else {
          const prefix = "#".repeat(target) + " ";
          if (m) changes.push({ from: line.from, to: line.from + m[1].length, insert: prefix });
          else changes.push({ from: line.from, insert: prefix });
        }
      }
    }
    if (!changes.length) return false;
    view.dispatch({ changes });
    return true;
  };
}

// ---------- 块级插入 ----------

/** 分割线：空行替换为 ---，非空行下一段插入 */
export function insertHr(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  if (line.text.trim() === "") {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: "---" } });
  } else {
    view.dispatch({
      changes: { from: line.to, insert: "\n\n---" },
      selection: { anchor: line.to + 1 },
    });
  }
  return true;
}

/** 插入 [toc] 目录标记行 */
export function insertToc(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  if (line.text.trim() === "") {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: "[toc]" } });
  } else {
    view.dispatch({
      changes: { from: line.to, insert: "\n\n[toc]" },
      selection: { anchor: line.to + 1 },
    });
  }
  return true;
}

/** 插入 Front Matter 骨架（文档已有则不动） */
export function insertFrontMatter(view: EditorView): boolean {
  const first = view.state.doc.line(1);
  if (first.text.trim() === "---") return false;
  view.dispatch({
    changes: { from: 0, insert: "---\ntitle: \n---\n\n" },
    selection: { anchor: 11 }, // title 值处
  });
  return true;
}

/** 插入图片：有选区作 alt，光标选中 url 占位 */
export function insertImage(view: EditorView): boolean {
  const tr = view.state.changeByRange((range) => {
    const text = range.empty ? "alt" : view.state.sliceDoc(range.from, range.to);
    const insert = `![${text}](url)`;
    const urlStart = range.from + 2 + text.length + 2;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });
  view.dispatch(tr, { scrollIntoView: true });
  return true;
}

// ---------- 上标 / 下标 ----------
// 与删除线（~~）区分：~ 两端外侧无同类字符时才视为成对下标标记

export function toggleSubSup(view: EditorView, mark: "~" | "^"): boolean {
  const tr = view.state.changeByRange((range) => {
    const { from, to } = effectiveRange(view.state, range.from, range.to);
    const st = view.state;
    const chBefore = st.sliceDoc(Math.max(0, from - 1), from);
    const chAfter = st.sliceDoc(to, Math.min(st.doc.length, to + 1));
    if (chBefore === mark && chAfter === mark) {
      const before2 = st.sliceDoc(Math.max(0, from - 2), from - 1);
      const after2 = st.sliceDoc(to + 1, Math.min(st.doc.length, to + 2));
      if (before2 !== mark && after2 !== mark) {
        return {
          changes: [
            { from: from - 1, to: from },
            { from: to, to: to + 1 },
          ],
          range: EditorSelection.range(from - 1, to - 1),
        };
      }
    }
    const text = st.sliceDoc(from, to);
    if (text.length >= 2 && text.startsWith(mark) && text.endsWith(mark)) {
      const inner = text.slice(1, -1);
      return {
        changes: { from, to, insert: inner },
        range: EditorSelection.range(from, from + inner.length),
      };
    }
    if (from === to) {
      return {
        changes: { from, insert: mark + "内容" + mark },
        range: EditorSelection.range(from + 1, from + 3),
      };
    }
    return {
      changes: [
        { from, insert: mark },
        { from: to, insert: mark },
      ],
      range: EditorSelection.range(from + 1, to + 1),
    };
  });
  view.dispatch(tr);
  return true;
}

export const subCommand: Command = (v) => toggleSubSup(v, "~");
export const supCommand: Command = (v) => toggleSubSup(v, "^");

// ---------- 清除格式 ----------

const PAIR_RE = /(\*\*|==|~~|\*|`|\$|\^|~)(.+?)\1/g;

/** 清除选区内所有行内格式标记（含嵌套，三轮展开） */
export function clearFormat(view: EditorView): boolean {
  const tr = view.state.changeByRange((range) => {
    if (range.empty) return { range };
    const text = view.state.sliceDoc(range.from, range.to);
    let out = text;
    for (let i = 0; i < 3; i++) {
      out = out.replace(/<u>([\s\S]*?)<\/u>/g, "$1");
      out = out.replace(PAIR_RE, "$2");
    }
    if (out === text) return { range };
    return {
      changes: { from: range.from, to: range.to, insert: out },
      range: EditorSelection.range(range.from, range.from + out.length),
    };
  });
  view.dispatch(tr);
  return true;
}
