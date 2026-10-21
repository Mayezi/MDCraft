// 代码块语言选择（VSCode 式）：
// 插入代码块骨架后光标停在语言位（```|），自动弹出语言选择面板；
// ↑↓ 选择、Enter 确认（选中后光标跳进代码内容行）、Esc 关闭手输；
// 不选语言直接 Enter → keymap 拦截，光标同样跳进内容行。
// 与斜杠面板共用同一套 CM6 autocomplete 交互与视觉。

import { type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { languages } from "@codemirror/language-data";
import { syntaxTree } from "@codemirror/language";
import type { Command, EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

/** 常用语言优先展示（id 小写） */
const PRIORITY = [
  "rust", "python", "javascript", "typescript", "java", "go", "sql", "shell",
  "json", "yaml", "html", "css", "xml", "markdown", "c", "cpp", "csharp",
  "kotlin", "swift", "php", "ruby", "toml", "ini", "diff", "dockerfile",
];

interface LangDef {
  /** 语言标识（写入 ``` 后面的值，如 rust） */
  id: string;
  /** 展示全名（如 Rust） */
  name: string;
  /** 全部别名（含 name 小写）：过滤用。language-data 部分 alias 含空格
   *  （ms sql / tiki wiki…），info string 合法，保留但排序靠后 */
  aliases: string[];
}

/** 语言列表：来自 @codemirror/language-data（与代码高亮同一数据源）。
 *  id 规范化：name/alias 命中 PRIORITY 规范名（如 JavaScript 项的 alias[0]
 *  是 "js"）优先用规范名，避免列表里找不到 javascript 这类常见语言；
 *  其余用 name 小写；按 PRIORITY 优先 + 字母序稳定排列，去重 */
export const FENCE_LANGS: LangDef[] = (() => {
  const seen = new Set<string>();
  const out: LangDef[] = [];
  for (const d of languages) {
    const names = [d.name.toLowerCase(), ...(d.alias ?? []).map((a) => a.toLowerCase())];
    let id = names.find((n) => PRIORITY.includes(n)); // 规范名优先
    if (!id) {
      // name 本身可用则用 name（如 "Python"→python），否则首个 alias
      id = /^[a-z0-9+#._-]+$/.test(names[0]) ? names[0] : (names[1] ?? names[0]);
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: d.name, aliases: names });
  }
  const rank = (l: LangDef) => {
    const i = PRIORITY.indexOf(l.id);
    if (i !== -1) return i;
    // 含空格的非规范 id（ms sql 等）排列表尾部：合法但观感次优
    return /^[a-z0-9+#._-]+$/.test(l.id) ? PRIORITY.length : PRIORITY.length + 1;
  };
  out.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  return out;
})();

/** 语言位判定：行形如 ```lang，光标在语言词内（含首尾；打字覆盖/行尾输入都触发） */
function fenceLangAt(ctx: CompletionContext): { from: number; to: number; query: string } | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  if (ctx.pos !== line.to) return null; // 仅语言词尾（输入位置）
  const m = /^```([A-Za-z0-9+#._-]*)$/.exec(before);
  if (!m) return null;
  const from = line.from + 3;
  return { from, to: ctx.pos, query: m[1].toLowerCase() };
}

/** 语言选择补全源（挂到与斜杠面板同一个 autocompletion 的 override 数组）
 *  显式唤起（点击 tag / 插入新块）→ 全列表（apply 替换整个语言词）；
 *  打字激活 → 按已输入前缀过滤 */
export const fenceLangSource: CompletionSource = (ctx) => {
  const at = fenceLangAt(ctx);
  if (!at) return null;
  const q = ctx.explicit ? "" : at.query;
  const list = FENCE_LANGS.filter(
    (l) => !q || l.id.includes(q) || l.name.toLowerCase().includes(q) || l.aliases.some((a) => a.includes(q)),
  );
  if (!list.length) return null;

  const options: Completion[] = list.map((l) => ({
    label: l.id,
    detail: l.name === l.id ? "代码" : l.name,
    type: "code", // 复用斜杠面板 md-si-code 图标
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      view.dispatch({
        changes: { from, to, insert: l.id },
        // 光标跳到代码内容行（```lang\n 之后）
        selection: { anchor: from + l.id.length + 1 },
      });
    },
  }));
  // 过滤由本 source 全权负责（同斜杠面板的理由：库默认模糊匹配行为不可控）
  return { from: at.from, options, filter: false };
};

/** fence 首行（```lang）行尾按 Enter/Tab → 光标跳进代码内容行
 *  双轨语言确认（思源同款自由输入）：面板有选中项 → apply 预置语言；
 *  面板无匹配/已关闭 → 保留手输入的语言原文（任意自定义语言均合法） */
export const fenceEnterCommand: Command = (view) => {
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  if (head !== line.to) return false;
  if (!/^```[A-Za-z0-9+#._-]*$/.test(line.text)) return false;
  if (line.number >= view.state.doc.lines) return false; // 无内容行（文档末尾裸 ```）
  const next = view.state.doc.line(line.number + 1);
  view.dispatch({ selection: { anchor: next.from }, scrollIntoView: true });
  return true;
};

/** 语言行 Tab = Enter 同款确认（面板选中→应用预置；否则保留手输词跳内容行） */
export const fenceTabCommand: Command = (view) => {
  // 面板打开时 Tab 由 autocomplete 优先消费（acceptCompletion），不达此处
  return fenceEnterCommand(view);
};

// ---------- 光标跳块（思源式进出代码块） ----------
// fence 定界行是隐藏薄条（12px），光标若落在其上：闪烁竖线与块底线重叠、
// 且看不见所在内容。↓/↑/Enter 拦截：直接跨过薄条行进出块。

/** 覆盖 lineNo 的 FencedCode 范围（返回首尾 fence 行号） */
function fenceAt(state: EditorState, lineNo: number): { first: number; last: number } | null {
  let res: { first: number; last: number } | null = null;
  syntaxTree(state).iterate({
    enter(n) {
      if (n.name === "FencedCode") {
        const f = state.doc.lineAt(n.from).number;
        const l = state.doc.lineAt(Math.min(n.to, state.doc.length)).number;
        if (lineNo >= f && lineNo <= l) res = { first: f, last: l };
      }
    },
  });
  return res;
}

/** 跳到目标行行首（含滚动） */
function jumpToLineNo(view: EditorView, lineNo: number): boolean {
  const n = Math.max(1, Math.min(lineNo, view.state.doc.lines));
  const anchor = view.state.doc.line(n).from;
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  return true;
}

/** ↓：fence 底条行 / 内容末行行尾 → 跳到块外下一行；fence 顶条行 → 跳内容首行 */
export const fenceJumpDown: Command = (view) => {
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  const f = fenceAt(view.state, line.number);
  if (!f) return false;
  if (line.number === f.last) return jumpToLineNo(view, line.number + 1);
  if (line.number === f.last - 1 && head === line.to) return jumpToLineNo(view, f.last + 1);
  if (line.number === f.first) return jumpToLineNo(view, f.first + 1);
  return false;
};

/** ↑：fence 顶条行 / 内容首行行首 → 跳到块外上一行；fence 底条行 → 跳内容末行 */
export const fenceJumpUp: Command = (view) => {
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  const f = fenceAt(view.state, line.number);
  if (!f) return false;
  if (line.number === f.first) return jumpToLineNo(view, line.number - 1);
  if (line.number === f.first + 1 && head === line.from) return jumpToLineNo(view, f.first - 1);
  if (line.number === f.last) return jumpToLineNo(view, f.last - 1);
  return false;
};

/** Enter：fence 底条行 → 跳到块外（防止在隐形行内换行弄坏结构） */
export const fenceEscape: Command = (view) => {
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  const f = fenceAt(view.state, line.number);
  if (!f || line.number !== f.last) return false;
  return jumpToLineNo(view, line.number + 1);
};
