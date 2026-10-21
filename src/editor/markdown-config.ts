// Markdown 语法扩展：
// - 数学公式（$...$ 行内 / $$...$$ 块级），主流编辑器通行的公式书写习惯
// - 高亮 ==text==（思源同款）
// - 下划线 <u>text</u>（通用存储格式）

import { tags as t } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";

export const FormulaConfig: MarkdownConfig = {
  defineNodes: [
    { name: "Formula", style: t.special(t.string) },
    { name: "FormulaMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "Formula",
      parse(cx, next, pos) {
        if (next !== 36 /* '$' */) return -1;
        const display = cx.char(pos + 1) === 36;
        if (display) {
          // $$...$$
          let i = pos + 2;
          while (i < cx.end - 1) {
            if (cx.char(i) === 36 && cx.char(i + 1) === 36) {
              cx.addElement(cx.elt("Formula", pos, i + 2));
              return i + 2;
            }
            i++;
          }
          return -1;
        }
        // $...$（开符号后不允许空白）
        const after = cx.char(pos + 1);
        if (after <= 0 || after === 32 || after === 10) return -1;
        let i = pos + 2;
        while (i < cx.end) {
          const c = cx.char(i);
          if (c === 92) {
            i += 2; // 跳过转义符
            continue;
          }
          if (c === 36) {
            if (cx.char(i - 1) === 32) return -1; // 闭符号前不允许空白
            cx.addElement(cx.elt("Formula", pos, i + 1));
            return i + 1;
          }
          if (c === 10) return -1; // 不跨行
          i++;
        }
        return -1;
      },
    },
  ],
};

/** ==高亮==：整体节点（含两侧 == 标记），渲染时隐藏头尾、给内容加底色 */
export const HighlightConfig: MarkdownConfig = {
  defineNodes: [{ name: "Highlight", style: t.special(t.content) }],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== 61 /* '=' */ || cx.char(pos + 1) !== 61) return -1;
        if (cx.char(pos + 2) === 61) return -1; // === 开头拒绝（避免吞掉 setext 下划线）
        let i = pos + 3;
        while (i < cx.end - 1) {
          const c = cx.char(i);
          if (c === 61 && cx.char(i + 1) === 61) {
            cx.addElement(cx.elt("Highlight", pos, i + 2));
            return i + 2;
          }
          if (c === 10) return -1; // 不跨行
          i++;
        }
        return -1;
      },
    },
  ],
};

/** <u>下划线</u>：整体节点。before Escape 抢在内联 HTML 之前 */
export const UnderlineConfig: MarkdownConfig = {
  defineNodes: [{ name: "Underline", style: t.special(t.content) }],
  parseInline: [
    {
      name: "Underline",
      before: "Escape",
      parse(cx, next, pos) {
        if (next !== 60 /* '<' */) return -1;
        if (cx.char(pos + 1) !== 117 /* 'u' */ || cx.char(pos + 2) !== 62 /* '>' */) return -1;
        // 内容非空
        if (cx.char(pos + 3) === 60) return -1;
        let i = pos + 3;
        while (i < cx.end - 3) {
          if (
            cx.char(i) === 60 &&
            cx.char(i + 1) === 47 &&
            cx.char(i + 2) === 117 &&
            cx.char(i + 3) === 62
          ) {
            cx.addElement(cx.elt("Underline", pos, i + 4));
            return i + 4;
          }
          if (cx.char(i) === 10) return -1; // 不跨行
          i++;
        }
        return -1;
      },
    },
  ],
};
