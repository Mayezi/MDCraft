// Live Preview 使用的 DOM 小部件（公式 / 图片 / 分割线 / 任务复选框 / 公式编辑浮层）

import { WidgetType, type EditorView } from "@codemirror/view";
import { syntaxTree, ensureSyntaxTree, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { redo, undo } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import { highlightCode } from "@lezer/highlight";
import type { Parser } from "@lezer/common";
import katex from "katex";
import { imageSrc } from "./image";
import { openUrl } from "../lib/backend";
import { codeHighlight } from "./code-highlight";
import { FENCE_LANGS } from "./fence-lang";
import {
  markSourceRange,
  renderInlineMarkdown,
  sourceOffsetAtPoint,
  sourcePointAtOffset,
} from "./inline-render";

// ---------- 思源式交互表格（块级 widget） ----------
// 表格整体替换为可编辑件：单元格未聚焦时按行内 Markdown 渲染，聚焦后切回
// 该格纯文本源码（contenteditable plaintext-only），失焦恢复渲染。
// 编辑流 = DOM 单元格 → 模型 → 重序列化 GFM → 写回文档；
// 写回触发装饰重建，eq 仅按块起点判等（同 FormulaEditorWidget）→ DOM 保留，
// 焦点 / IME 组合不丢；外部修改（undo、查找替换）在下次交互时 resync 按文档核对。
// 键盘语义（Notion/Excel 式）：Tab 跨格（末格续行）、Enter 当前行下方新起一行、
// Alt+Enter 单元格内换行（序列化为 <br>，GFM 兼容纯文本结构不丢）、
// Shift+Enter 跳出表格；上下键先在本格多行间移动再跨行；
// 悬停浮现行列抓手可拖拽重排（行列顺序调整，模型与写回同步）。

type TableModel = { aligns: string[]; rows: string[][] };

/** 单元格转义（空格兜底保证空单元格写出仍有可读的 | 空隙）；
 *  单元格内换行序列化为 <br>（GFM 兼容，GitHub/Obsidian 等同样渲染为换行，
 *  纯文本 Markdown 结构不丢失；字面 <br> 文本在解析端同样按换行处理，往返一致） */
const escCell = (s: string) => escapePipe(s).replace(/\n/g, "<br>") || " ";
const escapePipe = (s: string) => s.replace(/\|/g, "\\|");
const unescapePipe = (s: string) => s.replace(/\\\|/g, "|");

/** GFM 表格 → 模型：列数以首行（表头）为准，短行补齐、长行截断（同 GitHub 渲染语义）；
 *  对齐取分隔行；无分隔行时按左对齐合成（写回时自动补出合法表格） */
function parseTableModel(src: string): TableModel {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  const splitCells = (line: string) =>
    line.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => unescapePipe(c.trim()));
  const aligns: string[] = [];
  const rows: string[][] = [];
  for (const line of lines) {
    const cells = splitCells(line);
    if (rows.length === 1 && cells.every((c) => /^:?-+:?$/.test(c))) {
      // 分隔行（仅紧跟表头行才成立，孤立的横线行是段落/主题分隔符，不在此逻辑内）
      aligns.push(
        ...cells.map((c) =>
          c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left",
        ),
      );
      continue;
    }
    rows.push(cells);
  }
  if (!rows.length) rows.push([""]);
  const cols = Math.max(rows[0].length, 1);
  for (const r of rows) {
    while (r.length < cols) r.push("");
    if (r.length > cols) r.length = cols;
  }
  while (aligns.length < cols) aligns.push("left");
  aligns.length = cols;
  return { aligns, rows };
}

function serializeTable(m: TableModel): string {
  const row = (cells: string[]) => `| ${cells.map(escCell).join(" | ")} |`;
  const sep = m.aligns
    .map((a) => (a === "center" ? ":---:" : a === "right" ? "---:" : "---"))
    .join("|");
  const [head, ...rest] = m.rows;
  return [row(head), `| ${sep} |`, ...rest.map(row)].join("\n");
}

/** 定位覆盖 start 位置的 Table 节点（挖内层 + 爬父链），供写回取替换区间。
 *  结构护栏：解析出的区间必须「至少两行且每行都以 | 起始」——语法树边界一旦异常
 *  （把段落/代码块等并进同一 Table 节点），写回/删表会把大段内容替换掉，宁可不写。
 *  导出供 blocks.ts 方向键进出表格判定共用 */
export function tableRangeAt(state: EditorState, start: number): { from: number; to: number } | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  // el 结构最小集（SyntaxNode 可赋值给 Climb，避免 import @lezer/common 类型）
  type Climb = { name: string; from: number; to: number; parent: Climb | null };
  let n: Climb = tree.resolveInner(start, 1);
  while (n.name !== "Table") {
    if (!n.parent) return null;
    n = n.parent;
  }
  const lines = state.sliceDoc(n.from, n.to).split("\n");
  if (lines.length < 2 || lines.some((l) => !/^\s*\|/.test(l))) return null;
  return { from: n.from, to: n.to };
}

/** 表格挂载的全局监听清理表（widget DOM 被销毁时移除 scroll / pointerdown 监听） */
const scrollCleanups = new WeakMap<HTMLElement, () => void>();

/** GFM 表格交互件（块级 widget，StateField 提供） */
export class TableWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly start: number,
  ) {
    super();
  }
  /** eq 仅按块起点判等：编辑写回重建装饰时 DOM 复用，焦点 / IME 不丢 */
  eq(other: TableWidget) {
    return other.start === this.start;
  }
  /** 装饰移除（widget DOM 销毁）时清理工具栏重锚的 capture scroll 监听 */
  destroy(dom: Node) {
    const el = dom as HTMLElement;
    scrollCleanups.get(el)?.();
    scrollCleanups.delete(el);
  }
  toDOM(view: EditorView) {
    const model = parseTableModel(this.src);
    // 写回后的文档文本基准：resync 以它核对是否有外部改动
    let lastSrc = this.src;
    // 活动单元格（工具栏行列 / 对齐操作的基准）；focusin 更新
    let act: { r: number; c: number } | null = null;

    const wrap = document.createElement("div");
    wrap.className = "md-table-wrapper md-gutter md-gutter-hover";
    wrap.dataset.btype = "table";
    const bar = document.createElement("div");
    bar.className = "md-table-toolbar";
    const table = document.createElement("table");
    table.className = "md-table";
    const tbody = document.createElement("tbody");
    table.append(tbody);
    wrap.append(bar, table);

    const allCells = () =>
      Array.from(tbody.querySelectorAll<HTMLElement>("th[contenteditable],td[contenteditable]"));

    /** 元素 → { 行, 列 }（首行 = 表头） */
    const idxOf = (el: Element) => {
      const tr = el.closest("tr");
      const r = tr ? Array.prototype.indexOf.call(tbody.children, tr) : -1;
      return r < 0 ? null : { r, c: (el as HTMLTableCellElement).cellIndex };
    };
    const cellFrom = (t: EventTarget | null) => {
      const el = t instanceof Element ? t.closest("th,td") : null;
      return el && wrap.contains(el) ? (el as HTMLElement) : null;
    };

    // ---- 列宽（思源式）：默认自动布局；首次拖列宽时把实测像素固化，
    // 切换 table-layout:fixed + <colgroup> 接管。列宽是会话级装饰、不写回
    // Markdown（纯文本语法无列宽表达，思源导出同样丢弃）——重建走 renderAll 复原 ----
    let widths: number[] | null = null;
    const applyWidths = () => {
      if (!widths) return;
      table.style.tableLayout = "fixed";
      table.classList.add("md-table-fixed");
      let cg = table.querySelector("colgroup");
      if (!cg) {
        cg = document.createElement("colgroup");
        table.insertBefore(cg, tbody);
      }
      cg.replaceChildren(
        ...widths.map((w) => {
          const col = document.createElement("col");
          col.style.width = `${w}px`;
          return col;
        }),
      );
    };
    const ensureWidths = () => {
      if (widths) return;
      widths = Array.from(
        (tbody.children[0] as HTMLTableRowElement).children,
        (c) => Math.round(c.getBoundingClientRect().width),
      );
      applyWidths();
    };

    /** 聚焦并放置光标（atEnd = false 置于行首） */
    const focusCell = (cell: HTMLElement, atEnd = true) => {
      cell.focus();
      const sel = document.getSelection();
      if (!sel) return;
      const rng = document.createRange();
      rng.selectNodeContents(cell);
      rng.collapse(!atEnd);
      sel.removeAllRanges();
      sel.addRange(rng);
    };
    const focusAt = (rc: { r: number; c: number }) => {
      const tr = tbody.children[rc.r] as HTMLTableRowElement | undefined;
      const cell = tr?.children[Math.max(0, Math.min(rc.c, (tr?.children.length ?? 1) - 1))] as
        | HTMLElement
        | undefined;
      if (cell) focusCell(cell);
    };
    /** 工具栏跟随活动单元格：浮于被点单元格上方（水平钳制在表格内），不再恒定右上角 */
    const placeToolbar = () => {
      if (!act) return;
      const tr = tbody.children[act.r] as HTMLTableRowElement | undefined;
      const cell = tr?.children[Math.max(0, Math.min(act.c, (tr?.children.length ?? 1) - 1))] as
        | HTMLElement
        | undefined;
      if (!cell) return;
      const wr = wrap.getBoundingClientRect();
      const cr = cell.getBoundingClientRect();
      bar.style.left = `${Math.max(0, Math.min(cr.left - wr.left, wr.width - bar.offsetWidth))}px`;
      bar.style.top = `${cr.top - wr.top}px`;
    };
    // 滚动时工具栏随活动格重锚（capture 捕获内部滚动容器的 scroll 事件；
    // 清理表挂 WeakMap，装饰销毁时移除）
    const onScroller = () => placeToolbar();
    document.addEventListener("scroll", onScroller, { capture: true, passive: true });
    // 点击表格外的任何位置都结束单元格编辑：不能只依赖 focusout ——
    // 代码块标题栏等会 preventDefault 保焦点的控件不会让单元格失焦，
    // 仅靠 focusout 会让源码态一直残留。
    const onDocPointerDown = (e: PointerEvent) => {
      const cell = editingCell;
      if (!cell) return;
      const target = e.target;
      if (!(target instanceof Node) || cell.contains(target) || wrap.contains(target)) return;
      finishEdit(cell);
      // 目标不接收焦点（代码块标题栏、页面空白等）时也要把焦点从已渲染的单元格上移走，
      // 否则单元格仍处于聚焦态却不再走编辑逻辑，后续按键会改到渲染 DOM。
      if (document.activeElement === cell) cell.blur();
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    scrollCleanups.set(wrap, () => {
      document.removeEventListener("scroll", onScroller, { capture: true });
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    });
    /** 光标是否贴单元格文本边界（用于左右方向键跨界） */
    const caretEdge = (el: HTMLElement, end: boolean) => {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
      const r = sel.getRangeAt(0);
      if (!el.contains(r.startContainer)) return false;
      const probe = document.createRange();
      probe.selectNodeContents(el);
      return r.compareBoundaryPoints(end ? Range.END_TO_END : Range.START_TO_START, probe) >= 0;
    };
    /** 多行单元格（<br> 渐染）辅助：总行数与光标所在行号（0 起） */
    const lineCount = (el: HTMLElement) => el.querySelectorAll("br").length + 1;
    const caretLine = (el: HTMLElement) => {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return 0;
      const r = sel.getRangeAt(0);
      if (!el.contains(r.startContainer)) return 0;
      const pre = document.createRange();
      pre.selectNodeContents(el);
      pre.setEnd(r.startContainer, r.startOffset);
      // 光标前的 <br> 数即行号（单元格内容小，克隆开销可忽略）
      return pre.cloneContents().querySelectorAll("br").length;
    };

    /** 跳出表格：光标移到表格下一行行首（表格在文末时补一个换行），焦点交还编辑器 */
    const exitBelow = () => {      const range = tableRangeAt(view.state, this.start);
      if (!range) return;
      if (range.to >= view.state.doc.length) {
        // 表格已是文档末尾：追加空行并落位
        view.dispatch({
          changes: { from: view.state.doc.length, insert: "\n" },
          selection: { anchor: view.state.doc.length + 1 },
          scrollIntoView: true,
        });
      } else {
        // 表格行结尾必有 \n，下一行行首就是安全落点（块外可见行）
        view.dispatch({ selection: { anchor: range.to + 1 }, scrollIntoView: true });
      }
      view.focus();
    };
    /** 跳出表格向上：光标置于表格上一行行尾（表格在文首则置于文档头） */
    const exitAbove = () => {
      const range = tableRangeAt(view.state, this.start);
      if (!range) return;
      if (range.from === 0) {
        view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
      } else {
        const line = view.state.doc.lineAt(range.from - 1);
        view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
      }
      view.focus();
    };
    // ---- 单元格渲染 / 源码编辑态 ----
    // 未聚焦：按行内 Markdown 渲染（加粗 / 链接 / 行内代码 / 公式等）；
    // 聚焦：切回纯文本源码直接编辑，失焦后重新渲染。与正文「光标进入显源码」一致。
    const editingCells = new WeakSet<HTMLElement>();
    let editingCell: HTMLElement | null = null;
    const renderCell = (cell: HTMLElement, text: string) => {
      cell.replaceChildren();
      renderInlineMarkdown(cell, text);
    };
    /** 源码态：模型里的换行（\n 或 <br>）还原为单元格内真实换行。
     *  文本节点 / <br> 都标注源码区间，点击渲染态时据此精确落位（不再靠源码重排后的几何位置猜）。 */
    const sourceFragment = (text: string) => {
      const frag = document.createDocumentFragment();
      const src = text.replace(/\r\n?/g, "\n");
      const re = /\n|<br\s*\/?>/gi;
      let last = 0;
      let m: RegExpExecArray | null;
      const addText = (from: number, to: number) => {
        if (to <= from) return;
        const node = document.createTextNode(src.slice(from, to));
        markSourceRange(node, from, to);
        frag.appendChild(node);
      };
      while ((m = re.exec(src))) {
        addText(last, m.index);
        const br = document.createElement("br");
        markSourceRange(br, m.index, m.index + m[0].length);
        frag.appendChild(br);
        last = m.index + m[0].length;
      }
      addText(last, src.length);
      return frag;
    };
    /** 源码偏移 → 单元格内 DOM 光标 */
    const setCaret = (cell: HTMLElement, offset: number) => {
      const point = sourcePointAtOffset(cell, offset);
      const sel = document.getSelection();
      if (!point || !sel) return false;
      const rng = document.createRange();
      rng.setStart(point.node, point.offset);
      rng.collapse(true);
      sel.removeAllRanges();
      sel.addRange(rng);
      return true;
    };
    /** 聚焦进入源码态时若选区还在单元格外（键盘/程序聚焦、从代码块跳入），
     *  显式收拢到末尾，避免继承外部整段选区导致一次删除清空整格 */
    const normalizeCaret = (cell: HTMLElement, text: string) => {
      const sel = document.getSelection();
      if (sel && sel.rangeCount > 0 && cell.contains(sel.getRangeAt(0).startContainer)) return;
      setCaret(cell, text.length);
    };
    const beginEdit = (cell: HTMLElement) => {
      if (editingCells.has(cell)) return;
      const rc = idxOf(cell);
      if (!rc) return;
      editingCells.add(cell);
      editingCell = cell;
      cell.classList.add("md-table-cell-editing");
      cell.replaceChildren(sourceFragment(model.rows[rc.r][rc.c]));
    };
    const finishEdit = (cell: HTMLElement) => {
      if (!editingCells.has(cell)) return;
      editingCells.delete(cell);
      if (editingCell === cell) editingCell = null;
      cell.classList.remove("md-table-cell-editing");
      if (!cell.isConnected) return; // renderAll / 文档重建已丢弃旧 DOM
      const rc = idxOf(cell);
      if (!rc) return;
      model.rows[rc.r][rc.c] = (cell.innerText ?? "").replace(/\n+$/, "");
      renderCell(cell, model.rows[rc.r][rc.c]);
      sync();
    };

    /** 按模型整表重建（初建 / 结构操作 / resync 共用） */
    const renderAll = () => {
      tbody.textContent = "";
      model.rows.forEach((row, r) => {
        const tr = document.createElement("tr");
        row.forEach((text, c) => {
          const cell = document.createElement(r === 0 ? "th" : "td");
          cell.setAttribute("contenteditable", "plaintext-only");
          cell.spellcheck = false;
          renderCell(cell, text);
          cell.style.textAlign = model.aligns[c] ?? "left";
          tr.appendChild(cell);
        });
        tbody.appendChild(tr);
      });
      applyWidths(); // 复原列宽组（结构操作 / resync 重建后仍保持）
    };
    renderAll();

    /** 模型 → 序列化 GFM → 写回文档（装饰重建 eq(start) 判等 → DOM 不动） */
    const sync = () => {
      const range = tableRangeAt(view.state, this.start);
      if (!range) return;
      const text = serializeTable(model);
      // 行数漂移护栏：写回前后允许 ±1 行（加/删行），再大说明模型与文档区间
      // 已失同步（异常合并/误认节点），放弃本次写回，保住文档其余内容
      const curLines = view.state.sliceDoc(range.from, range.to).split("\n").length;
      if (Math.abs(curLines - text.split("\n").length) > 1) return;
      if (view.state.sliceDoc(range.from, range.to) !== text) {
        view.dispatch({ changes: { from: range.from, to: range.to, insert: text } });
      }
      lastSrc = text;
    };

    /** 外部改动（undo / 查找替换）后按文档核对重渲染，焦点随参数回收 */
    const resync = (focus?: { r: number; c: number }) => {
      const range = tableRangeAt(view.state, this.start);
      if (!range) return;
      const src = view.state.sliceDoc(range.from, range.to);
      if (src === lastSrc) return;
      lastSrc = src;
      const fresh = parseTableModel(src);
      model.aligns = fresh.aligns;
      model.rows = fresh.rows;
      renderAll();
      if (focus) focusAt({ r: focus.r, c: focus.c });
      view.requestMeasure();
    };

    // ---- 工具栏（思源式）：随点击的单元格浮现，操作以活动格为基准 ----
    // 对齐键的当前态（活动列的对齐即键的高亮态）
    const alignBtns: Partial<Record<string, HTMLButtonElement>> = {};
    const markAlign = () => {
      if (!act) return;
      const cur = model.aligns[act.c] ?? "left";
      for (const [k, b] of Object.entries(alignBtns)) b?.classList.toggle("md-table-tool-on", k === cur);
    };
    const addTool = (label: string, tip: string, gap: boolean, run: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "md-table-tool" + (gap ? " md-table-tool-gap" : "");
      b.textContent = label;
      b.title = tip;
      b.addEventListener("mousedown", (e) => e.preventDefault()); // 保活动格焦点
      b.addEventListener("click", () => {
        if (act) run();
      });
      bar.appendChild(b);
      return b;
    };
    /** 结构操作：改模型 → renderAll → 焦点落新格 → 写回 */
    const insertRow = (base: { r: number; c: number }, above: boolean) => {
      if (above && base.r === 0) return; // 首行即表头，之上不加行
      const at = above ? base.r : base.r + 1;
      model.rows.splice(at, 0, Array.from({ length: model.rows[0].length }, () => ""));
      renderAll();
      focusAt({ r: at, c: base.c });
      sync();
      view.requestMeasure();
    };
    const deleteRow = (base: { r: number; c: number }) => {
      if (model.rows.length <= 1) return; // 只剩表头：交给「删表」
      model.rows.splice(base.r, 1);
      renderAll();
      focusAt({ r: Math.min(base.r, model.rows.length - 1), c: base.c });
      sync();
      view.requestMeasure();
    };
    const insertCol = (base: { r: number; c: number }, left: boolean) => {
      const at = Math.min(model.rows[0].length, base.c + (left ? 0 : 1));
      model.aligns.splice(at, 0, model.aligns[base.c] ?? "left");
      if (widths) widths.splice(at, 0, widths[Math.min(base.c, widths.length - 1)]);
      for (const row of model.rows) row.splice(at, 0, "");
      renderAll();
      focusAt({ r: base.r, c: at });
      sync();
      view.requestMeasure();
    };
    const deleteCol = (base: { r: number; c: number }) => {
      if (model.rows[0].length <= 1) return; // 最后一列：交给「删表」
      model.aligns.splice(base.c, 1);
      widths?.splice(base.c, 1);
      for (const row of model.rows) row.splice(base.c, 1);
      renderAll();
      focusAt({ r: base.r, c: Math.min(base.c, model.rows[0].length - 1) });
      sync();
      view.requestMeasure();
    };
    const setAlign = (mode: string) => {
      if (!act) return;
      model.aligns[act.c] = mode;
      for (const tr of Array.from(tbody.children)) {
        const cell = tr.children[act.c] as HTMLElement | undefined;
        if (cell) cell.style.textAlign = mode;
      }
      markAlign();
      sync();
      placeToolbar();
    };
    const removeTable = () => {
      const range = tableRangeAt(view.state, this.start);
      if (range) view.dispatch({ changes: { from: range.from, to: range.to, insert: "" } });
    };
    addTool("＋列", "在活动列左侧插入一列", false, () => insertCol(act!, true));
    addTool("列＋", "在活动列右侧插入一列", false, () => insertCol(act!, false));
    addTool("＋行", "在活动行上方插入一行", false, () => insertRow(act!, true));
    addTool("行＋", "在活动行下方插入一行（Enter 同）", false, () => insertRow(act!, false));
    addTool("删行", "删除活动行", false, () => deleteRow(act!));
    addTool("删列", "删除活动列", false, () => deleteCol(act!));
    alignBtns.left = addTool("左", "活动列左对齐", true, () => setAlign("left"));
    alignBtns.center = addTool("中", "活动列居中", false, () => setAlign("center"));
    alignBtns.right = addTool("右", "活动列右对齐", false, () => setAlign("right"));
    addTool("删表", "删除整个表格（Shift+Enter 可跳出表格）", true, removeTable);

    // ---- 事件（委托在 wrap 上：renderAll 重建后依旧生效） ----
    wrap.addEventListener("focusin", (e) => {
      const cell = e.target instanceof Element ? cellFrom(e.target) : null;
      const rc = cell ? idxOf(cell) : null;
      if (cell && rc) {
        beginEdit(cell); // 键盘 / 程序聚焦也切到源码态
        normalizeCaret(cell, model.rows[rc.r][rc.c]);
        act = rc;
        wrap.classList.add("md-table-editing");
        markAlign(); // 对齐键高亮态随新活动列刷新
        placeToolbar(); // 工具栏跟随新活动格
        // CM 选区同步到表内：undo/redo 的选区映射与滚动以 CM 选区为准，
        // 否则 Ctrl+Z 会把光标/视口拉回进表前的旧位置（表现为「跳到顶部」）。
        // 此时焦点仍在单元格 DOM 上，CM 选区只是记账，无可见副作用
        const range = tableRangeAt(view.state, this.start);
        if (range) {
          view.dispatch({
            selection: { anchor: Math.min(range.from + 1, view.state.doc.length) },
          });
        }
      }
    });
    wrap.addEventListener("focusout", (e) => {
      const cell = e.target instanceof Element ? cellFrom(e.target) : null;
      if (cell && (!(e.relatedTarget instanceof Node) || !cell.contains(e.relatedTarget))) {
        finishEdit(cell); // 失焦提交并恢复渲染态
      }
      if (!(e.relatedTarget instanceof Node) || !wrap.contains(e.relatedTarget)) {
        wrap.classList.remove("md-table-editing");
        act = null;
      }
    });
    // 点击渲染态单元格 → 先切源码再落光标（不依赖浏览器对渲染 DOM 的默认光标定位）
    wrap.addEventListener("pointerdown", (e) => {
      const link = e.target instanceof Element ? e.target.closest("[data-href]") : null;
      if (link && (e.ctrlKey || e.metaKey)) {
        const href = (link as HTMLElement).dataset.href;
        if (href) void openUrl(href);
        e.preventDefault();
        return;
      }
      const cell = cellFrom(e.target);
      if (!cell || editingCells.has(cell)) return;
      // 先在渲染态 DOM 上把点击位置映射回源码偏移（文本节点带源码区间标注），
      // 再切源码并落位；否则源码重排后按几何位置猜会偏到标记/相邻字符。
      const srcOffset = sourceOffsetAtPoint(cell, e.clientX, e.clientY);
      beginEdit(cell);
      e.preventDefault(); // 手动聚焦 / 落位，避免旧渲染节点被移除后默认焦点丢失
      cell.focus();
      if (srcOffset == null || !setCaret(cell, srcOffset)) {
        const sel = document.getSelection();
        const probe = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
        if (sel && probe && cell.contains(probe.startContainer)) {
          sel.removeAllRanges();
          sel.addRange(probe);
        } else {
          focusCell(cell);
        }
      }
    });
    // 单元格输入 → 模型 → 写回文档（同公式浮层：不等 IME 组合收尾，实写实算）。
    // 读回用 innerText：<br> 还原为 \n（textContent 会丢失换行边界）
    wrap.addEventListener("input", (e) => {
      const cell = cellFrom(e.target);
      if (!cell || !editingCells.has(cell)) return;
      const rc = idxOf(cell);
      if (!rc) return;
      model.rows[rc.r][rc.c] = (cell.innerText ?? "").replace(/\n+$/, "");
      sync();
      placeToolbar(); // 输入使单元格宽度变化 → 工具栏跟随
    });
    wrap.addEventListener("paste", (e) => {
      const cell = cellFrom(e.target);
      if (!cell || !editingCells.has(cell)) return;
      const text = e.clipboardData?.getData("text/plain");
      if (typeof text !== "string") return;
      e.preventDefault(); // 多行粘贴保留换行（序列化时统一转 <br>，Excel 复制带尾空行的场景去首尾）
      const lines = text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "").split("\n");
      lines.forEach((line, i) => {
        if (i) document.execCommand("insertLineBreak");
        if (line) document.execCommand("insertText", false, line);
      });
    });
    wrap.addEventListener("keydown", (e) => {
      const cell = cellFrom(e.target);
      if (!cell || !editingCells.has(cell)) return;
      if (e.isComposing || e.keyCode === 229) return; // IME 组合中不劫持按键
      const rc = idxOf(cell);
      if (!rc) return;
      const mod = e.ctrlKey || e.metaKey;
      // 撤销 / 重做转给 CM 历史：contenteditable 原生 undo 只改 DOM，
      // 会破坏「DOM ↔ 文档」同步；拦截后按文档 resync 校准 + 焦点回收
      if (mod && !e.altKey && /^[zy]$/i.test(e.key)) {
        e.preventDefault();
        const wantRedo = e.shiftKey || e.key.toLowerCase() === "y";
        if (wantRedo ? redo(view) : undo(view)) {
          resync(rc);
          // 表格已随文档变化被整体重建时（原 widget DOM 已失联），焦点交还编辑器；
          // undo 会把 CM 选区映射到实际撤销处，不会乱跳
          if (!wrap.isConnected) view.focus();
        }
        return;
      }
      switch (e.key) {
        case "Tab": {
          e.preventDefault(); // 行内换格；末格 Tab 追加一行回首列
          const flat = allCells();
          const ni = flat.indexOf(cell) + (e.shiftKey ? -1 : 1);
          if (ni >= 0 && ni < flat.length) {
            focusCell(flat[ni]);
          } else if (!e.shiftKey) {
            model.rows.push(Array.from({ length: model.rows[0].length }, () => ""));
            renderAll();
            focusAt({ r: model.rows.length - 1, c: 0 });
            sync();
            view.requestMeasure();
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (e.altKey) {
            // Alt+Enter：单元格内换行（GFM 序列化为 <br>，导出/跨平台结构不丢）
            document.execCommand("insertLineBreak");
            break;
          }
          if (e.shiftKey) {
            // Shift+Enter 跳出表格：落位表格下一行，焦点交还编辑器
            exitBelow();
            break;
          }
          // Enter 新起一行：当前行下方插行并落同列（Notion/Excel 式）
          insertRow(rc, false);
          break;
        }
        case "ArrowLeft": {
          if (!caretEdge(cell, false)) break; // 光标贴文本左缘才跨格
          e.preventDefault();
          if (rc.c > 0) {
            focusAt({ r: rc.r, c: rc.c - 1 });
          } else if (rc.r > 0) {
            const tr = tbody.children[rc.r - 1] as HTMLTableRowElement;
            focusCell(tr.children[tr.children.length - 1] as HTMLElement);
          }
          break;
        }
        case "ArrowRight": {
          if (!caretEdge(cell, true)) break;
          e.preventDefault();
          if (rc.c < model.rows[0].length - 1) {
            focusAt({ r: rc.r, c: rc.c + 1 });
          } else if (rc.r < model.rows.length - 1) {
            focusCell(tbody.children[rc.r + 1].children[0] as HTMLElement);
          }
          break;
        }
        case "ArrowUp": {
          if (caretLine(cell) > 0) break; // 多行单元格：光标先在本格各行间移动
          e.preventDefault();
          if (rc.r > 0) {
            focusAt({ r: rc.r - 1, c: rc.c }); // 光标向上 → 跨行
          } else {
            exitAbove(); // 已在表头首行 → 退到表格上方一行（方向键可进出表格）
          }
          break;
        }
        case "ArrowDown": {
          if (caretLine(cell) < lineCount(cell) - 1) break; // 多行单元格：光标先在本格各行间移动
          e.preventDefault();
          if (rc.r < model.rows.length - 1) {
            focusAt({ r: rc.r + 1, c: rc.c }); // 光标向下 → 跨行
          } else {
            exitBelow(); // 已在末行 → 退到表格下方一行
          }
          break;
        }
        case "Escape": {
          view.focus(); // 退回文档焦点，focusout 收工具栏
          break;
        }
      }
    });

    // ---- 行列拖拽重排（Obsidian 式）：悬停浮现抓手，拖至目标边界松手完成移位 ----
    // 单只浮动抓手按悬停对象移位（不逐行逐格嵌 DOM，避免 table 结构语义混乱）
    const rowHandle = document.createElement("div");
    rowHandle.className = "md-table-handle";
    rowHandle.title = "拖拽移动整行";
    const colHandle = document.createElement("div");
    colHandle.className = "md-table-handle";
    colHandle.title = "拖拽移动整列";
    const guide = document.createElement("div");
    guide.className = "md-table-reorder-guide";
    guide.style.display = "none";
    wrap.append(rowHandle, colHandle, guide);
    const hideHandles = () => {
      rowHandle.style.display = "none";
      colHandle.style.display = "none";
    };
    // 抓手当前停靠的单元格（悬停更新；拖拽以此为移位对象）
    let hover: { r: number; c: number } | null = null;
    wrap.addEventListener("mouseover", (e) => {
      const cell = cellFrom(e.target);
      const rc = cell ? idxOf(cell) : null;
      if (!cell || !rc) return;
      hover = rc;
      const wr = wrap.getBoundingClientRect();
      const cr = cell.getBoundingClientRect();
      if (rc.r === 0) {
        // 表头行：列抓手悬于单元格上方；表头行本身不拖移行
        rowHandle.style.display = "none";
        colHandle.style.display = "flex";
        colHandle.style.left = `${cr.left + cr.width / 2 - wr.left - 7}px`;
        colHandle.style.top = `${cr.top - wr.top - 15}px`;
      } else {
        colHandle.style.display = "none";
        rowHandle.style.display = "flex";
        rowHandle.style.left = `${cr.left - wr.left - 19}px`;
        rowHandle.style.top = `${cr.top - wr.top - 2}px`;
      }
    });
    wrap.addEventListener("mouseleave", () => {
      hover = null;
      hideHandles();
    });
    rowHandle.addEventListener("pointerdown", (e) => {
      if (hover && hover.r > 0) startDrag("row", hover.r, e); // 表头行固定不拖
    });
    colHandle.addEventListener("pointerdown", (e) => {
      if (hover) startDrag("col", hover.c, e);
    });
    /** 拖拽主流程：move 求插入边界并摆指示线，up 按模型移位写回 */
    function startDrag(kind: "row" | "col", from: number, e: PointerEvent) {
      const lim = kind === "row" ? model.rows.length : model.rows[0].length;
      if (lim <= 1 || (kind === "row" && lim <= 2)) return; // 仅一列/一数据行无可重排
      e.preventDefault(); // 不抢活动格焦点、不触发原生拖选
      hideHandles();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      document.body.classList.add("md-table-dragging");
      const wr = wrap.getBoundingClientRect();
      const tRect = table.getBoundingClientRect();
      const trs = Array.from(tbody.children) as HTMLTableRowElement[];
      // 目标插入序（from 原位处视为无效不落）；t < 0 表示暂无有效落点
      let target = -1;
      const move = (ev: PointerEvent) => {
        let t = -1;
        if (kind === "row") {
          // 行边界：第一个「中心线之下」的数据行序即插入位（表头前不可落，从 1 起）
          t = trs.length;
          for (let i = 1; i < trs.length; i++) {
            const rr = trs[i].getBoundingClientRect();
            if (ev.clientY < rr.top + rr.height / 2) {
              t = i;
              break;
            }
          }
        } else {
          const heads = Array.from(trs[0].children) as HTMLElement[];
          t = heads.length;
          for (let i = 0; i < heads.length; i++) {
            const cr = heads[i].getBoundingClientRect();
            if (ev.clientX < cr.left + cr.width / 2) {
              t = i;
              break;
            }
          }
        }
        target = t === from || t === from + 1 ? -1 : t; // 自身上下皆为原位
        if (target < 0) {
          guide.style.display = "none";
          return;
        }
        guide.style.display = "block";
        if (kind === "row") {
          const y =
            target < trs.length
              ? trs[target].getBoundingClientRect().top
              : trs[trs.length - 1].getBoundingClientRect().bottom;
          guide.style.width = `${tRect.width}px`;
          guide.style.height = "2px";
          guide.style.left = `${tRect.left - wr.left}px`;
          guide.style.top = `${y - wr.top - 1}px`;
        } else {
          const heads = Array.from(trs[0].children) as HTMLElement[];
          const x =
            target < heads.length
              ? heads[target].getBoundingClientRect().left
              : heads[heads.length - 1].getBoundingClientRect().right;
          guide.style.width = "2px";
          guide.style.height = `${tRect.height}px`;
          guide.style.left = `${x - wr.left - 1}px`;
          guide.style.top = `${tRect.top - wr.top}px`;
        }
      };
      const cleanup = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", cleanup);
        document.body.classList.remove("md-table-dragging");
        guide.style.display = "none";
        hideHandles();
      };
      const up = () => {
        cleanup();
        if (target < 0) return;
        // 移除源位后的最终插入下标（target 在 from 之后要回退一档）
        const at = target < from ? target : target - 1;
        if (kind === "row") {
          const [r] = model.rows.splice(from, 1);
          model.rows.splice(at, 0, r);
        } else {
          const [a] = model.aligns.splice(from, 1);
          model.aligns.splice(at, 0, a);
          if (widths) {
            const [w] = widths.splice(from, 1);
            widths.splice(at, 0, w);
          }
          for (const row of model.rows) {
            const [cell] = row.splice(from, 1);
            row.splice(at, 0, cell);
          }
        }
        renderAll();
        // 活动格随移走的内容移动（无活动格则不动焦点）
        if (act) focusAt(kind === "row" ? { r: at, c: act.c } : { r: act.r, c: at });
        sync();
        view.requestMeasure();
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", cleanup);
    }

    // ---- 列宽拖拽（思源式）：悬停单元格右缘热区出 col-resize 光标，
    // 按住拖动只改被拖列自身宽度（其余列保持不动，总宽随被拖列增减） ----
    const RESIZE_HOT = 7; // 右缘命中热区（px）
    const MIN_COL = 40; // 最小列宽（px）
    function startResize(c: number, e: PointerEvent) {
      ensureWidths();
      const ws = widths!;
      const w0 = ws[c];
      const x0 = e.clientX;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      document.body.classList.add("md-table-resizing");
      const move = (ev: PointerEvent) => {
        // 思源式：只改被拖列自身，其余列宽不动（总宽随被拖列增减）
        ws[c] = Math.max(MIN_COL, Math.round(w0 + (ev.clientX - x0)));
        applyWidths();
      };
      const cleanup = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", cleanup);
        el.removeEventListener("pointercancel", cleanup);
        document.body.classList.remove("md-table-resizing");
        view.requestMeasure(); // 列宽变化 → 行内换行数可能变 → 高度图需重测
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", cleanup);
      el.addEventListener("pointercancel", cleanup);
    }
    // 右缘热区光标提示（mousemove 委托，命中格加 col-resize）
    let hotCell: HTMLElement | null = null;
    wrap.addEventListener("mousemove", (e) => {
      const cell = cellFrom(e.target);
      if (hotCell && hotCell !== cell) hotCell.classList.remove("md-col-resizer");
      if (!cell) {
        hotCell = null;
        return;
      }
      const r = cell.getBoundingClientRect();
      const hit = e.clientX >= r.right - RESIZE_HOT;
      cell.classList.toggle("md-col-resizer", hit);
      hotCell = hit ? cell : null;
    });
    wrap.addEventListener("mouseleave", () => {
      hotCell?.classList.remove("md-col-resizer");
      hotCell = null;
    });
    // capture 拦截右缘拖拽：阻止格聚焦/原生文本拖选，赶在默认行为之前
    wrap.addEventListener(
      "pointerdown",
      (e) => {
        const cell = cellFrom(e.target);
        if (!cell) return;
        const r = cell.getBoundingClientRect();
        if (e.clientX < r.right - RESIZE_HOT) return;
        e.preventDefault();
        e.stopPropagation();
        startResize((cell as HTMLTableCellElement).cellIndex, e);
      },
      true,
    );

    return wrap;
  }
  /** true：CM 完全不接手 widget 内事件，焦点由单元格自管（同 FormulaEditorWidget） */
  ignoreEvent() {
    return true;
  }
}

/** Frontmatter 属性卡渲染（Obsidian 式：key/value 两列表，--- 分隔行不显示）
 *  块级 widget，StateField 提供；光标进入块内自动显源码（与表格/公式同一模式）
 *  ⚠ 结构：外层 .md-frontmatter-outer（padding 0.35em 0）+ 内层卡片 .md-frontmatter——
 *  块级 widget 禁止 margin（CM6 heightMap 不计入 margin，行位漂移导致点击错行，
 *  与 .cm-line 的禁 margin 约束同源），间距由外层 padding 承担，视觉不变 */
export class FrontmatterWidget extends WidgetType {
  constructor(readonly raw: string) {
    super();
  }
  eq(other: FrontmatterWidget) {
    return other.raw === this.raw;
  }
  toDOM() {
    const outer = document.createElement("div");
    outer.className = "md-frontmatter-outer md-gutter md-gutter-hover";
    outer.dataset.btype = "front";
    const wrap = document.createElement("div");
    wrap.className = "md-frontmatter";
    for (const line of this.raw.split("\n")) {
      const t = line.trim();
      if (!t || t === "---" || t === "...") continue; // 分隔行/空行不渲染
      // 属性行 key: value（key 限简单标识符；无冒号的行整行入值列，缩进列表项等不深解析）
      const m = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(t);
      const row = document.createElement("div");
      row.className = "md-fm-row";
      const key = document.createElement("span");
      key.className = "md-fm-key";
      key.textContent = m ? m[1] : "";
      const val = document.createElement("span");
      val.className = "md-fm-value";
      const valueText = m ? m[2] ?? "" : t;
      // 数组值（YAML 流式 [a, b]）→ tag 徽章组（tags 等标签属性的常见形态）
      const arr = /^\[(.*)\]$/.exec(valueText.trim());
      if (m && arr) {
        val.classList.add("md-fm-tags");
        for (const item of arr[1]
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean)) {
          const tag = document.createElement("span");
          tag.className = "md-fm-tag";
          tag.textContent = item;
          val.appendChild(tag);
        }
      } else {
        val.textContent = valueText;
      }
      row.append(key, val);
      wrap.appendChild(row);
    }
    if (!wrap.children.length) {
      const empty = document.createElement("div");
      empty.className = "md-fm-row";
      const key = document.createElement("span");
      key.className = "md-fm-key";
      const val = document.createElement("span");
      val.className = "md-fm-value";
      val.textContent = " ";
      empty.append(key, val);
      wrap.appendChild(empty);
    }
    outer.appendChild(wrap);
    return outer;
  }
  ignoreEvent() {
    return false; // 点击属性卡 → 光标进入块内 → 自动回源码模式
  }
}

/** 块级公式渲染（跨行 $$...$$，StateField 提供） */
export class BlockMathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }
  eq(other: BlockMathWidget) {
    return other.tex === this.tex;
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "md-math md-math-block md-gutter md-gutter-hover";
    wrap.dataset.btype = "math";
    try {
      katex.render(this.tex, wrap, {
        displayMode: true,
        throwOnError: false,
        strict: "ignore",
      });
    } catch {
      wrap.textContent = this.tex;
      wrap.classList.add("md-math-error");
    }
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

/** KaTeX 公式渲染 */
export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "md-math" + (this.display ? " md-math-display" : "");
    try {
      katex.render(this.tex, wrap, {
        displayMode: this.display,
        throwOnError: false,
        strict: "ignore",
      });
    } catch {
      wrap.textContent = this.tex;
      wrap.classList.add("md-math-error");
    }
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

// ---------- 公式块编辑浮层（思源式） ----------
// 点击公式块后弹出：原地渲染保持，源码在浮层编辑，input 实时同步文档
// （公式原地重渲染）；点击外部 / Esc 关闭（光标移出块范围即消失）。

/** 查找覆盖 start 位置的公式：contentFrom/contentTo 为定界符内侧（编辑写回区间，
 *  $ 单字符 / $$ 双字符自适应），end 为公式节点末（Esc 光标跳出块外用） */
function formulaRange(
  state: EditorState,
  start: number,
): { contentFrom: number; contentTo: number; end: number } | null {
  let r: { contentFrom: number; contentTo: number; end: number } | null = null;
  syntaxTree(state).iterate({
    from: start,
    to: start + 2,
    enter(n) {
      if (n.name === "Formula") {
        const d = state.sliceDoc(n.from, n.from + 2) === "$$" ? 2 : 1;
        r = { contentFrom: n.from + d, contentTo: n.to - d, end: n.to };
      }
    },
  });
  return r;
}

/** 公式块编辑浮层：标题栏「公式块」+ 带行号的等宽输入区（实时同步渲染）。
 *  · eq 仅按公式块起点判等：连续输入（dispatch 重建装饰）时 DOM 保留，
 *    textarea 焦点 / 光标 / 滚动不丢；弹窗期间无外部修改，无同步需求
 *  · ignoreEvent 必须为 true：浮层内部点击 / 选词不触发 CM6 光标重定位
 *    （否则光标被移出块 → 浮层自灭） */
export class FormulaEditorWidget extends WidgetType {
  /** 内容区间的首/尾结构换行（跨行块 $$ 独立成行）：显示剥离、写回补齐 */
  private leadingNl = false;
  private trailingNl = false;

  constructor(readonly start: number) {
    super();
  }
  eq(other: FormulaEditorWidget) {
    return other.start === this.start;
  }
  toDOM(view: EditorView) {
    // ⚠ 外层 .md-formula-outer 只承担垂直间距（padding）：块级 widget 禁 margin
    // （CM6 heightMap 不计 margin → 行位漂移 → 点击错行）
    const wrap = document.createElement("div");
    wrap.className = "md-formula-outer";
    const panel = document.createElement("div");
    panel.className = "md-formula-editor";
    const head = document.createElement("div");
    head.className = "md-formula-head";
    head.textContent = "公式块";
    const body = document.createElement("div");
    body.className = "md-formula-body";
    const gutter = document.createElement("div");
    gutter.className = "md-formula-gutter";
    const ta = document.createElement("textarea");
    ta.className = "md-formula-input";
    ta.spellcheck = false;
    const init = formulaRange(view.state, this.start);
    const raw = init ? view.state.sliceDoc(init.contentFrom, init.contentTo) : "";
    // 显示时去除首尾结构换行（$$ 行独立），写回时按原结构补回（跨行块保持 $$ 独立成行）
    this.leadingNl = raw.startsWith("\n");
    this.trailingNl = raw.endsWith("\n");
    ta.value = raw.replace(/^\n/, "").replace(/\n$/, "");

    /** 行号列同步 + 高度自适应（输入区随内容增高） */
    const syncGutter = () => {
      gutter.textContent = ta.value.split("\n").map((_, i) => i + 1).join("\n");
      gutter.scrollTop = ta.scrollTop;
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    };

    /** textarea 编辑 → 实时写回公式内容区间（公式原地重渲染） */
    ta.addEventListener("input", () => {
      const r = formulaRange(view.state, this.start);
      const insert = (this.leadingNl ? "\n" : "") + ta.value + (this.trailingNl ? "\n" : "");
      if (r && view.state.sliceDoc(r.contentFrom, r.contentTo) !== insert) {
        view.dispatch({ changes: { from: r.contentFrom, to: r.contentTo, insert } });
      }
      syncGutter();
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        // Esc：光标移出块（公式节点末+1）→ 浮层消失，公式保持当前内容
        e.preventDefault();
        const r = formulaRange(view.state, this.start);
        view.dispatch({ selection: { anchor: Math.min((r ? r.end : this.start) + 1, view.state.doc.length) } });
        view.focus();
      } else if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Tab：插入两空格（LaTeX 缩进），不跳出输入区
        e.preventDefault();
        ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    // 浮层内点击（非输入区）不丢焦点
    wrap.addEventListener("mousedown", (e) => {
      if (!ta.contains(e.target as Node)) e.preventDefault();
    });

    body.append(gutter, ta);
    panel.append(head, body);
    wrap.appendChild(panel);
    // 聚焦输入区：不用 rAF（后台/切走窗口时 rAF 严重节流，实测延迟可达数百 ms），
    // setTimeout 在 mousedown 默认聚焦之后执行；60ms 二次兜底覆盖任何晚到的焦点竞争
    const focusTa = () => {
      if (document.contains(ta)) ta.focus();
    };
    setTimeout(() => {
      focusTa();
      syncGutter();
    }, 0);
    setTimeout(focusTa, 60);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/** 代码块语言 tag（思源式：fence 首行左上角，hover 浮现强化，点击弹语言选择）
 *  ignoreEvent 必须为 false：CM6 会把 ignoreEvent=true 的 widget 上的事件
 *  判为「不属于编辑器」直接丢弃（eventBelongsToEditor），mousedown handler 收不到 
 *  （与图片 widget 同款模式，checkbox 此前也埋着这个 bug，一并修复） */
export class LanguageTagWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }
  eq(other: LanguageTagWidget) {
    return other.lang === this.lang;
  }
  toDOM() {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "md-lang-tag";
    el.textContent = this.lang || "text";
    el.title = "选择代码语言";
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

// ---------- 代码块语言切换 / 聚焦 ----------

/** 聚焦指定围栏块里的 contenteditable；widget 可能尚未完成渲染，rAF 重试 */
export function focusCodeBlockEditor(view: EditorView, start: number, attempts = 0): void {
  if (!view.dom.isConnected) return;
  const root = view.dom.querySelector<HTMLElement>(`.md-code-outer[data-code-start="${start}"]`);
  const edit = root?.querySelector<HTMLElement>(".md-code-edit");
  if (edit) {
    edit.focus({ preventScroll: true });
    const row = edit.querySelector<HTMLElement>(".md-code-line");
    if (row) {
      const range = document.createRange();
      range.selectNodeContents(row);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    edit.scrollIntoView({ block: "nearest" });
    return;
  }
  if (attempts < 50) {
    requestAnimationFrame(() => focusCodeBlockEditor(view, start, attempts + 1));
  }
}

let activeCodeLangMenu: { close: () => void } | null = null;

/** 代码块左上角语言菜单：挂在 body 上，避免被代码块的 overflow 裁切 */
function openCodeLangMenu(
  view: EditorView,
  start: number,
  anchor: HTMLElement,
  current: string,
  onFocus: () => void,
): void {
  activeCodeLangMenu?.close();

  const menu = document.createElement("div");
  menu.className = "md-code-lang-menu";
  const search = document.createElement("input");
  search.className = "md-code-lang-search";
  search.type = "search";
  search.placeholder = "搜索或输入语言…";
  search.autocomplete = "off";
  const list = document.createElement("div");
  list.className = "md-code-lang-list";
  menu.append(search, list);
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const width = 230;
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const menuHeight = Math.min(320, Math.max(180, Math.max(spaceBelow, spaceAbove)));
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  menu.style.top =
    spaceBelow < 200 && spaceAbove > spaceBelow
      ? `${Math.max(8, rect.top - menuHeight - 4)}px`
      : `${rect.bottom + 4}px`;
  menu.style.maxHeight = `${menuHeight}px`;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onDocPointer, true);
    window.removeEventListener("resize", close);
    menu.remove();
    if (activeCodeLangMenu?.close === close) activeCodeLangMenu = null;
  };
  const closeAndFocus = () => {
    close();
    requestAnimationFrame(onFocus);
  };
  const applyLanguage = (langId: string) => {
    const value = langId.trim();
    if (!value || /[`\r\n]/.test(value)) return;
    if (start > view.state.doc.length) {
      close();
      return;
    }
    const line = view.state.doc.lineAt(start);
    const m = /^(`{3,})([ \t]*)([^\s`]*)(.*)$/.exec(line.text);
    if (m) {
      const insert = `${m[1]}${m[2]}${value}${m[4]}`;
      if (insert !== line.text) {
        view.dispatch({ changes: { from: line.from, to: line.to, insert } });
      }
    }
    closeAndFocus();
  };
  const render = () => {
    const raw = search.value.trim();
    const q = raw.toLowerCase();
    const langs = FENCE_LANGS.filter(
      (l) =>
        !q ||
        l.id.includes(q) ||
        l.name.toLowerCase().includes(q) ||
        l.aliases.some((a) => a.includes(q)),
    ).slice(0, q ? 120 : 80);
    const exact = FENCE_LANGS.some((l) => l.id.toLowerCase() === q);
    const customValid =
      raw.length > 0 && /^[A-Za-z0-9+#._-]+$/.test(raw) && !exact;
    list.replaceChildren();
    const addCustom = () => {
      const custom = document.createElement("button");
      custom.type = "button";
      custom.className = "md-code-lang-item is-custom";
      custom.dataset.lang = raw;
      const id = document.createElement("span");
      id.textContent = `使用自定义语言 “${raw}”`;
      const detail = document.createElement("span");
      detail.className = "md-code-lang-detail";
      detail.textContent = "自定义";
      custom.append(id, detail);
      custom.addEventListener("click", () => applyLanguage(raw));
      list.appendChild(custom);
    };
    if (!langs.length && customValid) addCustom();
    for (const lang of langs) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `md-code-lang-item${lang.id === current ? " is-current" : ""}`;
      item.dataset.lang = lang.id;
      const id = document.createElement("span");
      id.textContent = lang.id;
      const detail = document.createElement("span");
      detail.className = "md-code-lang-detail";
      detail.textContent = lang.name === lang.id ? "" : lang.name;
      item.append(id, detail);
      item.addEventListener("click", () => applyLanguage(lang.id));
      list.appendChild(item);
    }
    // 有匹配项时把“自定义”放在末尾，避免抢占 Enter 默认项
    if (langs.length && customValid) addCustom();
    if (!langs.length && !customValid) {
      const empty = document.createElement("div");
      empty.className = "md-code-lang-empty";
      empty.textContent = q ? "输入合法语言名，或从列表选择" : "没有匹配的语言";
      list.appendChild(empty);
    }
  };
  function onDocPointer(event: PointerEvent) {
    const target = event.target as Node | null;
    if (target && (menu.contains(target) || anchor.contains(target))) return;
    close();
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndFocus();
    } else if (event.key === "Enter") {
      const q = search.value.trim().toLowerCase();
      const items = [...list.querySelectorAll<HTMLButtonElement>(".md-code-lang-item")];
      const target =
        items.find((item) => item.dataset.lang?.toLowerCase() === q) ?? items[0];
      if (target) {
        event.preventDefault();
        target.click();
      }
    }
  };
  search.addEventListener("input", render);
  menu.addEventListener("keydown", onKey);
  window.addEventListener("resize", close);
  window.setTimeout(() => document.addEventListener("pointerdown", onDocPointer, true), 0);
  activeCodeLangMenu = { close };
  render();
  search.focus({ preventScroll: true });
}

// ---------- 代码块（思源式：块内 contenteditable 就地编辑） ----------
// 代码块整块替换为块级 widget：`.md-code-edit` 是 contenteditable（white-space:pre，
// 内嵌横向滚动条，单行超长不换行）。代码块恒为可编辑态（同思源进入编辑后）：
// contenteditable 原生支持点击任意字符**精确**定位光标，光标为文本 I-beam。
// input 实时写回文档内容区间；外部改动（undo 等）在 focus 时按文档核对重设。
// eq 仅按块起点判等：连续输入（dispatch 重建装饰）时 widget 复用，光标 / 焦点不丢。

/** 定位覆盖 start 的代码块内容区间（基于文档文本扫描围栏，不依赖语法树）：
 *  语法树对 markdown 是异步解析、滞后于最新文档——编辑后行数变化时若用树定位，
 *  结束围栏位置会和文档错位，写回会误覆盖代码块之后的正文。
 *  这里直接从 start（围栏首行起点）逐行扫描找结束围栏，doc 是权威，始终正确。
 *  contentFrom/contentTo 为围栏内侧的真实代码区间（包含闭围栏前的结构换行），
 *  end 为末围栏行末（Esc 跳出块外用） */
function codeRange(
  state: EditorState,
  start: number,
): { contentFrom: number; contentTo: number; end: number } | null {
  const doc = state.doc;
  if (start < 0 || start > doc.length) return null;
  const first = doc.lineAt(start);
  if (!first.text.startsWith("```")) return null;
  const fenceLen = first.text.match(/^`+/)?.[0].length ?? 3;
  let lastLine = doc.line(doc.lines);
  for (let ln = first.number + 1; ln <= doc.lines; ln++) {
    const line = doc.line(ln);
    const m = line.text.match(/^`+/);
    if (m && m[0].length >= fenceLen) {
      lastLine = line;
      break;
    }
  }
  return {
    contentFrom: Math.min(first.to + 1, lastLine.from),
    contentTo: lastLine.from,
    end: lastLine.to,
  };
}

/** fence 语言 → 解析器缓存：language-data 按需动态加载（与源码态同一数据源），
 *  未匹配到语言 / 加载失败缓存 null（退化为纯文本，不反复重试） */
const codeParsers = new Map<string, Parser | null>();

/** 取（必要时异步加载）fence 语言的解析器：与 CM 源码态同一匹配口径——
 *  info string 取首个非空白词，按 name / alias 模糊匹配 */
function resolveCodeParser(info: string): {
  parser: Parser | null;
  pending: Promise<Parser | null> | null;
} {
  const first = /\S*/.exec(info)?.[0] ?? "";
  const cached = codeParsers.get(first);
  if (cached !== undefined) return { parser: cached, pending: null };
  const desc = first ? LanguageDescription.matchLanguageName(languages, first, true) : null;
  if (!desc) {
    codeParsers.set(first, null);
    return { parser: null, pending: null };
  }
  if (desc.support) {
    const parser = desc.support.language.parser;
    codeParsers.set(first, parser);
    return { parser, pending: null };
  }
  const pending = desc
    .load()
    .then((support) => {
      const parser = support.language.parser;
      codeParsers.set(first, parser);
      return parser;
    })
    .catch(() => {
      codeParsers.set(first, null);
      return null;
    });
  return { parser: null, pending };
}

/** 代码块块级渲染 + 块内 contenteditable 就地编辑（思源式）：
 *  ignoreEvent 必须为 true——块内事件（点击定位、输入）全部自行接管，
 *  不让 CM 把点击当文档点击重定位光标 */
export class CodeBlockWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly lang: string,
    readonly start: number,
  ) {
    super();
  }
  eq(other: CodeBlockWidget) {
    return other.start === this.start && other.lang === this.lang;
  }
  toDOM(view: EditorView) {
    // ⚠ 外层 .md-code-outer 只承担垂直间距（padding）：块级 widget 禁 margin
    const wrap = document.createElement("div");
    wrap.className = "md-code-outer";
    wrap.dataset.codeStart = String(this.start);
    const panel = document.createElement("div");
    panel.className = "md-code-block md-gutter md-gutter-hover";
    panel.dataset.btype = "code";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "md-code-head";
    head.textContent = this.lang || "code";
    head.title = "点击选择代码语言";
    head.addEventListener("mousedown", (event) => {
      // 阻止按钮抢焦点导致编辑器滚动，避免下拉框刚展开就被 scroll 逻辑关掉
      event.preventDefault();
      event.stopPropagation();
    });
    head.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openCodeLangMenu(view, this.start, head, this.lang, () =>
        focusCodeBlockEditor(view, this.start),
      );
    });
    const edit = document.createElement("div");
    edit.className = "md-code-edit";
    edit.contentEditable = "true";
    edit.spellcheck = false;

    // ---- 语法着色 ----
    // 块级 widget 里的代码不经过 CM 的 syntaxHighlighting 管线（整块被替换成自绘 DOM），
    // 这里自行解析并着色：按 fence 语言取 parser（language-data 懒加载，见 resolveCodeParser），
    // 用 highlightCode 把整段代码的高亮区间映射到各行 span；样式与源码态共用 codeHighlight
    // （其 class 由 setup.ts 的 syntaxHighlighting 注入 CSS），未匹配到语言 / 加载中退化为纯文本。
    let parser: Parser | null = null;
    let destroyed = false;
    let composing = false; // IME 组合期间不重绘：重绘会打断组合，组合结束再补
    const rows = () => Array.from(edit.children) as HTMLElement[];

    // 不能直接读 innerText：contenteditable 会给空行额外补一个换行
    // （<div><br></div> → "\n\n"），从结构行读取才能保留准确的空行数。
    // 使用全部直接子元素而不是只查 .md-code-line：浏览器新建行时不一定带 class。
    const readText = () => {
      if (!edit.children.length) return "";
      return Array.from(edit.children, (row) => row.textContent ?? "").join("\n");
    };

    /** 重绘会把行内容替换成 span：光标位置按「字符偏移」先记后还（仅处理折叠光标） */
    const caretOffset = (): number | null => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      if (!edit.contains(range.startContainer)) return null;
      let offset = 0;
      for (const row of rows()) {
        if (!row.contains(range.startContainer)) {
          offset += (row.textContent ?? "").length + 1;
          continue;
        }
        const probe = document.createRange();
        probe.selectNodeContents(row);
        probe.setEnd(range.startContainer, range.startOffset);
        return offset + probe.toString().length;
      }
      return null;
    };

    const setCaret = (offset: number) => {
      const sel = window.getSelection();
      if (!sel) return;
      let remaining = offset;
      for (const row of rows()) {
        const text = row.textContent ?? "";
        if (remaining > text.length) {
          remaining -= text.length + 1;
          continue;
        }
        const range = document.createRange();
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let seen = 0;
        while (node) {
          const len = node.nodeValue?.length ?? 0;
          if (remaining <= seen + len) {
            range.setStart(node, remaining - seen);
            break;
          }
          seen += len;
          node = walker.nextNode();
        }
        if (!node) range.setStart(row, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    };

    // 整块重绘：每行一个 <div>（多行编辑稳定，innerText 读回即以 \n 分隔）；
    // 有解析器时按 token 填 span（跨行的注释 / 字符串也正确），无 token 的行补 <br>
    const paint = (text: string) => {
      const lines = text.split("\n");
      edit.textContent = "";
      for (let i = 0; i < lines.length; i++) {
        const row = document.createElement("div");
        row.className = "md-code-line";
        edit.appendChild(row);
      }
      if (!parser) {
        rows().forEach((row, i) => {
          row.textContent = lines[i];
          if (!lines[i]) row.appendChild(document.createElement("br"));
        });
        return;
      }
      let index = 0;
      highlightCode(
        text,
        parser.parse(text),
        codeHighlight,
        (chunk, classes) => {
          const row = edit.children[index] as HTMLElement | undefined;
          if (!row) return;
          if (!classes) {
            row.appendChild(document.createTextNode(chunk));
          } else {
            const span = document.createElement("span");
            span.className = classes;
            span.textContent = chunk;
            row.appendChild(span);
          }
        },
        () => {
          index++;
        },
      );
      for (const row of rows()) if (!row.firstChild) row.appendChild(document.createElement("br"));
    };

    /** 输入 / 组合结束 / 高亮就绪后的原地重绘（带光标与横向滚动保持） */
    const repaint = () => {
      if (destroyed || composing || !parser) return;
      const caret = caretOffset();
      const scrollLeft = edit.scrollLeft; // 清空子节点会把横向滚动复位，重绘后还原
      paint(readText());
      if (caret != null) setCaret(caret);
      edit.scrollLeft = scrollLeft;
    };

    const resolved = resolveCodeParser(this.lang);
    parser = resolved.parser;
    paint(this.code);
    resolved.pending?.then((loaded) => {
      if (destroyed || !loaded) return;
      parser = loaded;
      repaint();
    });
    (wrap as HTMLElement & { __codeDetach?: () => void }).__codeDetach = () => {
      destroyed = true;
    };
    panel.append(head, edit);
    wrap.appendChild(panel);

    // 宽度随窗口/侧栏变化时重新测量：代码块内部横向滚动条出现/消失会改变高度，
    // 不主动 requestMeasure 的话 CM6 的 heightMap 会停在旧高度，下方点击错行。
    const resizeObserver = new ResizeObserver(() => view.requestMeasure());
    resizeObserver.observe(edit);
    (wrap as HTMLElement & { __codeResizeObserver?: ResizeObserver }).__codeResizeObserver =
      resizeObserver;

    const write = () => {
      const text = readText();
      const r = codeRange(view.state, this.start);
      if (!r) return;
      // 代码内容后要保留一个换行，闭围栏才会独立成行（空代码块输入时也成立）
      const insert = `${text}\n`;
      if (view.state.sliceDoc(r.contentFrom, r.contentTo) !== insert) {
        view.dispatch({ changes: { from: r.contentFrom, to: r.contentTo, insert } });
      }
      view.requestMeasure(); // 行数变化 → widget 高度变化
    };
    edit.addEventListener("input", () => {
      write();
      repaint();
    });
    edit.addEventListener("compositionstart", () => {
      composing = true;
    });
    edit.addEventListener("compositionend", () => {
      composing = false;
      repaint();
    });
    edit.addEventListener("paste", (e) => {
      // 代码块内只接收纯文本，避免把网页富文本样式粘进来
      const text = e.clipboardData?.getData("text/plain");
      if (text == null) return;
      e.preventDefault();
      document.execCommand("insertText", false, text);
    });
    edit.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        // 代码块内 Enter 自己处理：按光标拆分当前行并新建 .md-code-line，
        // 不依赖 contenteditable 在嵌套结构里生成行 div 的行为
        e.preventDefault();
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) range.deleteContents();
        const start = range.startContainer;
        const startEl = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
        const row = startEl?.closest<HTMLElement>(".md-code-line");
        if (!row || !edit.contains(row)) return;
        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(row);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const before = beforeRange.toString();
        const full = row.textContent ?? "";
        const after = full.slice(before.length);
        row.textContent = before;
        if (!before) row.appendChild(document.createElement("br"));
        const newRow = document.createElement("div");
        newRow.className = "md-code-line";
        newRow.textContent = after;
        if (!after) newRow.appendChild(document.createElement("br"));
        row.after(newRow);
        const caret = document.createRange();
        caret.setStart(newRow, 0);
        caret.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caret);
        write();
        repaint();
      } else if (e.key === "Tab") {
        // Tab 插入制表符（不丢焦点），对齐代码编辑器习惯
        e.preventDefault();
        document.execCommand("insertText", false, "\t");
      } else if (e.key === "Escape") {
        // Esc：光标移出代码块（节点末+1）
        e.preventDefault();
        const r = codeRange(view.state, this.start);
        view.dispatch({ selection: { anchor: Math.min((r ? r.end : this.start) + 1, view.state.doc.length) } });
        view.focus();
      }
    });
    edit.addEventListener("focus", () => {
      // 外部改动（undo / 查找替换）后点击代码块：按文档核对重设内容
      const r = codeRange(view.state, this.start);
      const docText = r ? view.state.sliceDoc(r.contentFrom, r.contentTo).replace(/\n$/, "") : "";
      if (docText !== readText()) paint(docText);
    });
    return wrap;
  }
  destroy(dom: HTMLElement) {
    (dom as HTMLElement & { __codeResizeObserver?: ResizeObserver }).__codeResizeObserver?.disconnect();
    (dom as HTMLElement & { __codeDetach?: () => void }).__codeDetach?.();
  }
  ignoreEvent() {
    return true;
  }
}

/** 图片原始尺寸缓存：源码态 ↔ 渲染态来回切换会重建 widget，
 *  用上次加载的宽高先占位，避免图片重新解码期间整行高度从 0 跳变 */
const imageSizeCache = new Map<string, { w: number; h: number }>();

/** 图片渲染（替代 ![alt](src) 源码）
 *  图片异步加载完成后高度变化，CM6 不会自动感知（无 DOM 变更事件）——
 *  load/error 时 requestMeasure 触发重新测量，否则后续 posAtCoords 按旧高度映射错行 */
export class ImageWidget extends WidgetType {
  /** 创建 widget 时就解析好资源 URL（含文档目录）；路径变化时 eq 失败会重建 DOM */
  readonly resolved: string;
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
    this.resolved = imageSrc(src);
  }
  eq(other: ImageWidget) {
    return (
      other.src === this.src && other.alt === this.alt && other.resolved === this.resolved
    );
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "md-image-wrap";
    wrap.dataset.src = this.src;
    const img = document.createElement("img");
    const cached = imageSizeCache.get(this.resolved);
    if (cached) {
      // 先按缓存宽高占位；CSS max-width + height:auto 会等比缩放到栏宽
      img.width = cached.w;
      img.height = cached.h;
    }
    img.decoding = "async";
    img.loading = "eager"; // widget 本就只创建于可视区，eager 避免懒加载等待
    img.src = this.resolved;
    img.alt = this.alt;
    img.addEventListener("load", () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        imageSizeCache.set(this.resolved, { w: img.naturalWidth, h: img.naturalHeight });
      }
      view.requestMeasure();
    });
    img.addEventListener("error", () => {
      wrap.classList.add("md-image-broken");
      img.replaceWith(document.createTextNode(`🖼 ${this.alt || this.src}（图片加载失败）`));
      view.requestMeasure();
    });
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

/** 分割线渲染（--- / ***） */
export class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "md-hr";
    const line = document.createElement("span");
    line.className = "md-hr-line";
    wrap.appendChild(line);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

/** 无序列表圆点（替代 "-"/"*" 源码）
 *  真 bullet 字符 "•"（U+2022）——与正文同字体同基线，任意字号自适应；
 *  所有层级尺寸一致（不随嵌套缩小，与思源行为一致） */
export class BulletWidget extends WidgetType {
  constructor(readonly depth = 1) {
    super();
  }
  eq(other: BulletWidget) {
    return other.depth === this.depth;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "md-bullet";
    wrap.textContent = "•";
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

/** 任务复选框（点击切换 [ ] <-> [x]） */
export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }
  toDOM() {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.className = "md-task-checkbox";
    el.checked = this.checked;
    el.dataset.from = String(this.from);
    el.dataset.to = String(this.to);
    return el;
  }
  /** ignoreEvent 必须为 false：true 会被 CM6 判为「不属于编辑器」而丢弃事件，
   *  外层 mousedown 的 checkbox 切换分支将收不到点击 */
  ignoreEvent() {
    return false;
  }
}
