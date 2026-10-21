// 原生 HTML 块渲染（GitHub 徽章行 / <p align=center> / 内嵌表格 等）
//
// Markdown 中的 HTMLBlock（CommonMark 块级 HTML，由 @lezer/markdown 核心解析）
// 恒定整块替换为渲染 DOM（纯渲染，无光标进入显源码）：渲染态块不可编辑，
// 编辑统一走源码模式（左下角开关 / Ctrl+/）。点击块内链接：Ctrl/Cmd+点击
// 打开外链，普通点击不导航（复制徽章链接用右键或 Ctrl+点击）。
//
// 安全网（白名单净化，README 常见元素优先）：
//   · 标签白名单：p/div/span/a/img/表格/列表/kbd/sub/sup/details…（svg 基础子集）；
//     script/iframe/style/form/object 等危险元素整棵子树删除（svg 内同样适用）；未知标签 unwrap 保留子内容
//   · 属性白名单 + on* 事件属性无条件剔除
//   · URL 协议白名单（http/https/mailto/#/相对路径/受限 data:image）——
//     javascript: / vbscript: / data:text 等一律拒收
//   · style 按 CSS 属性白名单逐条过滤，value 含 url( / expression / @import 直接丢弃
//   · target=_blank 强制补 rel="noopener noreferrer"
//   · 嵌套深度上限 64：手工构造的超深 HTML 不会拖垮渲染

import { WidgetType, type EditorView } from "@codemirror/view";
import { imageSrc } from "./image";
import { openUrl } from "../lib/backend";

// ---------- 净化器 ----------

/** 允许的元素标签（HTML 大写形态；svg 命名空间单列） */
const ALLOWED_TAGS = new Set([
  // 结构 / 段落
  "P", "DIV", "SPAN", "CENTER", "BR", "HR", "PRE", "BLOCKQUOTE",
  "DETAILS", "SUMMARY", "ADDRESS", "FIGURE", "FIGCAPTION",
  "SECTION", "HEADER", "FOOTER", "MAIN", "ARTICLE", "ASIDE", "NAV",
  // 标题
  "H1", "H2", "H3", "H4", "H5", "H6",
  // 行内文字
  "B", "STRONG", "I", "EM", "U", "S", "DEL", "INS", "MARK", "SMALL", "BIG",
  "CODE", "KBD", "SAMP", "VAR", "TT", "CITE", "Q", "DFN", "ABBR",
  "SUB", "SUP", "FONT", "RUBY", "RT", "RP", "WBR",
  // 链接 / 媒体
  "A", "IMG",
  // 列表
  "UL", "OL", "LI", "DL", "DT", "DD", "MENU",
  // 表格
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD",
  "COLGROUP", "COL", "CAPTION",
]);

/** svg 白名单（inline svg 徽章常见元素；text 内文本子节点天然安全） */
const ALLOWED_SVG_TAGS = new Set([
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon",
  "ellipse", "text", "tspan", "title",
]);

const SVG_NS = "http://www.w3.org/2000/svg";

/** 整棵子树删除（活动内容 / 表单 / 元信息——README 场景不应存在） */
const DROP_TREE = new Set([
  "SCRIPT", "STYLE", "LINK", "META", "BASE", "TITLE", "HEAD", "BODY", "HTML",
  "IFRAME", "OBJECT", "EMBED", "APPLET", "FRAME", "FRAMESET", "CANVAS",
  "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "OPTION", "OPTGROUP",
  "VIDEO", "AUDIO", "SOURCE", "TRACK", "NOSCRIPT", "TEMPLATE", "SLOT",
  "DIALOG", "MATH", "MAP", "AREA", "SVG-FOREIGN",
]);

/** 全局属性白名单（排版/表格杂项，对齐 GitHub 渲染可感知的子集） */
const GLOBAL_ATTRS = new Set([
  "align", "title", "width", "height", "dir", "lang",
  "colspan", "rowspan", "valign", "nowrap", "scope", "abbr",
]);

/** 按标签放行的属性（其余属性移除；style 单独净化） */
const TAG_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "target", "rel"]),
  IMG: new Set(["src", "alt", "loading", "srcset"]),
  OL: new Set(["start", "type", "reversed"]),
  LI: new Set(["value"]),
  DETAILS: new Set(["open"]),
  FONT: new Set(["color", "face", "size"]),
  TABLE: new Set(["border", "cellpadding", "cellspacing", "frame", "rules"]),
  TH: new Set(["headers"]),
  TD: new Set(["headers"]),
  img: new Set(["xlink:href"]),
};

/** svg 属性白名单 */
const SVG_ATTRS = new Set([
  "viewBox", "xmlns", "width", "height", "x", "y", "cx", "cy", "r",
  "rx", "ry", "x1", "y1", "x2", "y2", "d", "points",
  "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-opacity",
  "opacity", "transform", "text-anchor", "dominant-baseline",
  "font-size", "font-weight", "font-family", "preserveAspectRatio", "version",
  "aria-hidden", "focusable", "xmlns:xlink", "xlink:href",
]);

/** style 属性的 CSS 属性名白名单 */
const ALLOWED_CSS = new Set([
  "text-align", "text-decoration", "text-transform", "text-indent",
  "letter-spacing", "word-spacing", "line-height", "white-space",
  "color", "background-color", "opacity",
  "font-weight", "font-style", "font-size", "font-family",
  "max-width", "min-width", "width", "max-height", "min-height", "height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-width", "border-style", "border-color", "border-radius", "border-collapse", "border-spacing",
  "display", "float", "vertical-align", "box-shadow", "list-style",
  "list-style-type", "list-style-position", "table-layout", "caption-side",
  "empty-cells", "gap", "row-gap", "column-gap", "flex-direction",
]);

/** style 值危险特征：命中即丢弃该条声明（外链请求 / 脚本向量 / 引入行为） */
const CSS_VALUE_DANGER = /javascript\s*:|vbscript\s*:|expression\s*\(|url\s*\(|@import|behavior|<|>/i;

/** URL 协议白名单；返回安全地址，不安全返回 null（拒绝该属性）
 *  ⚠ scheme 检查必须先于相对路径判定——相对路径正则的字符集含 ':'，
 *    若先匹配会把 javascript:/data: 等伪协议误判为相对路径放行 */
export function safeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^mailto:/i.test(v)) return v;
  if (v.startsWith("#")) return v;
  // data:image 内嵌位图白名单（svg+xml 可携带脚本，拒收）
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(v)) return v;
  // 其余一切带 scheme 的 URL 拒收（javascript:/vbscript:/file:/data:text…）
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  // 相对路径（./ ../ / 站内绝对 / 纯文件名 —— 到此处必无 scheme）
  if (/^[./?#]/.test(v) || /^[a-z0-9._~!$&'()*+,;=%@-]+([/?#]|$)/i.test(v)) return v;
  return null;
}

/** style 值逐条净化：白名单属性 + 危险值剔除，其余声明丢弃 */
function sanitizeStyle(raw: string): string {
  const out: string[] = [];
  for (const decl of raw.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    let val = decl.slice(i + 1).trim();
    if (!prop || !val) continue;
    if (prop.startsWith("-") || !ALLOWED_CSS.has(prop)) continue;
    if (CSS_VALUE_DANGER.test(val)) continue;
    val = val.replace(/["'\\]/g, ""); // 防逃逸引号转义
    out.push(`${prop}: ${val}`);
  }
  return out.join("; ");
}

/** URL 类属性名 → 是否按图片地址放行（srcset 逐段净化） */
function cleanSrcset(raw: string): string | null {
  const parts: string[] = [];
  for (const seg of raw.split(",")) {
    const m = /^\s*(\S+)(\s+\S+)?\s*$/.exec(seg);
    if (m) {
      const url = safeUrl(m[1]);
      if (url) parts.push(url + (m[2] ? " " + m[2] : ""));
    }
  }
  return parts.length ? parts.join(", ") : null;
}

const MAX_DEPTH = 64;

/** 元素属性净化（就地写入 target；“危险属性直接不带”，URL/style 走白名单） */
function cleanAttrs(src: Element, target: Element, isSvg: boolean) {
  const tagAttrs = TAG_ATTRS[src.tagName];
  for (const attr of Array.from(src.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    // on* 事件 / 一切 xmlns 命名空间注入（svg 白名单内声明的除外）直接剔除
    if (name.startsWith("on") || name.startsWith("xmlns") || name === "class" || name === "id") {
      continue;
    }
    if (name === "style") {
      const css = sanitizeStyle(value);
      if (css) target.setAttribute("style", css);
      continue;
    }
    if (isSvg) {
      if (SVG_ATTRS.has(name)) {
        if (name === "xlink:href" || name === "href") {
          // svg 内部引用仅放行站内锚点（#id），外部引用丢弃
          if (value.startsWith("#")) target.setAttribute(name, value);
        } else {
          target.setAttribute(name, value);
        }
      }
      continue;
    }
    if (name === "srcset" && src.tagName === "IMG") {
      const s = cleanSrcset(value);
      if (s) target.setAttribute("srcset", s);
      continue;
    }
    if (GLOBAL_ATTRS.has(name) || tagAttrs?.has(name)) {
      if (name === "href" || name === "src") {
        const u = safeUrl(value);
        if (u) target.setAttribute(name, u);
      } else {
        target.setAttribute(name, value);
      }
    }
  }
}

/** 净化一棵解析好的 DOM 子树 → DocumentFragment（不安全结构被移除/降级） */
export function sanitizeHtml(src: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(src, "text/html");
  const frag = document.createDocumentFragment();

  const walk = (node: Node, depth: number, out: Node): void => {
    if (depth > MAX_DEPTH) return;
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out.appendChild(document.createTextNode(child.textContent ?? ""));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue; // 注释等直接丢弃
      const el = child as Element;
      // 危险元素整棵丢弃（svg 内外的 script/iframe 等同规则）
      if (DROP_TREE.has(el.tagName)) continue;
      // <svg> 子树内部按 svg 白名单走（命名空间元素）
      const inSvg = out instanceof Element && (out as Element).namespaceURI === SVG_NS;
      const isSvgRoot = el.tagName.toLowerCase() === "svg";
      const isSvg = inSvg || isSvgRoot;
      const allowed = isSvg
        ? ALLOWED_SVG_TAGS.has(el.tagName.toLowerCase())
        : ALLOWED_TAGS.has(el.tagName);
      if (!allowed) {
        walk(el, depth + 1, out); // 未知标签：unwrap，子内容保留
        continue;
      }
      let made: Element;
      if (isSvgRoot) {
        made = document.createElementNS(SVG_NS, "svg");
      } else if (inSvg) {
        made = document.createElementNS(SVG_NS, el.tagName.toLowerCase());
      } else {
        made = document.createElement(el.tagName);
      }
      cleanAttrs(el, made, isSvg);
      // a[target=_blank] 强制补 noopener（window.open 新开页的安全基线）
      if (el.tagName === "A") {
        const target = made.getAttribute("target");
        if (target === "_blank") {
          made.setAttribute("rel", "noopener noreferrer");
        }
      }
      out.appendChild(made);
      walk(el, depth + 1, made);
    }
  };

  walk(parsed.body, 0, frag);
  return frag;
}

// ---------- Widget ----------

/** HTML 块渲染件（块级 widget，StateField 提供）：恒定渲染，块不可编辑
 *  · eq 按 raw 判等（整块源码不变即复用 DOM）
 *  · img 相对路径走 imageSrc（本地资源协议，与 ![]() 图同一解析基准）
 *  · img 加载完成/失败 → requestMeasure（异步高度变化须重测行位）
 *  · ignoreEvent=true：CM 不接手 widget 内事件——点击不动光标（块无编辑入口，
 *    编辑走源码模式）；块内文本可用原生拖选，链接导航在 widget 内部拦截 */
export class HTMLBlockWidget extends WidgetType {
  constructor(readonly raw: string) {
    super();
  }
  eq(other: HTMLBlockWidget) {
    return other.raw === this.raw;
  }
  toDOM(view: EditorView) {
    // ⚠ 块级 widget 禁 margin（CM6 heightMap 不计 margin → 点击错行），间距用外层 padding
    const outer = document.createElement("div");
    outer.className = "md-html-block-outer";
    const wrap = document.createElement("div");
    wrap.className = "md-html-block md-gutter md-gutter-hover";
    wrap.dataset.btype = "html";
    wrap.appendChild(sanitizeHtml(this.raw));
    // 图片：相对路径解析 + 异步加载后高度重测
    for (const img of Array.from(wrap.querySelectorAll<HTMLImageElement>("img"))) {
      const src = img.getAttribute("src");
      if (src) img.src = imageSrc(src); // imageSrc 对外链原样返回
      img.loading = "lazy";
      img.addEventListener("load", () => view.requestMeasure());
      img.addEventListener("error", () => view.requestMeasure());
    }
    // 链接：默认点击不导航（编辑器内误触防护——导航发生在 click 事件，
    // 必须在 click 上 preventDefault，mousedown 拦不住）；Ctrl/Cmd+点击打开 http(s) 外链
    wrap.addEventListener("click", (e) => {
      const a = (e.target as Element).closest("a[href]");
      if (!a) return; // 非链接：放行（原生文本选择等不受影响）
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const href = a.getAttribute("href") ?? "";
        if (/^https?:/i.test(href)) void openUrl(href);
      }
    });
    outer.appendChild(wrap);
    return outer;
  }
  ignoreEvent() {
    return true; // 渲染态块无编辑入口：CM 不接手事件，光标不动
  }
}

/** 行内 <br/>（HTMLTag）：渲染为真实换行 —— README 常见的手动分行 */
export class BrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "md-inline-br";
    wrap.appendChild(document.createElement("br"));
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}
