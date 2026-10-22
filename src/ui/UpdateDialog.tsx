import { useState } from "react";
import {
  Download,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  ArrowRight,
  RefreshCw,
  FileText,
} from "lucide-react";
import {
  useUpdateState,
  startUpdateDownload,
  installDownloadedUpdate,
  checkUpdate,
  resetUpdateState,
} from "../lib/updater";
import { isTauri, openUrl } from "../lib/backend";
import { MarkdownChangelog } from "./Changelog";

interface UpdateDialogProps {
  open: boolean;
  onClose: () => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function UpdateDialog({ open, onClose }: UpdateDialogProps) {
  const updateState = useUpdateState();
  const [installing, setInstalling] = useState(false);
  const [showCurrentChangelog, setShowCurrentChangelog] = useState(false);

  if (!open) return null;

  const handleInstall = async () => {
    setInstalling(true);
    await startUpdateDownload();
    setInstalling(false);
  };

  const handleApplyInstall = async () => {
    setInstalling(true);
    await installDownloadedUpdate();
    setInstalling(false);
  };

  const handleRetry = () => {
    void checkUpdate(true);
  };

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4 transition-all"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="modal-card flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] shadow-2xl"
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-soft)] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold leading-tight text-[var(--fg-strong)]">软件更新</h3>
              <p className="text-[11px] text-[var(--fg-faint)] leading-none mt-0.5">MDCraft 自动更新服务</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容主体 */}
        <div className="flex-1 overflow-y-auto p-5 text-sm">
          {/* 1. 检查中状态 */}
          {updateState.status === "checking" && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 size={32} className="animate-spin text-[var(--accent)] mb-3" />
              <p className="text-sm font-medium text-[var(--fg-strong)]">正在连接更新服务器...</p>
              <p className="mt-1 text-xs text-[var(--fg-faint)]">正在与 GitHub Releases 校验版本元数据</p>
            </div>
          )}

          {/* 2. 已经是最新版本 */}
          {updateState.status === "up-to-date" && (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center justify-center text-center py-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-2.5">
                  <CheckCircle2 size={26} />
                </div>
                <p className="text-base font-semibold text-[var(--fg-strong)]">当前已是最新版本</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--fg-faint)]">
                  <span className="font-mono font-medium text-[var(--fg)]">v{updateState.currentVersion}</span>
                  {updateState.date && (
                    <span>· 发布于 {new Date(updateState.date).toLocaleDateString()}</span>
                  )}
                </div>
              </div>

              {/* 主流设计：允许用户在已是最新时查看当前版本的更新日志 */}
              {updateState.notes ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      onClick={() => setShowCurrentChangelog((v) => !v)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fg-soft)] hover:text-[var(--accent)] transition-colors"
                    >
                      <FileText size={13} />
                      <span>{showCurrentChangelog ? "收起本版更新说明" : "查看本版更新说明"}</span>
                    </button>
                  </div>
                  {showCurrentChangelog && (
                    <MarkdownChangelog content={updateState.notes} />
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* 3. 错误状态 */}
          {updateState.status === "error" && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 mb-3">
                <AlertCircle size={28} />
              </div>
              <p className="text-sm font-semibold text-[var(--fg-strong)]">检查更新失败</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--fg-faint)]">
                {updateState.message}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-[var(--bg-hover)] px-4 py-1.5 text-xs font-medium text-[var(--fg)] transition-colors hover:bg-[var(--border)]"
              >
                <RefreshCw size={13} />
                重试检查
              </button>
            </div>
          )}

          {/* 4. 发现新版本 */}
          {updateState.status === "available" && (
            <div className="space-y-4">
              {/* 版本对比流转卡片（主流设计：当前 -> 新版，清晰直观） */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-[11px] text-[var(--fg-faint)]">当前版本</span>
                      <span className="font-mono text-xs font-medium text-[var(--fg-soft)]">
                        v{updateState.info.currentVersion}
                      </span>
                    </div>

                    <div className="flex items-center text-[var(--accent)] px-1">
                      <ArrowRight size={15} />
                    </div>

                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-[var(--accent)]">新版本</span>
                        <span className="rounded-full bg-[var(--accent)]/15 px-1.5 py-0.2 font-mono text-[10px] font-bold text-[var(--accent)] leading-none">
                          New
                        </span>
                      </div>
                      <span className="font-mono text-sm font-bold text-[var(--fg-strong)]">
                        v{updateState.info.version}
                      </span>
                    </div>
                  </div>

                  {updateState.info.date && (
                    <span className="text-[11px] text-[var(--fg-faint)]">
                      {new Date(updateState.info.date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              {/* 更新说明富文本渲染区 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-faint)]">
                    更新说明（Changelog）
                  </span>
                  <span className="text-[11px] text-[var(--fg-faint)]">Markdown 富文本</span>
                </div>
                <MarkdownChangelog content={updateState.info.body || "暂无具体更新说明。"} />
              </div>

              {/* 浏览器环境提示 */}
              {!isTauri && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  <ExternalLink size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium">浏览器环境提示：</span>
                    当前处于 Web 预览模式，无法直接热替换本地客户端。点击下方按钮即可前往 GitHub
                    下载新版本桌面安装程序。
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 5. 下载更新中 */}
          {updateState.status === "downloading" && (
            <div className="space-y-4 py-4">
              <div className="text-center">
                <Loader2 size={32} className="mx-auto animate-spin text-[var(--accent)] mb-2" />
                <p className="text-sm font-semibold text-[var(--fg-strong)]">
                  正在下载更新包... {updateState.progress}%
                </p>
                <p className="mt-1 font-mono text-xs text-[var(--fg-faint)]">
                  {formatBytes(updateState.downloaded)}
                  {updateState.total ? ` / ${formatBytes(updateState.total)}` : ""}
                </p>
              </div>

              {/* 进度条 */}
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                <div
                  className="h-full bg-[var(--accent)] transition-all duration-200"
                  style={{ width: `${updateState.progress}%` }}
                />
              </div>

              <p className="text-center text-[11px] text-[var(--fg-faint)]">
                下载在后台进行，可关闭本窗口继续编辑；下载完成后会提示安装。
              </p>
            </div>
          )}

          {/* 6. 下载完成等待安装 */}
          {updateState.status === "ready-to-install" && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-3">
                <CheckCircle2 size={28} />
              </div>
              <p className="text-base font-semibold text-[var(--fg-strong)]">
                v{updateState.version} 更新包已准备就绪
              </p>
              <p className="mt-1 text-xs text-[var(--fg-faint)]">
                安装时应用会自动退出，未保存的内容请先保存后再安装。
              </p>
            </div>
          )}
        </div>

        {/* 底部操作区 */}
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--bg-soft)] px-5 py-3">
          <button
            type="button"
            onClick={() => {
              void openUrl("https://github.com/Mayezi/MDCraft/releases");
            }}
            className="flex items-center gap-1.5 text-xs text-[var(--fg-faint)] hover:text-[var(--accent)] transition-colors cursor-pointer"
          >
            <ExternalLink size={13} />
            全部历史版本
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (updateState.status === "error" || updateState.status === "up-to-date") {
                  resetUpdateState();
                }
                onClose();
              }}
              className="rounded-lg border border-[var(--border)] px-3.5 py-1.5 text-xs font-medium text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              {updateState.status === "available" ? "稍后提醒" : "关闭"}
            </button>

            {updateState.status === "up-to-date" && (
              <button
                type="button"
                onClick={handleRetry}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-3.5 py-1.5 text-xs font-medium text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                <RefreshCw size={12} />
                重新检查
              </button>
            )}

            {updateState.status === "available" && (
              <button
                type="button"
                disabled={installing}
                onClick={() => void handleInstall()}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={14} />
                {isTauri ? "下载更新" : "前往下载新版"}
              </button>
            )}

            {updateState.status === "ready-to-install" && (
              <button
                type="button"
                disabled={installing}
                onClick={() => void handleApplyInstall()}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={14} />
                立即安装并重启
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
