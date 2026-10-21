// 关闭应用前的未保存文件确认框。
// 只负责展示与选择，真正的保存/退出动作由 App 执行。

import { useEffect, useId, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { DocFile } from "../lib/types";

export default function CloseConfirmDialog({
  docs,
  saving,
  error,
  onSave,
  onDiscard,
  onCancel,
}: {
  docs: DocFile[];
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || saving) return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, saving]);

  return (
    <div
      className="modal-overlay fixed inset-0 z-[200] flex items-center justify-center bg-black/35 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-card w-[480px] max-w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 shadow-[0_12px_36px_rgba(0,0,0,0.22)] outline-none"
      >
        <div className="mb-2 flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
            <AlertTriangle size={17} />
          </span>
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold text-[var(--fg)]">
              有未保存的文件
            </h2>
            <p className="mt-0.5 text-[11.5px] text-[var(--fg-faint)]">
              关闭应用前，是否保存以下修改？
            </p>
          </div>
        </div>

        <ul className="mb-4 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]/60">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-start gap-2 border-b border-[var(--border)] px-3 py-2 last:border-b-0"
            >
              <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              <div className="min-w-0">
                <div className="truncate text-[12.5px] text-[var(--fg)]">{doc.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-[var(--fg-faint)]">
                  {doc.path ?? "新草稿 · 保存时会选择位置"}
                </div>
              </div>
            </li>
          ))}
        </ul>

        {error && (
          <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[11.5px] text-[var(--danger)]">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onDiscard}
            className="cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] text-[var(--danger)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-50"
          >
            不保存并退出
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            className="cursor-pointer rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
          >
            {saving ? "保存中…" : "保存并退出"}
          </button>
        </div>
      </div>
    </div>
  );
}
