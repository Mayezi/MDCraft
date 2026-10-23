// Mermaid / Flowchart / Sequence 懒加载与图表渲染器
import { WidgetType, type EditorView } from "@codemirror/view";

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

/** 块级图表交互部件（Mermaid / 流程图 / 时序图）：实时渲染 SVG + 可切换就地编辑 */
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

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "md-diagram-btn";
    toggleBtn.textContent = "编辑代码";

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

    const isDark =
      document.documentElement.dataset.themeMode === "dark" ||
      document.documentElement.dataset.theme === "night";

    const doRender = async (source: string) => {
      try {
        const svg = await renderDiagramSvg(source, this.lang, isDark);
        preview.innerHTML = svg;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        preview.innerHTML = `<div class="md-diagram-error"><span class="md-diagram-error-title">图表语法提示</span><pre>${message}</pre></div>`;
      }
      view.requestMeasure();
    };

    void doRender(currentCode);

    toggleBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      isEditing = !isEditing;
      if (isEditing) {
        preview.style.display = "none";
        editWrap.style.display = "block";
        toggleBtn.textContent = "图表预览";
        editArea.focus();
      } else {
        editWrap.style.display = "none";
        preview.style.display = "flex";
        toggleBtn.textContent = "编辑代码";
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
