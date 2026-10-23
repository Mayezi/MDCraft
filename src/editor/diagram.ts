// Mermaid / Flowchart / Sequence 懒加载与图表渲染器
import { WidgetType, type EditorView } from "@codemirror/view";
import { notifySuccess, notifyError } from "../lib/notify";

// ---------- Lucide 矢量图标定义（对齐全局风格，摒弃 emoji） ----------
const ICON_IMAGE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;
const ICON_CODE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
const ICON_DOWNLOAD = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
const ICON_VECTOR = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/></svg>`;
const ICON_COPY = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_EXPORT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
const ICON_CARET = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;"><path d="m6 9 6 6 6-6"/></svg>`;
const ICON_EDIT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_EYE = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;

let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;

async function getMermaid(isDark: boolean) {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        fontFamily: "ui-sans-serif, -apple-system, system-ui, sans-serif",
      });
      return mermaid;
    });
  }
  const mermaid = await mermaidPromise;
  mermaid.initialize({
    theme: isDark ? "dark" : "default",
  });
  return mermaid;
}

export function isDiagramLanguage(lang: string): boolean {
  const l = lang.trim().toLowerCase();
  return (
    l === "mermaid" ||
    l === "flowchart" ||
    l === "sequence" ||
    l === "sequencediagram"
  );
}

export function normalizeDiagramCode(code: string, lang: string): string {
  const trimmed = code.trim();
  const lower = lang.toLowerCase();
  if (lower === "flowchart") {
    if (!/^(flowchart|graph)\b/i.test(trimmed)) {
      return `flowchart TD\n${code}`;
    }
  } else if (lower === "sequence" || lower === "sequencediagram") {
    if (!/^sequenceDiagram\b/i.test(trimmed)) {
      return `sequenceDiagram\n${code}`;
    }
  }
  return code;
}

/** 渲染 Mermaid / Flowchart / Sequence 图表并返回 SVG 字符串 */
export async function renderDiagramSvg(code: string, lang: string, isDark: boolean): Promise<string> {
  const normalized = normalizeDiagramCode(code, lang);
  const mermaid = await getMermaid(isDark);
  const id = "mdcraft-diagram-" + Math.random().toString(36).slice(2, 9);
  const { svg } = await mermaid.render(id, normalized);
  return svg;
}

/** 将 SVG 转换为高清 PNG Blob */
async function svgToPngBlob(svgElement: SVGSVGElement | null, rawSvg: string, scale = 2): Promise<Blob> {
  let width = 800;
  let height = 600;

  if (svgElement) {
    const bbox = svgElement.getBoundingClientRect();
    if (bbox.width > 0 && bbox.height > 0) {
      width = bbox.width;
      height = bbox.height;
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("未找到有效 SVG 图表");

  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      if (!width || width === 800) width = parts[2];
      if (!height || height === 600) height = parts[3];
    }
  }
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  if (!svg.getAttribute("xmlns")) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }

  const serializer = new XMLSerializer();
  const normalizedSvg = serializer.serializeToString(svg);

  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([normalizedSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("无法创建画布上下文"));

      const isDark = document.documentElement.dataset.themeMode === "dark";
      ctx.fillStyle = isDark ? "#1e1e20" : "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("生成图片失败"));
      }, "image/png");
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("加载 SVG 图像失败"));
    };

    img.src = url;
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let activeDiagramMenu: { close: () => void } | null = null;

function openDiagramExportMenu(anchor: HTMLElement, svgString: string, previewEl: HTMLElement) {
  activeDiagramMenu?.close();

  const menu = document.createElement("div");
  menu.className = "md-diagram-menu";

  const addItem = (iconSvg: string, label: string, tag: string, action: () => Promise<void> | void) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "md-diagram-menu-item";
    item.innerHTML = `
      <span class="md-diagram-menu-icon">${iconSvg}</span>
      <span class="md-diagram-menu-label">${label}</span>
      <span class="md-diagram-menu-tag">${tag}</span>
    `;
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    item.addEventListener("click", async (e) => {
      e.stopPropagation();
      close();
      try {
        await action();
      } catch (err: unknown) {
        notifyError(err instanceof Error ? err.message : "导出失败");
      }
    });
    menu.appendChild(item);
  };

  addItem(ICON_IMAGE, "复制图片", "PNG", async () => {
    const svgEl = previewEl.querySelector("svg");
    const blob = await svgToPngBlob(svgEl, svgString, 2);
    if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        notifySuccess("图表图片已复制到剪贴板");
        return;
      } catch {
        // fallback to download
      }
    }
    downloadBlob(blob, `diagram-${Date.now()}.png`);
    notifySuccess("已将 PNG 图表下载到本地");
  });

  addItem(ICON_CODE, "复制源码", "SVG", async () => {
    try {
      await navigator.clipboard.writeText(svgString);
      notifySuccess("SVG 代码已复制到剪贴板");
    } catch {
      notifyError("复制失败");
    }
  });

  const sep = document.createElement("div");
  sep.className = "md-diagram-menu-sep";
  menu.appendChild(sep);

  addItem(ICON_DOWNLOAD, "下载图片", "PNG", async () => {
    const svgEl = previewEl.querySelector("svg");
    const blob = await svgToPngBlob(svgEl, svgString, 2);
    downloadBlob(blob, `diagram-${Date.now()}.png`);
    notifySuccess("已导出 PNG 图片文件");
  });

  addItem(ICON_VECTOR, "下载矢量图", "SVG", () => {
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, `diagram-${Date.now()}.svg`);
    notifySuccess("已导出 SVG 矢量图");
  });

  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 165;
  const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onDocPointer, true);
    window.removeEventListener("resize", close);
    menu.remove();
    if (activeDiagramMenu?.close === close) activeDiagramMenu = null;
  };

  const onDocPointer = (e: PointerEvent) => {
    if (menu.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    close();
  };

  document.addEventListener("pointerdown", onDocPointer, true);
  window.addEventListener("resize", close);
  activeDiagramMenu = { close };
}

/** 块级图表交互部件（Mermaid / 流程图 / 时序图）：实时渲染 SVG + 可切换就地编辑 + 导出 */
export class DiagramWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly lang: string,
    readonly start: number,
  ) {
    super();
  }

  eq(other: DiagramWidget) {
    return other.start === this.start && other.code === this.code && other.lang === this.lang;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "md-diagram-outer";
    wrap.dataset.diagramStart = String(this.start);

    const block = document.createElement("div");
    block.className = "md-diagram-block md-gutter md-gutter-hover";
    block.dataset.btype = "diagram";

    // 头部工具条
    const bar = document.createElement("div");
    bar.className = "md-diagram-head";

    const badge = document.createElement("span");
    badge.className = "md-diagram-badge";
    badge.textContent = this.lang || "mermaid";

    const actions = document.createElement("div");
    actions.className = "md-diagram-actions";

    // 一键复制图片按钮
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "md-diagram-btn";
    copyBtn.innerHTML = `${ICON_COPY}<span>复制</span>`;
    copyBtn.title = "复制 PNG 图片到剪贴板";
    copyBtn.disabled = true;

    // 导出下拉菜单按钮
    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "md-diagram-btn";
    exportBtn.innerHTML = `${ICON_EXPORT}<span>导出</span>${ICON_CARET}`;
    exportBtn.title = "导出图表（PNG / SVG）";
    exportBtn.disabled = true;

    // 编辑代码切换按钮
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "md-diagram-btn";
    toggleBtn.innerHTML = `${ICON_EDIT}<span>编辑代码</span>`;

    actions.appendChild(copyBtn);
    actions.appendChild(exportBtn);
    actions.appendChild(toggleBtn);
    bar.appendChild(badge);
    bar.appendChild(actions);

    const preview = document.createElement("div");
    preview.className = "md-diagram-preview";
    preview.innerHTML = `<div class="md-diagram-loading">正在渲染图表...</div>`;

    // 源码编辑区
    const editWrap = document.createElement("div");
    editWrap.className = "md-diagram-edit-wrap";
    editWrap.style.display = "none";

    const editArea = document.createElement("textarea");
    editArea.className = "md-diagram-textarea";
    editArea.value = this.code;
    editArea.spellcheck = false;
    editWrap.appendChild(editArea);

    let isEditing = false;
    let currentCode = this.code;
    let lastSvg = "";
    let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

    const isDark =
      document.documentElement.dataset.themeMode === "dark" ||
      document.documentElement.dataset.theme === "night";

    const doRender = async (source: string) => {
      try {
        const svg = await renderDiagramSvg(source, this.lang, isDark);
        lastSvg = svg;
        preview.innerHTML = svg;
        copyBtn.disabled = isEditing;
        exportBtn.disabled = isEditing;
      } catch (err: unknown) {
        lastSvg = "";
        copyBtn.disabled = true;
        exportBtn.disabled = true;
        const message = err instanceof Error ? err.message : String(err);
        preview.innerHTML = `<div class="md-diagram-error"><span class="md-diagram-error-title">图表语法提示</span><pre>${message}</pre></div>`;
      }
      view.requestMeasure();
    };

    void doRender(currentCode);

    copyBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    copyBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!lastSvg) return;
      try {
        const svgEl = preview.querySelector("svg");
        const blob = await svgToPngBlob(svgEl, lastSvg, 2);
        if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        } else {
          downloadBlob(blob, `diagram-${Date.now()}.png`);
        }
        copyBtn.innerHTML = `${ICON_CHECK}<span>已复制</span>`;
        copyBtn.classList.add("is-copied");
        notifySuccess("图表图片已复制到剪贴板");
        if (copyResetTimer) clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(() => {
          copyBtn.innerHTML = `${ICON_COPY}<span>复制</span>`;
          copyBtn.classList.remove("is-copied");
        }, 1500);
      } catch (err) {
        notifyError(err instanceof Error ? err.message : "复制失败");
      }
    });

    exportBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    exportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (lastSvg) {
        openDiagramExportMenu(exportBtn, lastSvg, preview);
      }
    });

    toggleBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      isEditing = !isEditing;
      if (isEditing) {
        preview.style.display = "none";
        editWrap.style.display = "block";
        toggleBtn.innerHTML = `${ICON_EYE}<span>图表预览</span>`;
        copyBtn.style.display = "none";
        exportBtn.style.display = "none";
        editArea.focus();
      } else {
        editWrap.style.display = "none";
        preview.style.display = "flex";
        toggleBtn.innerHTML = `${ICON_EDIT}<span>编辑代码</span>`;
        copyBtn.style.display = "inline-flex";
        exportBtn.style.display = "inline-flex";
        copyBtn.disabled = !lastSvg;
        exportBtn.disabled = !lastSvg;
        if (editArea.value !== currentCode) {
          currentCode = editArea.value;
          sync();
          void doRender(currentCode);
        }
      }
      view.requestMeasure();
    });

    const sync = () => {
      const code = editArea.value;
      const firstLine = view.state.doc.lineAt(this.start);
      let lineNum = firstLine.number + 1;
      let endLine = firstLine;
      while (lineNum <= view.state.doc.lines) {
        const l = view.state.doc.line(lineNum);
        if (/^```\s*$/.test(l.text)) {
          endLine = l;
          break;
        }
        lineNum++;
      }
      if (endLine.number > firstLine.number) {
        const from = firstLine.from;
        const to = endLine.to;
        const insert = "```" + this.lang + "\n" + code + "\n```";
        if (view.state.sliceDoc(from, to) !== insert) {
          view.dispatch({ changes: { from, to, insert } });
        }
      }
    };

    editArea.addEventListener("input", () => {
      sync();
    });

    // 双击图表直接切换至编辑源码
    preview.addEventListener("dblclick", () => {
      toggleBtn.click();
    });

    block.appendChild(bar);
    block.appendChild(preview);
    block.appendChild(editWrap);
    wrap.appendChild(block);

    return wrap;
  }
}
