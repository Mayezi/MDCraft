// 代码块内嵌语法着色（源码态与块级 widget 共用同一样式）：
// - setup.ts 通过 syntaxHighlighting(codeHighlight) 把样式装进编辑器（CSS 由它注入）
// - widgets.ts 的代码块 widget 用 highlightCode(tree, codeHighlight, …) 拿到同一批
//   class 名，让块内自绘 DOM 与源码态用色完全一致；颜色全部来自主题变量，只有一份来源。

import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** 代码块内嵌语法着色 */
export const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.definitionKeyword], color: "var(--syn-kw)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-str)" },
  { tag: [t.number, t.bool, t.null], color: "var(--syn-num)" },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: "var(--syn-com)",
    fontStyle: "italic",
  },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-fn)" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: "var(--syn-type)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--syn-prop)" },
  { tag: [t.operator, t.operatorKeyword], color: "var(--syn-op)" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--syn-var)" },
]);
