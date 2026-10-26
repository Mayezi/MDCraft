// HTML 与 PDF 导出核心：marked + KaTeX + Mermaid 图表 + 思源式 PDF 排版参数与预览构建

import { marked } from "marked";
import katex from "katex";
import * as backend from "./backend";
import { docDirOf } from "../editor/image";
import { isDiagramLanguage, renderDiagramSvg } from "../editor/diagram";

const renderMath = (tex: string, display: boolean) =>
  katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" });

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

marked.use({
  gfm: true,
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start(src: string) {
        return src.indexOf("$$");
      },
      tokenizer(src: string) {
        const m = /^\$\$([\s\S]+?)\$\$(?:\n+|$)/.exec(src);
        if (m) {
          return { type: "blockMath", raw: m[0], text: m[1].trim() };
        }
        return undefined;
      },
      renderer(token) {
        return `<div class="math-block">${renderMath((token as unknown as { text: string }).text, true)}</div>`;
      },
    },
    {
      name: "inlineMath",
      level: "inline",
      start(src: string) {
        return src.indexOf("$");
      },
      tokenizer(src: string) {
        const m = /^\$(?=[^\s$])([^$\n]*?[^\s$])\$/.exec(src);
        if (m) {
          return { type: "inlineMath", raw: m[0], text: m[1] };
        }
        return undefined;
      },
      renderer(token) {
        return renderMath((token as unknown as { text: string }).text, false);
      },
    },
    {
      name: "highlight",
      level: "inline",
      start(src: string) {
        return src.indexOf("==");
      },
      tokenizer(src: string) {
        const m = /^==(?=[^\s=])([^=\n]*?[^\s=])==/.exec(src);
        if (m) {
          return { type: "highlight", raw: m[0], text: m[1] };
        }
        return undefined;
      },
      renderer(token) {
        return `<mark>${escapeHtml((token as unknown as { text: string }).text)}</mark>`;
      },
    },
  ],
});

// ---------- PDF 导出配置与纸张规格（对齐思源笔记 LOCAL_EXPORTPDF） ----------

export type PaperSize = "A3" | "A4" | "A5" | "Letter" | "Legal" | "Tabloid";
export type MarginType = "default" | "none" | "printableArea" | "custom";
export type PdfThemeStyle = "light" | "follow";

export interface PdfExportConfig {
  /** 纸张尺寸 */
  pageSize: PaperSize;
  /** 横向排版 */
  landscape: boolean;
  /** 页边距模式 */
  marginType: MarginType;
  /** 自定义上边距（英寸 in） */
  marginTop: number;
  /** 自定义右边距（英寸 in） */
  marginRight: number;
  /** 自定义下边距（英寸 in） */
  marginBottom: number;
  /** 自定义左边距（英寸 in） */
  marginLeft: number;
  /** 缩放比例（0.5 ~ 1.5，默认 1） */
  scale: number;
  /** 外观背景：浅色白纸（推荐） / 跟随当前主题 */
  theme: PdfThemeStyle;
  /** 顶部自动插入文档大标题 */
  addTitle: boolean;
  /** 自定义顶部文档大标题（空则使用文件名/frontmatter title） */
  customTitle: string;
  /** 是否启用自动分页与按标题分页 */
  paged: boolean;
  /** 在指定级别标题前强制分页（1~4 对应 H1~H4） */
  headingPageBreakLevels: number[];
  /** 是否开启斜向背景水印 */
  watermark: boolean;
  /** 自定义水印文字（空则使用文档标题） */
  watermarkText: string;
  /** 页脚显示页码 */
  showPageNumbers: boolean;
}

export const PAPER_SIZE_OPTIONS: {
  id: PaperSize;
  label: string;
  desc: string;
  widthPx: number;
  heightPx: number;
  cssSize: string;
}[] = [
  { id: "A3", label: "A3", desc: "297 × 420 mm", widthPx: 1122.24, heightPx: 1587.84, cssSize: "A3" },
  { id: "A4", label: "A4", desc: "210 × 297 mm", widthPx: 793.92, heightPx: 1122.24, cssSize: "A4" },
  { id: "A5", label: "A5", desc: "148 × 210 mm", widthPx: 559.68, heightPx: 793.92, cssSize: "A5" },
  { id: "Letter", label: "Letter", desc: "8.5 × 11 in", widthPx: 816, heightPx: 1056, cssSize: "Letter" },
  { id: "Legal", label: "Legal", desc: "8.5 × 14 in", widthPx: 816, heightPx: 1344, cssSize: "Legal" },
  { id: "Tabloid", label: "Tabloid", desc: "11 × 17 in", widthPx: 1056, heightPx: 1632, cssSize: "11in 17in" },
];

export const MARGIN_TYPE_OPTIONS: { id: MarginType; label: string }[] = [
  { id: "default", label: "默认边距" },
  { id: "printableArea", label: "最小边距" },
  { id: "none", label: "无边距" },
  { id: "custom", label: "自定义边距" },
];

export const DEFAULT_PDF_CONFIG: PdfExportConfig = {
  pageSize: "A4",
  landscape: false,
  marginType: "default",
  marginTop: 1,
  marginRight: 0.54,
  marginBottom: 1,
  marginLeft: 0.54,
  scale: 1,
  theme: "light",
  addTitle: false,
  customTitle: "",
  paged: true,
  headingPageBreakLevels: [],
  watermark: false,
  watermarkText: "",
  showPageNumbers: true,
};

const PDF_CONFIG_STORAGE_KEY = "mdcraft:pdf-export-config";

export function loadPdfExportConfig(): PdfExportConfig {
  try {
    const raw = localStorage.getItem(PDF_CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PDF_CONFIG };
    const parsed = JSON.parse(raw) as Partial<PdfExportConfig>;
    return {
      ...DEFAULT_PDF_CONFIG,
      ...parsed,
      scale: Math.min(1.5, Math.max(0.5, Number(parsed.scale) || 1)),
      headingPageBreakLevels: Array.isArray(parsed.headingPageBreakLevels)
        ? parsed.headingPageBreakLevels.filter((n) => [1, 2, 3, 4].includes(Number(n))).map(Number)
        : [],
    };
  } catch {
    return { ...DEFAULT_PDF_CONFIG };
  }
}

export function savePdfExportConfig(config: PdfExportConfig): void {
  try {
    localStorage.setItem(PDF_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* 忽略配额错误 */
  }
}

/** 计算当前纸张在 96 DPI 下的宽高（像素）与描述 */
export function getPaperDimensions(pageSize: PaperSize, landscape: boolean) {
  const spec = PAPER_SIZE_OPTIONS.find((p) => p.id === pageSize) ?? PAPER_SIZE_OPTIONS[1];
  const widthPx = landscape ? spec.heightPx : spec.widthPx;
  const heightPx = landscape ? spec.widthPx : spec.heightPx;
  return {
    widthPx,
    heightPx,
    cssSize: `${spec.cssSize} ${landscape ? "landscape" : "portrait"}`,
    label: `${spec.label} (${landscape ? "横向" : "纵向"} · ${spec.desc})`,
  };
}

/** 根据边距模式与横纵方向返回四周边距（单位：英寸 in，与思源笔记保持一致） */
export function resolveMargins(config: PdfExportConfig): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const clamp = (n: number) => Math.min(3, Math.max(0, Number.isFinite(n) ? n : 0));
  switch (config.marginType) {
    case "default":
      return config.landscape
        ? { top: 0.42, right: 0.42, bottom: 0.42, left: 0.42 }
        : { top: 1, right: 0.54, bottom: 1, left: 0.54 };
    case "none":
      return { top: 0, right: 0, bottom: 0, left: 0 };
    case "printableArea":
      return config.landscape
        ? { top: 0.07, right: 0.07, bottom: 0.07, left: 0.07 }
        : { top: 0.58, right: 0.1, bottom: 0.58, left: 0.1 };
    case "custom":
      return {
        top: clamp(config.marginTop),
        right: clamp(config.marginRight),
        bottom: clamp(config.marginBottom),
        left: clamp(config.marginLeft),
      };
  }
}

/** 生成斜向平铺水印 SVG Data URL */
export function buildWatermarkDataUrl(text: string, isDark: boolean): string {
  const clean = (text || "MDCraft").trim().slice(0, 48);
  const fill = isDark ? "rgba(255,255,255,0.07)" : "rgba(15,23,42,0.065)";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="200" viewBox="0 0 280 200"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="${fill}" font-family="-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif" font-size="15" font-weight="500" transform="rotate(-26 140 100)">${escapeHtml(clean)}</text></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

// ---------- Markdown 解析与 HTML 构建 ----------

const EXPORT_CSS = `:root{--fg:#1f2328;--fg-soft:#59636e;--accent:#0969da;--border:#d1d9e0;--code-bg:#f6f8fa;--bg-page:#ffffff;--table-border:#d1d9e0;--table-head-bg:#f6f8fa;--table-zebra:rgba(246,248,250,0.65)}
@media(prefers-color-scheme:dark){:root{--fg:#e6edf3;--fg-soft:#9198a1;--accent:#4493f8;--border:#3d444d;--code-bg:#151b23;--bg-page:#0d1117;--table-border:#3d444d;--table-head-bg:#151b23;--table-zebra:rgba(21,27,35,0.65)}}
*{box-sizing:border-box}
body{margin:0;padding:48px 24px;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:var(--fg);background:var(--bg-page);line-height:1.75}
article{max-width:820px;margin:0 auto}
h1,h2{padding-bottom:.25em}
h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
mark{background:#fff3a3;color:#1f2328;padding:1px 4px;border-radius:3px}
code{background:var(--code-bg);border-radius:4px;padding:2px 5px;font-size:.9em;font-family:ui-monospace,Consolas,monospace}
pre{background:var(--code-bg);border-radius:8px;padding:14px 16px;overflow:auto;line-height:1.5;border:1px solid var(--border)}
pre code{background:none;padding:0;border:0}
ul{list-style-type:disc!important;padding-left:1.6em;margin:0 0 1em}
ol{list-style-type:decimal!important;padding-left:1.6em;margin:0 0 1em}
ul ul,ol ul{list-style-type:circle!important}
ul ul ul,ol ul ul{list-style-type:square!important}
ol ol,ul ol{list-style-type:lower-alpha!important}
li+li{margin-top:.25em}
ul.contains-task-list{list-style-type:none!important;padding-left:.3em!important}
li.task-list-item{list-style-type:none!important;display:flex;align-items:baseline;gap:.45em}
input[type="checkbox"]{appearance:none;-webkit-appearance:none;width:14px;height:14px;margin:0;vertical-align:-2px;flex-shrink:0;border:1.5px solid var(--fg-soft);border-radius:4px;background:var(--bg-page);position:relative;display:inline-block;transform:translateY(1.5px)}
input[type="checkbox"]:checked{background-color:var(--accent);border-color:var(--accent);background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3E%3C/svg%3E");background-size:100% 100%;background-position:center;background-repeat:no-repeat}
blockquote{border-left:.3em solid var(--accent);margin:1em 0;padding:.2em 1em;color:var(--fg-soft);background:var(--code-bg);border-radius:0 6px 6px 0}
table{border-collapse:collapse;margin:.8em 0 1.2em;width:auto;max-width:100%}
th,td{border:1px solid var(--table-border);padding:6px 13px;line-height:1.6;font-size:.95em;text-align:left;word-break:break-word}
th{background:var(--table-head-bg);font-weight:600}
tbody tr:nth-child(2n) td{background:var(--table-zebra)}
td:empty::after{content:"\\00a0"}
table img{max-width:100%;max-height:2.4em;vertical-align:middle;border-radius:4px}
img{max-width:100%;border-radius:6px}
.math-block{margin:1em 0;text-align:center;overflow-x:auto}
.md-export-diagram{margin:1.2em 0;text-align:center;overflow-x:auto}
.md-export-diagram svg{max-width:100%;height:auto}
hr{border:none;border-top:1px solid var(--border);margin:2em 0}
.katex-display{margin:0}`;

/**
 * 拆分 frontmatter（与编辑器 frontmatterRange 同一识别规则：
 * 首行 --- 至闭合 --- / ...，最多 60 行）。
 * 导出时 frontmatter 是元数据不入正文（否则 title: xxx + --- 会被渲染成 <hr> + <h2>），
 * 其 title 字段优先作为导出文档的默认标题。
 */
export function splitFrontMatter(md: string): { fmTitle: string | null; body: string } {
  if (!md.startsWith("---\n") && md !== "---" && !md.startsWith("---\r\n")) {
    return { fmTitle: null, body: md };
  }
  const lines = md.split("\n");
  const limit = Math.min(lines.length, 60);
  for (let i = 1; i < limit; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") {
      let fmTitle: string | null = null;
      for (const fmLine of lines.slice(1, i)) {
        const m = /^title:\s*(.+?)\s*$/.exec(fmLine.trim());
        if (m) {
          fmTitle = m[1].replace(/^["']|["']$/g, "");
          break;
        }
      }
      return { fmTitle, body: lines.slice(i + 1).join("\n") };
    }
  }
  return { fmTitle: null, body: md };
}

/** 将文档内的相对图片路径解析为本地绝对路径 */
function resolveImageAbsPath(src: string, docPath: string | null): string | null {
  const s = src.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("/") || s.startsWith("//")) return null;
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\")) return s;
  const dir = docDirOf(docPath);
  if (!dir) return null;
  const sep = dir.includes("\\") ? "\\" : "/";
  const rel = s.replace(/^\.\//, "").split(/[\\/]/).join(sep);
  return dir + sep + rel;
}

/** 绝对路径转 file:/// URL（供无头浏览器导出 PDF 时直接加载本地图片） */
function absPathToFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  return `file:///${encodeURI(normalized)}`;
}

export function renderMarkdownHtml(mdText: string): string {
  return marked.parse(splitFrontMatter(mdText).body) as string;
}

/**
 * 渲染用于预览 / PDF 导出的正文 HTML：
 * - 将 mermaid / flowchart / sequence 围栏块标记为 `.md-export-diagram` 容器，供后续异步渲染 SVG；
 * - 将本地相对图片同时附上预览 URL（asset 协议）与 `data-file-url`（file:/// 协议）。
 */
export function renderExportBodyHtml(mdText: string, docPath: string | null): string {
  const rawHtml = renderMarkdownHtml(mdText);
  if (typeof DOMParser === "undefined") return rawHtml;

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="root">${rawHtml}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return rawHtml;

  // 1. 识别 Mermaid / Flowchart / Sequence 代码块
  root.querySelectorAll("pre > code").forEach((codeEl) => {
    const cls = codeEl.className || "";
    const m = /language-([\w-]+)/i.exec(cls);
    const lang = m ? m[1] : "";
    if (!lang || !isDiagramLanguage(lang)) return;
    const rawCode = codeEl.textContent ?? "";
    const pre = codeEl.parentElement;
    if (!pre) return;
    const wrapper = doc.createElement("div");
    wrapper.className = "md-export-diagram";
    wrapper.setAttribute("data-diagram-lang", lang);
    wrapper.setAttribute("data-diagram-code", rawCode);
    wrapper.innerHTML = `<div class="md-export-diagram-loading">正在渲染图表…</div>`;
    pre.replaceWith(wrapper);
  });

  // 2. 处理本地图片路径
  root.querySelectorAll("img").forEach((img) => {
    const rawSrc = img.getAttribute("src") ?? "";
    const abs = resolveImageAbsPath(rawSrc, docPath);
    if (abs && backend.isTauri) {
      img.setAttribute("src", backend.assetSrc(abs));
      img.setAttribute("data-file-url", absPathToFileUrl(abs));
    }
  });

  // 3. 给各级标题标记级别，方便按标题分页
  root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    const level = Number(h.tagName.slice(1));
    h.setAttribute("data-heading-level", String(level));
  });

  // 4. 识别并标记任务列表项，支持精致复选框与消除默认圆点
  root.querySelectorAll("li").forEach((li) => {
    const cb = li.querySelector('input[type="checkbox"]');
    if (cb) {
      li.classList.add("task-list-item");
      cb.classList.add("pdf-task-checkbox");
      const parentUl = li.parentElement;
      if (parentUl && parentUl.tagName === "UL") {
        parentUl.classList.add("contains-task-list");
      }
    }
  });

  return root.innerHTML;
}

/**
 * 在预览容器挂载后：
 * 1) 异步将 `.md-export-diagram` 渲染为矢量 SVG；
 * 2) 应用思源式「按标题分页」标记（跳过文档首个元素如果是标题，避免第一页空白）；
 * 3) 对超宽表格自动计算缩放，防止导出 PDF 时右侧被裁切。
 */
export async function hydrateExportPreviewDom(
  container: HTMLElement,
  isDark: boolean,
  headingPageBreakLevels: number[],
  paged: boolean,
): Promise<void> {
  // 1. 渲染所有 Mermaid 图表
  const diagrams = Array.from(container.querySelectorAll<HTMLElement>(".md-export-diagram"));
  await Promise.all(
    diagrams.map(async (el) => {
      const lang = el.getAttribute("data-diagram-lang") || "mermaid";
      const code = el.getAttribute("data-diagram-code") || "";
      const renderedTheme = el.getAttribute("data-rendered-theme");
      const targetTheme = isDark ? "dark" : "light";
      if (el.querySelector("svg") && renderedTheme === targetTheme) return;
      try {
        const svg = await renderDiagramSvg(code, lang, isDark);
        el.innerHTML = svg;
        el.setAttribute("data-rendered-theme", targetTheme);
      } catch {
        el.innerHTML = `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
    }),
  );

  // 2. 应用按标题分页（跳过正文第一个标题，避免产生空白首页）
  const levelSet = new Set(paged ? headingPageBreakLevels : []);
  const headings = Array.from(container.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
  headings.forEach((h, idx) => {
    const lv = Number(h.getAttribute("data-heading-level") || h.tagName.slice(1));
    const isVeryFirst =
      idx === 0 &&
      h.previousElementSibling === null &&
      (!h.parentElement || h.parentElement.firstElementChild === h);
    if (paged && levelSet.has(lv) && !isVeryFirst) {
      h.setAttribute("data-pdf-page-break", "true");
    } else {
      h.removeAttribute("data-pdf-page-break");
    }
  });

  // 3. 超宽表格自适应缩放（对齐思源笔记 fixBlockWidth 逻辑）
  const maxContentW = container.clientWidth;
  if (maxContentW > 0) {
    container.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
      table.style.zoom = "";
      if (table.scrollWidth > maxContentW + 4) {
        const ratio = Math.max(0.5, Math.floor((maxContentW / table.scrollWidth) * 100 - 1) / 100);
        table.style.zoom = String(ratio);
      }
    });
  }
}

/** 收集当前页面已加载的 KaTeX 样式规则，确保离线导出 PDF 时数学公式排版完整 */
function collectLoadedKatexCss(): string {
  if (typeof document === "undefined") return "";
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      let hasKatex = false;
      for (let i = 0; i < Math.min(rules.length, 30); i++) {
        if (rules[i].cssText.includes(".katex")) {
          hasKatex = true;
          break;
        }
      }
      if (hasKatex) {
        for (let i = 0; i < rules.length; i++) {
          const text = rules[i].cssText;
          // 跳过相对字体 @font-face（无头浏览器在 temp 目录无法解析相对路径字体，交由 CDN 兜底或内置符号渲染）
          if (text.startsWith("@font-face") && !text.includes("data:") && !text.includes("http")) {
            continue;
          }
          chunks.push(text);
        }
      }
    } catch {
      /* 忽略跨域样式表 */
    }
  }
  return chunks.join("\n");
}

export interface PdfThemeColors {
  bgColor: string;
  fgColor: string;
  fgSoftColor: string;
  accentColor: string;
  borderColor: string;
  codeBgColor: string;
  tableBorderColor?: string;
  tableHeadBgColor?: string;
  tableZebraColor?: string;
}

/** PDF 预览与导出共用的正文排版样式 */
export function buildPdfArticleCss(options: { isDark: boolean } & PdfThemeColors): string {
  const {
    bgColor,
    fgColor,
    fgSoftColor,
    accentColor,
    borderColor,
    codeBgColor,
    tableBorderColor = borderColor,
    tableHeadBgColor = codeBgColor,
    tableZebraColor = `color-mix(in srgb, ${codeBgColor} 55%, transparent)`,
  } = options;
  return `
.pdf-paper-root {
  --pdf-bg: ${bgColor};
  --pdf-fg: ${fgColor};
  --pdf-fg-soft: ${fgSoftColor};
  --pdf-accent: ${accentColor};
  --pdf-border: ${borderColor};
  --pdf-code-bg: ${codeBgColor};
  --pdf-table-border: ${tableBorderColor};
  --pdf-table-head-bg: ${tableHeadBgColor};
  --pdf-table-zebra: ${tableZebraColor};
  color: var(--pdf-fg);
  background-color: var(--pdf-bg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.75;
  word-wrap: break-word;
  overflow-wrap: break-word;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.pdf-paper-root * {
  box-sizing: border-box;
}
.pdf-paper-root .pdf-doc-title {
  font-size: 2.1em;
  font-weight: 700;
  line-height: 1.3;
  margin: 0 0 0.8em 0;
  padding-bottom: 0.2em;
  color: var(--pdf-fg);
}
.pdf-paper-root h1,
.pdf-paper-root h2,
.pdf-paper-root h3,
.pdf-paper-root h4,
.pdf-paper-root h5,
.pdf-paper-root h6 {
  color: var(--pdf-fg);
  font-weight: 600;
  line-height: 1.35;
  margin-top: 1.35em;
  margin-bottom: 0.55em;
  page-break-after: avoid;
  break-after: avoid;
}
.pdf-paper-root h1:first-child,
.pdf-paper-root h2:first-child,
.pdf-paper-root h3:first-child {
  margin-top: 0;
}
.pdf-paper-root h1 {
  font-size: 1.75em;
  padding-bottom: 0.2em;
}
.pdf-paper-root h2 {
  font-size: 1.42em;
  padding-bottom: 0.15em;
}
.pdf-paper-root h3 { font-size: 1.2em; }
.pdf-paper-root h4 { font-size: 1.05em; }
.pdf-paper-root p,
.pdf-paper-root ul,
.pdf-paper-root ol,
.pdf-paper-root blockquote,
.pdf-paper-root table,
.pdf-paper-root pre {
  margin-top: 0;
  margin-bottom: 1em;
}
.pdf-paper-root ul {
  list-style-type: disc !important;
  padding-left: 1.6em;
}
.pdf-paper-root ol {
  list-style-type: decimal !important;
  padding-left: 1.6em;
}
.pdf-paper-root ul ul,
.pdf-paper-root ol ul {
  list-style-type: circle !important;
}
.pdf-paper-root ul ul ul,
.pdf-paper-root ol ul ul {
  list-style-type: square !important;
}
.pdf-paper-root ol ol,
.pdf-paper-root ul ol {
  list-style-type: lower-alpha !important;
}
.pdf-paper-root li {
  margin-top: 0.25em;
}
.pdf-paper-root li + li {
  margin-top: 0.25em;
}
.pdf-paper-root ul.contains-task-list {
  list-style-type: none !important;
  padding-left: 0.35em !important;
}
.pdf-paper-root li.task-list-item {
  list-style-type: none !important;
  display: flex;
  align-items: baseline;
  gap: 0.5em;
}
.pdf-paper-root input.pdf-task-checkbox,
.pdf-paper-root .task-list-item input[type="checkbox"],
.pdf-paper-root input[type="checkbox"] {
  appearance: none !important;
  -webkit-appearance: none !important;
  width: 14.5px;
  height: 14.5px;
  margin: 0;
  vertical-align: -2px;
  flex-shrink: 0;
  border: 1.5px solid var(--pdf-fg-soft) !important;
  border-radius: 4px;
  background-color: var(--pdf-bg);
  cursor: default;
  position: relative;
  display: inline-block;
  transform: translateY(2px);
  box-sizing: border-box;
}
.pdf-paper-root input.pdf-task-checkbox:checked,
.pdf-paper-root .task-list-item input[type="checkbox"]:checked,
.pdf-paper-root input[type="checkbox"]:checked {
  background-color: var(--pdf-accent) !important;
  border-color: var(--pdf-accent) !important;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3E%3C/svg%3E") !important;
  background-size: 100% 100% !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
}
.pdf-paper-root a {
  color: var(--pdf-accent);
  text-decoration: none;
}
.pdf-paper-root mark {
  background: #fff3a3;
  color: #1f2328;
  padding: 1px 4px;
  border-radius: 3px;
}
.pdf-paper-root code {
  background: var(--pdf-code-bg);
  border-radius: 4px;
  padding: 2px 5px;
  font-size: 0.88em;
  font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}
.pdf-paper-root pre {
  background: var(--pdf-code-bg);
  border: 1px solid var(--pdf-border);
  border-radius: 8px;
  padding: 12px 15px;
  overflow-x: auto;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  page-break-inside: avoid;
  break-inside: avoid;
}
.pdf-paper-root pre code {
  background: none;
  padding: 0;
  border: 0;
  font-size: 0.86em;
}
.pdf-paper-root blockquote {
  border-left: 3.5px solid var(--pdf-accent);
  margin: 1em 0;
  padding: 0.35em 1em;
  color: var(--pdf-fg-soft);
  background: var(--pdf-code-bg);
  border-radius: 0 6px 6px 0;
}
.pdf-paper-root blockquote > :last-child {
  margin-bottom: 0;
}
.pdf-paper-root table {
  border-collapse: collapse;
  margin: 0.8em 0 1.2em 0;
  width: auto;
  max-width: 100%;
  page-break-inside: auto;
}
.pdf-paper-root tr {
  page-break-inside: avoid;
  break-inside: avoid;
}
.pdf-paper-root th,
.pdf-paper-root td {
  border: 1px solid var(--pdf-table-border);
  padding: 6px 13px;
  line-height: 1.6;
  font-size: 0.95em;
  text-align: left;
  word-break: break-word;
}
.pdf-paper-root th {
  background-color: var(--pdf-table-head-bg);
  font-weight: 600;
}
.pdf-paper-root tbody tr:nth-child(2n) td {
  background-color: var(--pdf-table-zebra);
}
.pdf-paper-root td:empty::after {
  content: "\\00a0";
}
.pdf-paper-root table img {
  max-width: 100%;
  max-height: 2.4em;
  vertical-align: middle;
  border-radius: 4px;
}
.pdf-paper-root img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  page-break-inside: avoid;
  break-inside: avoid;
}
.pdf-paper-root .math-block {
  margin: 1.1em 0;
  text-align: center;
  overflow-x: auto;
  page-break-inside: avoid;
  break-inside: avoid;
}
.pdf-paper-root .md-export-diagram {
  margin: 1.2em 0;
  text-align: center;
  overflow-x: auto;
  page-break-inside: avoid;
  break-inside: avoid;
}
.pdf-paper-root .md-export-diagram svg {
  max-width: 100%;
  height: auto;
}
.pdf-paper-root hr {
  border: none;
  border-top: 1px solid var(--pdf-border);
  margin: 1.75em 0;
}
.pdf-paper-root [data-pdf-page-break="true"] {
  page-break-before: always;
  break-before: page;
}
`;
}

/**
 * 构建用于桌面无头浏览器导出 PDF 或 iframe 系统打印的完整独立 HTML 文档。
 * 将预览区已渲染好的 DOM（含 Mermaid SVG）转换为独立 HTML，保证导出结果与预览完全一致。
 */
export function buildStandalonePdfHtml(params: {
  title: string;
  previewNode: HTMLElement;
  config: PdfExportConfig;
  isDark: boolean;
  colors: PdfThemeColors;
}): string {
  const { title, previewNode, config, isDark, colors } = params;
  const { cssSize } = getPaperDimensions(config.pageSize, config.landscape);
  const margins = resolveMargins(config);

  // 克隆预览区节点并把本地图片的 src 切换为 data-file-url（供无头浏览器直接读取磁盘文件）
  const clone = previewNode.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("img").forEach((img) => {
    const fileUrl = img.getAttribute("data-file-url");
    if (fileUrl) {
      img.setAttribute("src", fileUrl);
    }
  });

  const katexCss = collectLoadedKatexCss();
  const articleCss = buildPdfArticleCss({ isDark, ...colors });
  const watermarkText = (config.watermarkText || title || "MDCraft").trim();
  const watermarkBg = config.watermark ? buildWatermarkDataUrl(watermarkText, isDark) : "none";

  const marginCss = `${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in`;
  const pageNumRule = config.showPageNumbers
    ? `@bottom-center { content: counter(page) " / " counter(pages); font-size: 9pt; color: ${colors.fgSoftColor}; font-family: -apple-system, sans-serif; }`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css">
<style>
${katexCss}
${articleCss}
@page {
  size: ${cssSize};
  margin: ${marginCss};
  ${pageNumRule}
}
html, body {
  margin: 0;
  padding: 0;
  background-color: ${colors.bgColor};
  color: ${colors.fgColor};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.pdf-export-wrapper {
  zoom: ${config.scale};
  width: 100%;
}
.pdf-watermark-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background-image: ${watermarkBg};
  background-repeat: repeat;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
</style>
</head>
<body class="pdf-paper-root">
${config.watermark ? `<div class="pdf-watermark-layer" aria-hidden="true"></div>` : ""}
<div class="pdf-export-wrapper">
${clone.innerHTML}
</div>
</body>
</html>`;
}

export function buildExportHtml(title: string, mdText: string): string {
  const { fmTitle } = splitFrontMatter(mdText);
  const body = renderMarkdownHtml(mdText);
  const katexCss = collectLoadedKatexCss();
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(fmTitle || title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css">
<style>${katexCss}\n${EXPORT_CSS}</style>
</head>
<body>
<article class="markdown-body">
${body}
</article>
</body>
</html>`;
}
