// 应用内确认框：替代原生 window.confirm。
//
// 不用原生确认框的原因：Tauri 的 WebView 里 window.confirm 不阻塞、返回值也不可靠
// （点「取消」后续动作照样执行），删除这类破坏性操作必须走可控的应用内弹窗。

import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

export default function ConfirmDialog({
  open,
  title,
  description,
  detail,
  icon,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  /** 正文说明（可含节点名等富文本） */
  description?: ReactNode;
  /** 补充信息（如完整路径），等宽字体单行省略 */
  detail?: string;
  /** 标题左侧图标（默认警告图标） */
  icon?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 破坏性操作：图标与确认按钮用危险色 */
  danger?: boolean;
  /** 执行中：禁用按钮并显示等待态 */
  busy?: boolean;
  /** 执行失败时的错误信息（显示在弹窗内，弹窗保持打开） */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) cardRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel, busy]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-card w-[440px] max-w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-[0_20px_50px_rgba(0,0,0,0.28)] outline-none"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              danger
                ? "bg-[var(--danger)]/12 text-[var(--danger)]"
                : "bg-[var(--accent-soft)] text-[var(--accent)]"
            }`}
          >
            {icon ?? <AlertTriangle size={18} />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={titleId} className="text-[15px] font-semibold leading-snug text-[var(--fg-strong)]">
              {title}
            </h2>
            {description && (
              <div className="mt-1.5 text-[12px] leading-relaxed text-[var(--fg-soft)]">
                {description}
              </div>
            )}
          </div>
        </div>

        {detail && (
          <div
            className="mx-5 mb-4 truncate rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]/60 px-3 py-2 font-mono text-[11.5px] text-[var(--fg-faint)]"
            title={detail}
          >
            {detail}
          </div>
        )}

        {error && (
          <div className="mx-5 mb-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-[11.5px] leading-5 text-[var(--danger)]">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-soft)] px-5 py-3.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:cursor-default disabled:opacity-60 ${
              danger
                ? "bg-[var(--danger)]/15 text-[var(--danger)] hover:bg-[var(--danger)]/25"
                : "bg-[var(--accent)] text-white hover:opacity-90"
            }`}
          >
            {busy ? "处理中…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
