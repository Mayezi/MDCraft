// 独立行内 Markdown 渲染器：供表格单元格等脱离主文档语法树的位置复用。
// 解析器与编辑器共用同一套 Lezer 扩展（GFM / 公式 / 高亮 / 下划线），
// 只负责把一小段文本渲染成 DOM；不处理光标、不写回文档。

import { parser as markdownParser, GFM, Subscript, Superscript, type Element } from "@lezer/markdown";
import katex from "katex";
import { safeUrl } from "./htmlblock";
import { imageSrc } from "./image";
import { FormulaConfig, HighlightConfig, UnderlineConfig } from "./markdown-config";

const inlineParser = markdownParser.configure([
  GFM,
  Subscript,
  Superscript,
  FormulaConfig,
  HighlightConfig,
  UnderlineConfig,
]);

/** 运行时 Element 带 children（d.ts 未声明，按实际结构补充类型） */
type InlineElement = Element & { children: InlineElement[] };
const childrenOf = (el: Element) => (el as InlineElement).children ?? [];
const typeName = (el: Element) => inlineParser.nodeSet.types[el.type].name;
const isMark = (el: Element) => typeName(el).endsWith("Mark");

/** 渲染节点 → 对应的 Markdown 源码区间（用于点击时把 DOM 位置映射回源码偏移） */
export type SourceNode = Node & { __mdSrcFrom?: number; __mdSrcTo?: number };

export function markSourceRange(node: Node, from: number, to: number) {
  const n = node as SourceNode;
  n.__mdSrcFrom = from;
  n.__mdSrcTo = to;
}

/** 追加纯文本（textContent 天然转义，不把 Markdown 里的 < > 当 HTML） */
function appendText(parent: Node, text: string, from?: number, to?: number) {
  if (!text) return;
  const node = document.createTextNode(text);
  if (from != null && to != null) markSourceRange(node, from, to);
  parent.appendChild(node);
}

/** 点击位置 → 渲染节点上标注的源码偏移；无标注返回 null */
export function sourceOffsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const range = document.caretRangeFromPoint?.(x, y) ?? null;
  if (!range || !root.contains(range.startContainer)) return null;
  const node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    const meta = node as SourceNode;
    if (meta.__mdSrcFrom != null) {
      const max = meta.__mdSrcTo ?? meta.__mdSrcFrom + (node.textContent?.length ?? 0);
      return Math.min(meta.__mdSrcFrom + range.startOffset, max);
    }
  }
  // 元素 / KaTeX / 图片等：优先用元素自身的源码区间；否则看点击落点所在子节点
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
  while (el && el !== root) {
    const meta = el as SourceNode;
    if (meta.__mdSrcFrom != null) return meta.__mdSrcFrom;
    el = el.parentElement;
  }
  if (node instanceof HTMLElement) {
    const kids = node.childNodes;
    const child = kids[Math.min(range.startOffset, kids.length - 1)] ?? null;
    const meta = child as SourceNode | null;
    if (meta?.__mdSrcFrom != null) return meta.__mdSrcFrom;
  }
  return null;
}

/** 源码偏移 → 源码态 DOM 位置（文本节点偏移 / <br> 前后） */
export function sourcePointAtOffset(
  root: Node,
  offset: number,
): { node: Node; offset: number } | null {
  let last: { node: Node; offset: number } | null = null;
  const walk = (parent: Node): boolean => {
    const kids = Array.from(parent.childNodes);
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      const meta = child as SourceNode;
      if (meta.__mdSrcFrom != null && meta.__mdSrcTo != null) {
        if (child.nodeType === Node.TEXT_NODE) {
          const len = child.textContent?.length ?? 0;
          last = {
            node: child,
            offset: Math.max(0, Math.min(offset - meta.__mdSrcFrom, len)),
          };
          if (offset <= meta.__mdSrcTo) return true;
        } else {
          last = { node: parent, offset: i + (offset > meta.__mdSrcFrom ? 1 : 0) };
          if (offset <= meta.__mdSrcTo) return true;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE && walk(child)) {
        return true;
      }
    }
    return false;
  };
  walk(root);
  return last;
}

/** 解码 &amp; / &#x...; 等实体（仅解析器识别出的 Entity 节点） */
function decodeEntity(raw: string): string {
  const box = document.createElement("textarea");
  box.innerHTML = raw;
  return box.value;
}

/** 单元格文本 → 行内渲染 DOM；text 中的 <br> 由 HTMLTag 分支处理。
 *  sourceOffset 是 text 在单元格源码中的起点，所有文本节点都会标注源码区间。 */
export function renderInlineMarkdown(parent: Node, text: string, sourceOffset = 0) {
  const src = text.replace(/\r\n?/g, "\n");
  const els = inlineParser.parseInline(src, 0);
  renderRange(parent, src, els, 0, src.length, sourceOffset);
}

function renderRange(
  parent: Node,
  text: string,
  els: readonly Element[],
  from: number,
  to: number,
  baseOffset = 0,
) {
  let pos = from;
  for (const el of els) {
    if (el.to <= from) continue;
    if (el.from >= to) break;
    const start = Math.max(el.from, from);
    const end = Math.min(el.to, to);
    if (start > pos) appendText(parent, text.slice(pos, start), baseOffset + pos, baseOffset + start);
    renderElement(parent, text, el, start, end, baseOffset);
    pos = end;
  }
  if (pos < to) appendText(parent, text.slice(pos, to), baseOffset + pos, baseOffset + to);
}

/** 容器节点的正文区间：跳过首尾成对标记，保留嵌套行内节点 */
function markedContent(el: Element): [number, number] | null {
  const marks = childrenOf(el).filter(isMark);
  if (marks.length < 2) return null;
  const from = marks[0].to;
  const to = marks[marks.length - 1].from;
  return from < to ? [from, to] : null;
}

function renderElement(
  parent: Node,
  text: string,
  el: Element,
  from: number,
  to: number,
  baseOffset = 0,
) {
  const name = typeName(el);
  const raw = text.slice(from, to);

  switch (name) {
    case "StrongEmphasis":
    case "Emphasis":
    case "Strikethrough":
    case "Subscript":
    case "Superscript": {
      const inner = markedContent(el);
      if (!inner) break;
      const node = document.createElement(
        name === "StrongEmphasis"
          ? "strong"
          : name === "Emphasis"
            ? "em"
            : name === "Strikethrough"
              ? "del"
              : name === "Subscript"
                ? "sub"
                : "sup",
      );
      node.className =
        name === "StrongEmphasis"
          ? "md-bold"
          : name === "Emphasis"
            ? "md-italic"
            : name === "Strikethrough"
              ? "md-strike"
              : name === "Subscript"
                ? "md-sub"
                : "md-sup";
      renderRange(node, text, childrenOf(el), inner[0], inner[1], baseOffset);
      parent.appendChild(node);
      return;
    }
    case "InlineCode": {
      const inner = markedContent(el);
      if (!inner) break;
      const code = document.createElement("code");
      code.className = "md-code";
      // 代码段按字面显示，不再解析内部 Markdown
      appendText(code, text.slice(inner[0], inner[1]).replace(/\s+/g, " "), baseOffset + inner[0], baseOffset + inner[1]);
      parent.appendChild(code);
      return;
    }
    case "Highlight": {
      const node = document.createElement("mark");
      node.className = "md-highlight";
      renderInlineMarkdown(node, text.slice(from + 2, to - 2), baseOffset + from + 2);
      parent.appendChild(node);
      return;
    }
    case "Underline": {
      const node = document.createElement("u");
      node.className = "md-underline";
      renderInlineMarkdown(node, text.slice(from + 3, to - 4), baseOffset + from + 3);
      parent.appendChild(node);
      return;
    }
    case "Link": {
      const marks = childrenOf(el).filter(isMark);
      if (marks.length < 4) break;
      const href = safeUrl(text.slice(marks[2].to, marks[3].from).trim());
      const label = document.createElement("span");
      if (href) {
        label.className = "md-link";
        label.dataset.href = href;
        label.title = href;
      }
      renderRange(label, text, childrenOf(el), marks[0].to, marks[1].from, baseOffset);
      parent.appendChild(label);
      return;
    }
    case "Autolink": {
      const urlEl = childrenOf(el).find((c) => typeName(c) === "URL");
      const urlFrom = urlEl ? urlEl.from : from + 1;
      const urlTo = urlEl ? urlEl.to : to - 1;
      const href = safeUrl(urlEl ? text.slice(urlEl.from, urlEl.to) : raw.slice(1, -1));
      const node = document.createElement("span");
      if (href) {
        node.className = "md-link";
        node.dataset.href = href;
        node.title = href;
      }
      appendText(node, text.slice(urlFrom, urlTo), baseOffset + urlFrom, baseOffset + urlTo);
      parent.appendChild(node);
      return;
    }
    case "Formula": {
      const tex = raw.startsWith("$$") ? raw.slice(2, -2) : raw.slice(1, -1);
      const node = document.createElement("span");
      node.className = "md-math";
      try {
        katex.render(tex.trim(), node, { displayMode: false, throwOnError: false, strict: "ignore" });
      } catch {
        node.textContent = raw;
        node.classList.add("md-math-error");
      }
      markSourceRange(node, baseOffset + from, baseOffset + to);
      parent.appendChild(node);
      return;
    }
    case "Image": {
      const marks = childrenOf(el).filter(isMark);
      if (marks.length < 4) break;
      const alt = text.slice(marks[0].to, marks[1].from).trim();
      const rawSrc = text.slice(marks[2].to, marks[3].from).trim();
      const src = safeUrl(rawSrc);
      if (!src) break;
      const img = document.createElement("img");
      img.className = "md-table-img";
      img.src = imageSrc(src);
      img.alt = alt;
      img.loading = "lazy";
      img.draggable = false;
      markSourceRange(img, baseOffset + from, baseOffset + to);
      parent.appendChild(img);
      return;
    }
    case "HTMLTag": {
      const tag = raw.trim();
      if (/^<br\s*\/?>$/i.test(tag)) {
        const br = document.createElement("br");
        markSourceRange(br, baseOffset + from, baseOffset + to);
        parent.appendChild(br);
        return;
      }
      const imgMatch = /^<img\b([^>]*)>$/is.exec(tag);
      if (imgMatch) {
        const attrs = imgMatch[1] ?? "";
        const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        const altMatch = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
        const src = safeUrl(srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3] ?? "");
        if (src) {
          const img = document.createElement("img");
          img.className = "md-table-img";
          img.src = imageSrc(src);
          img.alt = altMatch?.[1] ?? altMatch?.[2] ?? "";
          img.loading = "lazy";
          img.draggable = false;
          markSourceRange(img, baseOffset + from, baseOffset + to);
          parent.appendChild(img);
          return;
        }
      }
      appendText(parent, raw, baseOffset + from, baseOffset + to);
      return;
    }
    case "HardBreak": {
      const br = document.createElement("br");
      markSourceRange(br, baseOffset + from, baseOffset + to);
      parent.appendChild(br);
      return;
    }
    case "Entity": {
      appendText(parent, decodeEntity(raw), baseOffset + from, baseOffset + to);
      return;
    }
    case "Escape": {
      appendText(parent, raw.slice(1), baseOffset + from, baseOffset + to);
      return;
    }
    default: {
      if (isMark(el)) return;
      if (childrenOf(el).length) {
        renderRange(parent, text, childrenOf(el), from, to, baseOffset);
        return;
      }
      appendText(parent, raw, baseOffset + from, baseOffset + to);
      return;
    }
  }
  // 解析成功但内容不完整 / URL 不安全：退回源码，避免单元格内容凭空消失
  appendText(parent, raw, baseOffset + from, baseOffset + to);
}
