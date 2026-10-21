// HTML 导出：marked + KaTeX 服务端渲染，导出独立可打开的 HTML 文件

import { marked } from "marked";
import katex from "katex";

const renderMath = (tex: string, display: boolean) =>
  katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" });

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
  ],
});

const EXPORT_CSS = `:root{--fg:#1f2328;--fg-soft:#59636e;--accent:#0969da;--border:#d1d9e0;--code-bg:#f6f8fa}
@media(prefers-color-scheme:dark){:root{--fg:#e6edf3;--fg-soft:#9198a1;--accent:#4493f8;--border:#3d444d;--code-bg:#151b23}}
*{box-sizing:border-box}
body{margin:0;padding:48px 24px;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:var(--fg);background:#fff;background:light-dark(#fff,#0d1117);line-height:1.75}
article{max-width:820px;margin:0 auto}
h1,h2{padding-bottom:.3em}
h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}
a{color:var(--accent)}
code{background:var(--code-bg);border-radius:4px;padding:2px 5px;font-size:.9em;font-family:ui-monospace,Consolas,monospace}
pre{background:var(--code-bg);border-radius:8px;padding:14px 16px;overflow:auto;line-height:1.5}
pre code{background:none;padding:0}
blockquote{border-left:.3em solid var(--border);margin:1em 0;padding:.2em 1em;color:var(--fg-soft)}
table{border-collapse:collapse;margin:1em 0}
th,td{border:1px solid var(--border);padding:6px 14px}
tr:nth-child(2n){background:var(--code-bg)}
img{max-width:100%;border-radius:6px}
.math-block{margin:1em 0;text-align:center;overflow-x:auto}
hr{border:none;border-top:2px solid var(--border);margin:2em 0}
.katex-display{margin:0}`;

/**
 * 拆分 frontmatter（与编辑器 frontmatterRange 同一识别规则：
 * 首行 --- 至闭合 --- / ...，最多 60 行）。
 * 导出时 frontmatter 是元数据不入正文（否则 title: xxx + --- 会被渲染成 <hr> + <h2>），
 * 其 title 字段优先作为导出 HTML 的 <title>。
 */
function splitFrontMatter(md: string): { fmTitle: string | null; body: string } {
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
          fmTitle = m[1];
          break;
        }
      }
      return { fmTitle, body: lines.slice(i + 1).join("\n") };
    }
  }
  return { fmTitle: null, body: md };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export function renderMarkdownHtml(mdText: string): string {
  return marked.parse(splitFrontMatter(mdText).body) as string;
}

export function buildExportHtml(title: string, mdText: string): string {
  const { fmTitle } = splitFrontMatter(mdText);
  const body = renderMarkdownHtml(mdText);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(fmTitle || title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css">
<style>${EXPORT_CSS}</style>
</head>
<body>
<article class="markdown-body">
${body}
</article>
</body>
</html>`;
}
