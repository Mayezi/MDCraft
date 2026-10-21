// 导出完成提示框：提供「打开导出文件」「打开导出文件位置」「关闭」。
// 只负责展示与动作分发，真正的打开动作由调用方执行。

import { useEffect, useId, useRef } from "react";
import { CheckCircle2, FileText, FolderOpen, X } from "lucide-react";

export default function ExportResultDialog({
  path,
  onOpen,
  onReveal,
  onClose,
}: {
  /** 导出文件路径 */
  path: string;
  onOpen: () => void;
  onReveal: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="modal-overlay fixed inset-0 z-[200] flex items-center justify-center bg-black/35 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-card w-[440px] max-w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 shadow-[0_12px_36px_rgba(0,0,0,0.22)] outline-none"
      >
        <div className="mb-3 flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
            <CheckCircle2 size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold text-[var(--fg)]">
              导出完成
            </h2>
            <p className="mt-0.5 text-[11.5px] text-[var(--fg-faint)]">HTML 已生成到指定位置</p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={onClose}
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mb-4 truncate rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]/60 px-3 py-2 text-[12px] text-[var(--fg-soft)]" title={path}>
          {path}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onReveal}
            className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            <FolderOpen size={14} /> 打开导出文件位置
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <FileText size={14} /> 打开导出文件
          </button>
        </div>
      </div>
    </div>
  );
}