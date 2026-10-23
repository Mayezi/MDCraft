// Mermaid / Flowchart / Sequence 懒加载与图表渲染器
import { WidgetType, type EditorView } from "@codemirror/view";
import { notifySuccess, notifyError } from "../lib/notify";

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

  const addItem = (icon: string, label: string, action: () => Promise<void> | void) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "md-diagram-menu-item";
    item.innerHTML = `<span class="md-diagram-menu-icon">${icon}</span><span>${label}</span>`;
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

  addItem("🖼️", "复制 PNG 图片", async () => {
    const svgEl = previewEl.querySelector("svg");
    const blob = await svgToPngBlob(svgEl, svgString, 2);
    if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        notifySuccess("已复制 PNG 图片到剪贴板");
        return;
      } catch {
        // fallback to download
      }
    }
    downloadBlob(blob, `diagram-${Date.now()}.png`);
    notifySuccess("已将 PNG 图表下载到本地");
  });

  addItem("📋", "复制 SVG 代码", async () => {
    try {
      await navigator.clipboard.writeText(svgString);
      notifySuccess("已复制 SVG 代码到剪贴板");
    } catch {
      notifyError("复制失败");
    }
  });

  const sep = document.createElement("div");
  sep.className = "md-diagram-menu-sep";
  menu.appendChild(sep);

  addItem("💾", "下载 PNG 图片", async () => {
    const svgEl = previewEl.querySelector("svg");
    const blob = await svgToPngBlob(svgEl, svgString, 2);
    downloadBlob(blob, `diagram-${Date.now()}.png`);
    notifySuccess("已导出 PNG 图片文件");
  });

  addItem("📐", "下载 SVG 矢量图", () => {
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, `diagram-${Date.now()}.svg`);
    notifySuccess("已导出 SVG 矢量图");
  });

  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const width = 160;
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
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

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "md-diagram-btn";
    exportBtn.innerHTML = `<span>导出</span><span style="font-size:9px;opacity:0.6;">▾</span>`;
    exportBtn.title = "导出图表（PNG / SVG）";
    exportBtn.disabled = true;

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "md-diagram-btn";
    toggleBtn.textContent = "编辑代码";

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

    const isDark =
      document.documentElement.dataset.themeMode === "dark" ||
      document.documentElement.dataset.theme === "night";

    const doRender = async (source: string) => {
      try {
        const svg = await renderDiagramSvg(source, this.lang, isDark);
        lastSvg = svg;
        preview.innerHTML = svg;
        exportBtn.disabled = isEditing;
      } catch (err: unknown) {
        lastSvg = "";
        exportBtn.disabled = true;
        const message = err instanceof Error ? err.message : String(err);
        preview.innerHTML = `<div class="md-diagram-error"><span class="md-diagram-error-title">图表语法提示</span><pre>${message}</pre></div>`;
      }
      view.requestMeasure();
    };

    void doRender(currentCode);

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
        toggleBtn.textContent = "图表预览";
        exportBtn.style.display = "none";
        editArea.focus();
      } else {
        editWrap.style.display = "none";
        preview.style.display = "flex";
        toggleBtn.textContent = "编辑代码";
        exportBtn.style.display = "inline-flex";
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
