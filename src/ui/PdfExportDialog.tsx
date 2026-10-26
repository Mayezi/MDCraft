// 思源式 PDF 导出预览与设置弹窗：左侧实时纸张分页预览 + 右侧排版参数面板
// 修改任意参数即时反应到左侧纸张预览，并持久化到 localStorage（对齐思源 LOCAL_EXPORTPDF）

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Download,
  FileType,
  Printer,
  RotateCcw,
  X,
} from "lucide-react";
import { useStore } from "../store";
import * as backend from "../lib/backend";
import {
  closePdfExportDialog,
  notifyExportedFile,
  usePdfExportTarget,
  type PdfExportTarget,
} from "../lib/docActions";
import {
  buildPdfArticleCss,
  buildStandalonePdfHtml,
  buildWatermarkDataUrl,
  DEFAULT_PDF_CONFIG,
  getPaperDimensions,
  hydrateExportPreviewDom,
  loadPdfExportConfig,
  MARGIN_TYPE_OPTIONS,
  PAPER_SIZE_OPTIONS,
  renderExportBodyHtml,
  resolveMargins,
  savePdfExportConfig,
  splitFrontMatter,
  type MarginType,
  type PaperSize,
  type PdfExportConfig,
} from "../lib/export";
import { notify, notifyError } from "../lib/notify";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]";

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${FOCUS_RING} ${
        checked ? "bg-[var(--accent)]" : "bg-[var(--border)]"
      }`}
    >
      <span
        className={`absolute left-0 top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

/** 读取当前 DOM 根上的主题色变量，用于「跟随当前主题」模式下的纸张渲染 */
function readCurrentThemeColors(isDark: boolean) {
  if (!isDark) {
    return {
      bgColor: "#ffffff",
      fgColor: "#1f2328",
      fgSoftColor: "#59636e",
      accentColor: "#0969da",
      borderColor: "#d1d9e0",
      codeBgColor: "#f6f8fa",
    };
  }
  const style = getComputedStyle(document.documentElement);
  const get = (prop: string, fallback: string) => style.getPropertyValue(prop).trim() || fallback;
  return {
    bgColor: get("--bg", "#14161a"),
    fgColor: get("--fg", "#e6edf3"),
    fgSoftColor: get("--fg-soft", "#9198a1"),
    accentColor: get("--accent", "#4493f8"),
    borderColor: get("--border", "#30363d"),
    codeBgColor: get("--bg-soft", "#1c2026"),
  };
}

function PdfExportModalContent({
  target,
  onClose,
}: {
  target: PdfExportTarget;
  onClose: () => void;
}) {
  const titleId = useId();
  const appThemeMode = useStore((s) => s.settings.themeMode);
  const appPalette = useStore((s) => s.settings.palette);

  const defaultDocTitle = useMemo(() => {
    const { fmTitle } = splitFrontMatter(target.md);
    return fmTitle || target.name.replace(/\.(md|markdown|mdx|txt)$/i, "");
  }, [target.md, target.name]);

  const [config, setConfig] = useState<PdfExportConfig>(() => loadPdfExportConfig());
  const [exporting, setExporting] = useState(false);
  const [renderingDiagrams, setRenderingDiagrams] = useState(false);
  const [estimatedPages, setEstimatedPages] = useState(1);

  const previewRef = useRef<HTMLDivElement>(null);

  const updateConfig = (patch: Partial<PdfExportConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      savePdfExportConfig(next);
      return next;
    });
  };

  // Esc 关闭（导出中禁用）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !exporting) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [exporting, onClose]);

  const isPaperDark = config.theme === "follow" && appThemeMode === "dark";
  const paperColors = useMemo(
    () => readCurrentThemeColors(isPaperDark),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPaperDark, appThemeMode, appPalette],
  );

  const paperDim = useMemo(
    () => getPaperDimensions(config.pageSize, config.landscape),
    [config.pageSize, config.landscape],
  );
  const margins = useMemo(() => resolveMargins(config), [config]);

  // 正文 HTML（不含顶部可选文档大标题，大标题由 React 节点渲染以便实时响应输入）
  const bodyHtml = useMemo(
    () => renderExportBodyHtml(target.md, target.path),
    [target.md, target.path],
  );

  const effectiveDocTitle = (config.customTitle.trim() || defaultDocTitle).trim();
  const effectiveWatermark = (config.watermarkText.trim() || defaultDocTitle || "MDCraft").trim();

  // 写入预览正文并异步渲染 Mermaid 图表、标题分页标记与超宽表格缩放
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    let cancelled = false;
    setRenderingDiagrams(true);

    void hydrateExportPreviewDom(
      el,
      isPaperDark,
      config.headingPageBreakLevels,
      config.paged,
    ).finally(() => {
      if (cancelled) return;
      setRenderingDiagrams(false);
      // 估算页数
      const pageContentHeight = Math.max(
        200,
        (paperDim.heightPx - (margins.top + margins.bottom) * 96) / config.scale,
      );
      const totalH = el.scrollHeight || 1;
      setEstimatedPages(Math.max(1, Math.ceil(totalH / pageContentHeight)));
    });

    return () => {
      cancelled = true;
    };
  }, [
    bodyHtml,
    isPaperDark,
    config.headingPageBreakLevels,
    config.paged,
    config.scale,
    config.addTitle,
    effectiveDocTitle,
    paperDim.heightPx,
    paperDim.widthPx,
    margins.top,
    margins.bottom,
    margins.left,
    margins.right,
  ]);

  // 通过隐藏 iframe 触发系统原生打印对话框（支持另存为 PDF 或连接实体打印机）
  const triggerSystemPrint = (standaloneHtml: string) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const cleanup = () => {
      setTimeout(() => {
        iframe.remove();
      }, 1500);
    };

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
      iframe.remove();
      notifyError("无法初始化打印预览窗口");
      return;
    }
    doc.open();
    doc.write(standaloneHtml);
    doc.close();

    // 等待图片/字体就绪后拉起系统打印
    const win = iframe.contentWindow;
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch (e) {
        notifyError(`调起系统打印失败：${e}`);
      } finally {
        cleanup();
      }
    }, 350);
  };

  /** 构建当前预览状态的完整独立 HTML */
  const buildCurrentPdfHtml = (): string | null => {
    const node = previewRef.current;
    if (!node) return null;
    return buildStandalonePdfHtml({
      title: effectiveDocTitle,
      previewNode: node,
      config,
      isDark: isPaperDark,
      colors: paperColors,
    });
  };

  /** 点击「系统打印…」 */
  const handleSystemPrint = () => {
    const html = buildCurrentPdfHtml();
    if (!html) return;
    triggerSystemPrint(html);
  };

  /** 点击「导出 PDF」 */
  const handleExportPdf = async () => {
    if (exporting || renderingDiagrams) return;
    const html = buildCurrentPdfHtml();
    if (!html) return;

    // 浏览器模式：直接拉起浏览器打印转 PDF（自动带上 @page 纸张、边距、方向、水印与文档标题）
    if (!backend.isTauri) {
      triggerSystemPrint(html);
      return;
    }

    // 桌面模式：先弹保存路径对话框
    const outName = target.name.replace(/\.(md|markdown|mdx|txt)$/i, "") + ".pdf";
    let defaultPath = outName;
    if (target.path && !target.path.startsWith("mdcraft:doc:")) {
      const idx = Math.max(target.path.lastIndexOf("\\"), target.path.lastIndexOf("/"));
      if (idx > 0) {
        const dir = target.path.slice(0, idx);
        const sep = /^[A-Za-z]:$/.test(dir) || dir.includes("\\") ? "\\" : "/";
        defaultPath = `${dir}${sep}${outName}`;
      }
    }

    let outPath: string | null = null;
    try {
      outPath = await backend.pickExportPdfPath(defaultPath);
    } catch (e) {
      notifyError(`打开保存对话框失败：${e}`);
      return;
    }
    if (!outPath) return; // 用户取消

    setExporting(true);
    try {
      await backend.exportPdfFile(html, outPath);
      onClose();
      notifyExportedFile(outPath, "PDF 文件");
    } catch (e) {
      // 若精简系统未安装 Edge/Chrome 无头内核，自动回退到系统打印对话框
      notify(`直接导出受限（${e}），已为您切换至系统打印另存为 PDF`, "info");
      triggerSystemPrint(html);
    } finally {
      setExporting(false);
    }
  };

  const toggleHeadingLevel = (level: number) => {
    const exists = config.headingPageBreakLevels.includes(level);
    const next = exists
      ? config.headingPageBreakLevels.filter((l) => l !== level)
      : [...config.headingPageBreakLevels, level].sort();
    updateConfig({ headingPageBreakLevels: next });
  };

  const handleMarginTypeChange = (marginType: MarginType) => {
    if (marginType === "custom") {
      // 切换到自定义时，以当前实际生效的预设边距作为初始值
      const current = resolveMargins(config);
      updateConfig({
        marginType,
        marginTop: current.top,
        marginRight: current.right,
        marginBottom: current.bottom,
        marginLeft: current.left,
      });
    } else {
      updateConfig({ marginType });
    }
  };

  const articleCss = useMemo(
    () =>
      buildPdfArticleCss({
        isDark: isPaperDark,
        ...paperColors,
      }),
    [isPaperDark, paperColors],
  );

  const watermarkBg = useMemo(
    () => (config.watermark ? buildWatermarkDataUrl(effectiveWatermark, isPaperDark) : "none"),
    [config.watermark, effectiveWatermark, isPaperDark],
  );

  // 单页高度（像素），用于在预览纸张上绘制虚线分页参考线
  const singlePageHeightPx = paperDim.heightPx;

  return (
    <div
      className="modal-overlay fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-3 sm:p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !exporting) onClose();
      }}
    >
      <style>{`
        ${articleCss}
        .pdf-preview-sheet [data-pdf-page-break="true"] {
          position: relative;
          margin-top: 2.2em !important;
          padding-top: 1.1em;
        }
        .pdf-preview-sheet [data-pdf-page-break="true"]::before {
          content: "✂ 分页符（导出时在此标题前换页）";
          position: absolute;
          top: -0.35em;
          left: 0;
          right: 0;
          border-top: 1.5px dashed var(--pdf-accent);
          color: var(--pdf-accent);
          font-size: 11px;
          font-weight: 500;
          padding-top: 2px;
          opacity: 0.75;
          pointer-events: none;
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-card flex h-[90vh] w-[95vw] max-w-[1260px] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-[0_24px_64px_rgba(0,0,0,0.36)]"
      >
        {/* 顶部标题栏 */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)] px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <FileType size={16} />
            </span>
            <h2 id={titleId} className="truncate text-[14px] font-semibold text-[var(--fg-strong)]">
              导出 PDF 预览
            </h2>
            <span className="truncate rounded bg-[var(--bg-soft)] px-2 py-0.5 text-[12px] text-[var(--fg-soft)]">
              {target.name}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 text-[12px] text-[var(--fg-faint)] md:flex">
              <span>{paperDim.label}</span>
              <span>·</span>
              <span>缩放 {Math.round(config.scale * 100)}%</span>
              <span>·</span>
              <span>约 {estimatedPages} 页</span>
            </div>
            <button
              type="button"
              disabled={exporting}
              onClick={onClose}
              aria-label="关闭预览"
              className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] disabled:opacity-40 ${FOCUS_RING}`}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 主体：左侧纸张预览区 + 右侧思源式参数面板 */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* 左侧：实时纸张预览画布 */}
          <div className="relative flex-1 overflow-auto bg-[var(--bg-soft)] p-6 sm:p-8">
            <div
              className="pdf-paper-root pdf-preview-sheet relative mx-auto transition-[width,min-height,padding] duration-150"
              style={{
                width: `${paperDim.widthPx}px`,
                minHeight: `${paperDim.heightPx}px`,
                paddingTop: `${margins.top * 96}px`,
                paddingRight: `${margins.right * 96}px`,
                paddingBottom: `${margins.bottom * 96}px`,
                paddingLeft: `${margins.left * 96}px`,
                boxShadow:
                  "0 10px 32px rgba(0, 0, 0, 0.16), 0 1px 3px rgba(0, 0, 0, 0.08)",
                borderRadius: "2px",
              }}
            >
              {/* 斜向防伪水印层 */}
              {config.watermark && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
                  style={{
                    backgroundImage: watermarkBg,
                    backgroundRepeat: "repeat",
                  }}
                />
              )}

              {/* 分页参考虚线（当估算页数 > 1 时显示每页边界） */}
              {config.paged &&
                estimatedPages > 1 &&
                Array.from({ length: estimatedPages - 1 }).map((_, idx) => {
                  const topPx = (idx + 1) * singlePageHeightPx;
                  return (
                    <div
                      key={idx}
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 right-0 z-30 flex items-center justify-end border-t border-dashed border-[var(--accent)]/45 pr-3"
                      style={{ top: `${topPx}px` }}
                    >
                      <span className="-translate-y-1/2 rounded bg-[var(--bg-soft)]/90 px-1.5 py-0.5 text-[10px] font-medium text-[var(--fg-faint)] shadow-sm">
                        第 {idx + 1} 页底 / 第 {idx + 2} 页顶
                      </span>
                    </div>
                  );
                })}

              {/* 正文内容区（响应 scale 缩放） */}
              <div
                ref={previewRef}
                style={{
                  zoom: config.scale,
                }}
              >
                {config.addTitle && effectiveDocTitle && (
                  <h1 className="pdf-doc-title">{effectiveDocTitle}</h1>
                )}
                <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
              </div>

              {/* 页码预览指示 */}
              {config.showPageNumbers && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] opacity-55"
                  style={{ color: paperColors.fgSoftColor }}
                >
                  1 / {estimatedPages}
                </div>
              )}
            </div>
          </div>

          {/* 右侧：设置面板（对齐思源笔记 #action） */}
          <div className="flex w-[320px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg)]">
            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-[13px]">
              {/* 分组 1：页面设置 */}
              <div className="space-y-3">
                <div className="text-[11.5px] font-semibold tracking-wider text-[var(--fg-faint)]">
                  页面与纸张
                </div>

                {/* 纸张尺寸 */}
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="pdf-page-size" className="text-[var(--fg)]">
                    纸张尺寸
                  </label>
                  <select
                    id="pdf-page-size"
                    value={config.pageSize}
                    onChange={(e) => updateConfig({ pageSize: e.target.value as PaperSize })}
                    className={`h-8 w-[156px] cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 text-[12.5px] text-[var(--fg)] ${FOCUS_RING}`}
                  >
                    {PAPER_SIZE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label} ({opt.desc})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 页面方向 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--fg)]">页面方向</span>
                  <div className="grid w-[156px] grid-cols-2 rounded-md border border-[var(--border)] bg-[var(--bg-soft)] p-0.5 text-[12px]">
                    <button
                      type="button"
                      onClick={() => updateConfig({ landscape: false })}
                      className={`cursor-pointer rounded py-1 font-medium transition-colors ${
                        !config.landscape
                          ? "bg-[var(--bg)] text-[var(--accent)] shadow-sm"
                          : "text-[var(--fg-soft)] hover:text-[var(--fg)]"
                      }`}
                    >
                      纵向
                    </button>
                    <button
                      type="button"
                      onClick={() => updateConfig({ landscape: true })}
                      className={`cursor-pointer rounded py-1 font-medium transition-colors ${
                        config.landscape
                          ? "bg-[var(--bg)] text-[var(--accent)] shadow-sm"
                          : "text-[var(--fg-soft)] hover:text-[var(--fg)]"
                      }`}
                    >
                      横向
                    </button>
                  </div>
                </div>

                {/* 页边距 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="pdf-margin-type" className="text-[var(--fg)]">
                      页边距
                    </label>
                    <select
                      id="pdf-margin-type"
                      value={config.marginType}
                      onChange={(e) => handleMarginTypeChange(e.target.value as MarginType)}
                      className={`h-8 w-[156px] cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 text-[12.5px] text-[var(--fg)] ${FOCUS_RING}`}
                    >
                      {MARGIN_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 自定义边距输入框（上/右/下/左，单位英寸 in，对齐思源） */}
                  {config.marginType === "custom" && (
                    <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]/50 p-2.5">
                      {(
                        [
                          { key: "marginTop", label: "上边距 (in)" },
                          { key: "marginBottom", label: "下边距 (in)" },
                          { key: "marginLeft", label: "左边距 (in)" },
                          { key: "marginRight", label: "右边距 (in)" },
                        ] as const
                      ).map((item) => (
                        <label key={item.key} className="flex flex-col gap-1">
                          <span className="text-[11px] text-[var(--fg-faint)]">{item.label}</span>
                          <input
                            type="number"
                            min={0}
                            max={3}
                            step={0.05}
                            value={config[item.key]}
                            onChange={(e) =>
                              updateConfig({
                                [item.key]: Math.max(0, Math.min(3, parseFloat(e.target.value) || 0)),
                              })
                            }
                            className={`h-7 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-[12px] tabular-nums text-[var(--fg)] ${FOCUS_RING}`}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* 缩放比例 */}
                <div className="space-y-1.5 pt-0.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="pdf-scale" className="text-[var(--fg)]">
                      缩放比例
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px] font-medium text-[var(--accent)]">
                        {Math.round(config.scale * 100)}%
                      </span>
                      {config.scale !== 1 && (
                        <button
                          type="button"
                          onClick={() => updateConfig({ scale: 1 })}
                          title="重置为 100%"
                          className="cursor-pointer rounded px-1 py-0.5 text-[11px] text-[var(--fg-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
                        >
                          重置
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    id="pdf-scale"
                    type="range"
                    min={0.5}
                    max={1.5}
                    step={0.05}
                    value={config.scale}
                    onChange={(e) => updateConfig({ scale: parseFloat(e.target.value) || 1 })}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-[var(--border)] accent-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="h-px bg-[var(--border)]" />

              {/* 分组 2：排版与分页 */}
              <div className="space-y-3">
                <div className="text-[11.5px] font-semibold tracking-wider text-[var(--fg-faint)]">
                  排版与分页
                </div>

                {/* 外观背景 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--fg)]">页面背景</span>
                  <div className="grid w-[156px] grid-cols-2 rounded-md border border-[var(--border)] bg-[var(--bg-soft)] p-0.5 text-[12px]">
                    <button
                      type="button"
                      onClick={() => updateConfig({ theme: "light" })}
                      className={`cursor-pointer rounded py-1 font-medium transition-colors ${
                        config.theme === "light"
                          ? "bg-[var(--bg)] text-[var(--accent)] shadow-sm"
                          : "text-[var(--fg-soft)] hover:text-[var(--fg)]"
                      }`}
                    >
                      浅色白纸
                    </button>
                    <button
                      type="button"
                      onClick={() => updateConfig({ theme: "follow" })}
                      className={`cursor-pointer rounded py-1 font-medium transition-colors ${
                        config.theme === "follow"
                          ? "bg-[var(--bg)] text-[var(--accent)] shadow-sm"
                          : "text-[var(--fg-soft)] hover:text-[var(--fg)]"
                      }`}
                    >
                      跟随主题
                    </button>
                  </div>
                </div>

                {/* 自动分页开关 */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[var(--fg)]">分页控制</div>
                    <div className="text-[11px] text-[var(--fg-faint)]">显示分页参考线并支持按标题换页</div>
                  </div>
                  <Switch
                    checked={config.paged}
                    onChange={(paged) => updateConfig({ paged })}
                    label="分页控制"
                  />
                </div>

                {/* 按标题强制分页（对齐思源 pdfHeadingPageBreaks） */}
                {config.paged && (
                  <div className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]/50 p-2.5">
                    <div className="text-[12px] font-medium text-[var(--fg)]">按标题自动分页</div>
                    <div className="text-[11px] text-[var(--fg-faint)]">
                      在所选级别的标题前自动换到新页面（跳过首行标题）
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 pt-1">
                      {[1, 2, 3, 4].map((lv) => {
                        const active = config.headingPageBreakLevels.includes(lv);
                        return (
                          <button
                            key={lv}
                            type="button"
                            onClick={() => toggleHeadingLevel(lv)}
                            className={`cursor-pointer rounded border py-1 text-center text-[12px] font-medium transition-colors ${
                              active
                                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                                : "border-[var(--border)] bg-[var(--bg)] text-[var(--fg-soft)] hover:bg-[var(--bg-hover)]"
                            }`}
                          >
                            H{lv}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 显示页码 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--fg)]">页脚显示页码</span>
                  <Switch
                    checked={config.showPageNumbers}
                    onChange={(showPageNumbers) => updateConfig({ showPageNumbers })}
                    label="页脚显示页码"
                  />
                </div>
              </div>

              <div className="h-px bg-[var(--border)]" />

              {/* 分组 3：标题与水印 */}
              <div className="space-y-3">
                <div className="text-[11.5px] font-semibold tracking-wider text-[var(--fg-faint)]">
                  标题与水印
                </div>

                {/* 顶部添加文档标题 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--fg)]">顶部添加文档标题</span>
                    <Switch
                      checked={config.addTitle}
                      onChange={(addTitle) => updateConfig({ addTitle })}
                      label="顶部添加文档标题"
                    />
                  </div>
                  {config.addTitle && (
                    <input
                      type="text"
                      value={config.customTitle}
                      onChange={(e) => updateConfig({ customTitle: e.target.value })}
                      placeholder={defaultDocTitle || "输入自定义标题…"}
                      className={`h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 text-[12.5px] text-[var(--fg)] placeholder:text-[var(--fg-faint)] ${FOCUS_RING}`}
                    />
                  )}
                </div>

                {/* 添加背景水印 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--fg)]">添加背景水印</span>
                    <Switch
                      checked={config.watermark}
                      onChange={(watermark) => updateConfig({ watermark })}
                      label="添加背景水印"
                    />
                  </div>
                  {config.watermark && (
                    <input
                      type="text"
                      value={config.watermarkText}
                      onChange={(e) => updateConfig({ watermarkText: e.target.value })}
                      placeholder={defaultDocTitle || "输入水印文字…"}
                      className={`h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 text-[12.5px] text-[var(--fg)] placeholder:text-[var(--fg-faint)] ${FOCUS_RING}`}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* 底部操作栏 */}
            <div className="flex flex-col gap-2.5 border-t border-[var(--border)] bg-[var(--bg-soft)] px-4 py-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => {
                    savePdfExportConfig(DEFAULT_PDF_CONFIG);
                    setConfig({ ...DEFAULT_PDF_CONFIG });
                  }}
                  className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[11.5px] text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] disabled:opacity-40"
                >
                  <RotateCcw size={12} />
                  恢复默认
                </button>

                <button
                  type="button"
                  disabled={exporting || renderingDiagrams}
                  onClick={handleSystemPrint}
                  title="调起系统打印面板（可连接打印机或使用系统另存为 PDF）"
                  className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[12px] text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] disabled:opacity-40"
                >
                  <Printer size={13} />
                  系统打印…
                </button>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={exporting}
                  onClick={onClose}
                  className="flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={exporting || renderingDiagrams}
                  onClick={() => void handleExportPdf()}
                  className="flex flex-[1.4] cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
                >
                  <Download size={14} />
                  {exporting ? "正在导出…" : renderingDiagrams ? "渲染图表中…" : "导出 PDF"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PdfExportDialog() {
  const target = usePdfExportTarget();
  if (!target) return null;
  return <PdfExportModalContent target={target} onClose={closePdfExportDialog} />;
}
