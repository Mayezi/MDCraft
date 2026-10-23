// 提示栈渲染：右上角堆叠展示 lib/notify 的通知，自动消失、可点掉。
// 与右下角的更新提示条分居两端，互不遮挡。

import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { dismissNotification, useNotifications, type Notification } from "../lib/notify";

/** 各类型停留时长（毫秒）：错误给更久的时间看清 */
const DURATION: Record<Notification["kind"], number> = {
  info: 4200,
  success: 3200,
  error: 7000,
};

const STYLE: Record<Notification["kind"], { icon: React.ReactNode; cls: string }> = {
  info: { icon: <Info size={15} />, cls: "text-[var(--accent)]" },
  success: { icon: <CheckCircle2 size={15} />, cls: "text-emerald-600 dark:text-emerald-400" },
  error: { icon: <AlertCircle size={15} />, cls: "text-[var(--danger)]" },
};

function Toast({ item }: { item: Notification }) {
  useEffect(() => {
    // 带操作按钮的提示不自动消失，等用户处理（点按钮或关闭）
    if (item.actions?.length) return;
    const timer = window.setTimeout(() => dismissNotification(item.id), DURATION[item.kind]);
    return () => window.clearTimeout(timer);
  }, [item.id, item.kind, item.actions]);

  const style = STYLE[item.kind];
  return (
    <div
      role="status"
      aria-live="polite"
      className="toast-in pointer-events-auto flex items-start gap-2.5 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
    >
      <span className={`mt-[1px] shrink-0 ${style.cls}`}>{style.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-5 text-[var(--fg)]">{item.message}</p>
        {item.actions?.length ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            {item.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  dismissNotification(item.id);
                  action.onClick();
                }}
                className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-[3px] text-[11.5px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--border)]"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="关闭提示"
        onClick={() => dismissNotification(item.id)}
        className="-mr-0.5 -mt-0.5 shrink-0 cursor-pointer rounded-md p-1 text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export default function NotifyHost() {
  const items = useNotifications();
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-12 z-[150] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  );
}
