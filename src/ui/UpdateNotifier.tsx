// 右下角更新通知条：新版本提示 / 后台下载进度 / 更新就绪提醒。
//
// 非模态、不打断编辑：启动静默检查发现新版本后在此提示，下载在后台进行，
// 关闭弹窗也能继续工作。同一版本被「稍后」关闭后不再自动弹出（下次启动仍会提示）。

import { useState } from "react";
import { CheckCircle2, Download, Loader2, Sparkles, X } from "lucide-react";
import {
  installDownloadedUpdate,
  openUpdateDialog,
  startUpdateDownload,
  useUpdateState,
} from "../lib/updater";
import * as backend from "../lib/backend";

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function UpdateNotifier() {
  const state = useUpdateState();
  /** 已被用户关闭的提示（键 = 场景:版本号） */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const availableKey = state.status === "available" ? `available:${state.info.version}` : null;
  const readyKey = state.status === "ready-to-install" ? `ready:${state.version}` : null;
  const showAvailable = availableKey !== null && dismissed !== availableKey;
  const showDownloading = state.status === "downloading";
  const showReady = readyKey !== null && dismissed !== readyKey;
  if (!showAvailable && !showDownloading && !showReady) return null;

  const handleInstall = async () => {
    setInstalling(true);
    await installDownloadedUpdate();
    setInstalling(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-11 right-4 z-40 w-[300px] animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="pointer-events-auto overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
        {/* 新版本提示 */}
        {showAvailable && state.status === "available" && (
          <div className="p-3.5">
            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                <Sparkles size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold leading-tight text-[var(--fg-strong)]">
                  发现新版本 v{state.info.version}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-[var(--fg-faint)]">
                  当前 v{state.info.currentVersion}
                  {state.info.date ? ` · 发布于 ${new Date(state.info.date).toLocaleDateString()}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="稍后提醒"
                onClick={() => setDismissed(availableKey)}
                className="shrink-0 cursor-pointer rounded-md p-1 text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
              >
                <X size={13} />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void startUpdateDownload()}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                <Download size={13} />
                {backend.isTauri ? "下载更新" : "前往下载"}
              </button>
              <button
                type="button"
                onClick={openUpdateDialog}
                className="cursor-pointer rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                更新说明
              </button>
            </div>
          </div>
        )}

        {/* 后台下载进度 */}
        {showDownloading && state.status === "downloading" && (
          <div className="p-3.5">
            <div className="flex items-center gap-2.5">
              <Loader2 size={15} className="shrink-0 animate-spin text-[var(--accent)]" />
              <p className="min-w-0 flex-1 text-[12px] font-medium leading-tight text-[var(--fg-strong)]">
                正在后台下载 v{state.version}
              </p>
              <span className="shrink-0 font-mono text-[11px] text-[var(--fg-faint)]">
                {state.progress}%
              </span>
            </div>
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full bg-[var(--accent)] transition-all duration-200"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-[10.5px] text-[var(--fg-faint)]">
              {formatBytes(state.downloaded)}
              {state.total ? ` / ${formatBytes(state.total)}` : ""} · 可继续编辑，下载在后台进行
            </p>
          </div>
        )}

        {/* 更新包就绪 */}
        {showReady && state.status === "ready-to-install" && (
          <div className="p-3.5">
            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold leading-tight text-[var(--fg-strong)]">
                  v{state.version} 已下载完成
                </p>
                <p className="mt-1 text-[11px] leading-4 text-[var(--fg-faint)]">
                  安装时应用会自动退出，未保存的内容请先保存。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setDismissed(readyKey)}
                className="shrink-0 cursor-pointer rounded-md p-1 text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
              >
                <X size={13} />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={installing}
                onClick={() => void handleInstall()}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {installing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                立即安装并重启
              </button>
              <button
                type="button"
                onClick={openUpdateDialog}
                className="cursor-pointer rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                详情
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
