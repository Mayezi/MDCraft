// 编辑器扩展装配：语法 / 高亮 / 快捷键 / Live Preview / 打字机模式

import { EditorState, Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  dropCursor,
  highlightActiveLine,
  rectangularSelection,
  placeholder,
  type Command,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
} from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap, acceptCompletion } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { markdown, commonmarkLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting, indentUnit, syntaxTree } from "@codemirror/language";
import { GFM, Subscript, Superscript } from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";
import { FormulaConfig, HighlightConfig, UnderlineConfig } from "./markdown-config";
import { livePreview } from "./livepreview";
import { codeHighlight } from "./code-highlight";
import { blockWidgets, tableArrowDown, tableArrowUp } from "./blocks";
import { mdSearchPanel } from "./search-panel";
import { slashPanel } from "./slash";
import { fenceEnterCommand, fenceJumpDown, fenceJumpUp, fenceEscape, fenceTabCommand } from "./fence-lang";
import { listIndentCommand, listOutdentCommand } from "./list-indent";
import { lineClick } from "./mouse";
import { showMinimap } from "@batchfy/codemirror-minimap";
import { minimap } from "./minimap";
import {
  boldCommand,
  italicCommand,
  strikeCommand,
  codeCommand,
  insertLink,
  insertInlineMath,
  insertBlockMath,
  insertFence,
  setHeading,
} from "./commands";

export const lpCompartment = new Compartment(); // live preview / source mode
export const minimapCompartment = new Compartment(); // 右侧缩略图开关

/** 选区任意 range 所在行是否为 ATX 标题行（标题前缀由正则隐藏，行首缩进会破坏匹配导致前缀源码暴露） */
const anyHeadingLine = (view: EditorView): boolean => {
  for (const r of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(r.from);
    let hit = false;
    syntaxTree(view.state).iterate({
      from: line.from,
      to: line.to,
      enter(node) {
        if (node.name.startsWith("ATXHeading")) hit = true;
        return !hit;
      },
    });
    if (hit) return true;
  }
  return false;
};

/** Tab 兜底：整行/多行缩进走 indentMore（空格）；光标在行中则插入缩进空格。
 *  替代 indentWithTab——后者在行中插入字面制表符 \t，会被 highlightSpecialChars 高亮成可见箭头/方块。
 *  标题行不做缩进：行首加空格会破坏 ATX 前缀隐藏正则，把 `# ` 暴露成源码 */
const tabIndentCommand: Command = (view) => {
  if (anyHeadingLine(view)) return true;
  if (indentMore(view)) return true;
  const unit = view.state.facet(indentUnit) || "  ";
  view.dispatch(view.state.replaceSelection(unit));
  return true;
};

export interface EditorSettings {
  /** 全页源码模式（Ctrl+/，入口在左下角状态栏） */
  sourceMode: boolean;
  /** 右侧文档缩略导航 */
  showMinimap: boolean;
}

const mdLanguage = markdown({
  base: commonmarkLanguage,
  codeLanguages: languages,
  addKeymap: true,
  extensions: [GFM, Subscript, Superscript, HighlightConfig, UnderlineConfig, FormulaConfig],
});

/** Markdown 源码态的语法着色（淡显标记类 token） */
const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700" },
  { tag: t.heading2, fontWeight: "700" },
  { tag: t.heading3, fontWeight: "600" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600" },
  {
    tag: [t.processingInstruction, t.meta],
    color: "var(--syn-mark)",
  },
  { tag: t.monospace, color: "var(--syn-code)" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--syn-mark)" },
  // 列表体 / 引用体文本不染色：Lezer 的 t.list、t.quote 会命中容器全部后代节点，
  // 染色会盖住行内元素（加粗/链接等）自身的颜色；列表标记淡显由 processingInstruction 与装饰类负责，
  // 引用正文颜色由行级装饰 .md-line-quote 承担（不依赖语法标签）
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
]);

export function createExtensions(
  settings: EditorSettings,
  extra: Extension[] = [],
): Extension[] {
  return [
    history(),
    // 原生选区（不装 drawSelection）：CM6 选区矩形对跨行选中行刻意从内容区左缘铺到右缘
    // （代码编辑器惯例，只减 .cm-line 自身 padding，不认 .cm-content 的 40px 内边距），
    // 文档编辑器左右空白会被一并高亮；原生选区贴合文字（contenteditable 原生绘制）
    dropCursor(),
    highlightActiveLine(),
    EditorState.allowMultipleSelections.of(true),
    highlightSpecialChars(),
    closeBrackets(),
    slashPanel(),
    lineClick,
    // 空文档（新建草稿）引导：提示开始创作或按 / 唤起插入命令面板
    placeholder("开始创作，或按 / 查看插入命令"),
    EditorView.lineWrapping,
    rectangularSelection(),
    EditorView.contentAttributes.of({
      spellcheck: "true",
      autocorrect: "off",
      autocapitalize: "off",
    }),
    keymap.of([
      { key: "Mod-b", run: boldCommand, preventDefault: true },
      { key: "Mod-i", run: italicCommand, preventDefault: true },
      { key: "Mod-e", run: codeCommand, preventDefault: true },
      { key: "Mod-Shift-x", run: strikeCommand, preventDefault: true },
      { key: "Mod-k", run: insertLink, preventDefault: true },
      { key: "Mod-Shift-m", run: insertInlineMath, preventDefault: true },
      { key: "Mod-Alt-m", run: insertBlockMath, preventDefault: true },
      { key: "Mod-Alt-c", run: insertFence, preventDefault: true },
      { key: "Mod-1", run: setHeading(1), preventDefault: true },
      { key: "Mod-2", run: setHeading(2), preventDefault: true },
      { key: "Mod-3", run: setHeading(3), preventDefault: true },
      { key: "Mod-4", run: setHeading(4), preventDefault: true },
      { key: "Mod-5", run: setHeading(5), preventDefault: true },
      { key: "Mod-6", run: setHeading(6), preventDefault: true },
      { key: "Mod-0", run: setHeading(0), preventDefault: true },
      { key: "Enter", run: fenceEnterCommand, preventDefault: true },
      { key: "Tab", run: acceptCompletion, preventDefault: true },
      { key: "Tab", run: fenceTabCommand },
      { key: "Tab", run: listIndentCommand },
      { key: "Shift-Tab", run: listOutdentCommand },
      { key: "ArrowDown", run: fenceJumpDown },
      { key: "ArrowUp", run: fenceJumpUp },
      { key: "ArrowDown", run: tableArrowDown },
      { key: "ArrowUp", run: tableArrowUp },
      { key: "Enter", run: fenceEscape },
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...historyKeymap,
      // 拦截 Mod-/：defaultKeymap 自带 toggleComment（注释当前行），
      // 与全局 Ctrl+/ 切源码模式冲突。此处先吞掉注释命令（返回 true），
      // 事件继续冒泡到 App 的 window 监听完成源码模式切换
      { key: "Mod-/", run: () => true },
      ...defaultKeymap,
      { key: "Tab", run: tabIndentCommand },
    ]),
    minimapCompartment.of(settings.showMinimap ? minimap : []),
    mdLanguage,
    syntaxHighlighting(mdHighlight),
    syntaxHighlighting(codeHighlight),
    highlightSelectionMatches(),
    mdSearchPanel(),
    lpCompartment.of(
      settings.sourceMode
        ? []
        : [livePreview(), blockWidgets()],
    ),
    ...extra,
  ];
}

/** 设置变化时重配置（全页源码模式 / 右侧缩略图开关） */
export function reconfigure(view: EditorView, settings: EditorSettings) {
  const minimapWasOn = view.state.facet(showMinimap) !== null;
  view.dispatch({
    effects: [
      lpCompartment.reconfigure(
        settings.sourceMode
          ? []
          : [livePreview(), blockWidgets()],
      ),
      minimapCompartment.reconfigure(settings.showMinimap ? minimap : []),
    ],
  });
  // 库的 ViewPlugin 在“本次事务中新建”时不会收到 update，gutter 宽度会停在 0；
  // 补一个空事务让新实例完成首次 render。
  if (!minimapWasOn && settings.showMinimap) {
    view.dispatch({});
  }
}

export function createState(
  text: string,
  settings: EditorSettings,
  extra: Extension[] = [],
  /** 初始光标位置；省略时默认在文档开头（首行）。
   *  内部会按实际 doc.length 做 clamp——CM 会把 \r\n / \r 归一化为 \n，
   *  传入的字符串长度可能大于真实文档长度，直接作为 anchor 会越界报错。 */
  initialPos?: number,
): EditorState {
  if (initialPos === undefined) {
    return EditorState.create({
      doc: text,
      extensions: createExtensions(settings, extra),
    });
  }
  const base = EditorState.create({ doc: text, extensions: [] });
  const pos = Math.max(0, Math.min(initialPos, base.doc.length));
  return EditorState.create({
    doc: text,
    selection: { anchor: pos },
    extensions: createExtensions(settings, extra),
  });
}
