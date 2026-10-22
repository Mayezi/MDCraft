// 设置面板：只放跨会话偏好（外观 / 编辑器 / 启动），临时状态与一次性动作不进来。
// 修改即时生效并写入桌面端 mdcraft.json（浏览器模式降级 localStorage）。

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Download, FolderOpen, Upload, X } from "lucide-react";
import { useStore } from "../store";
import * as backend from "../lib/backend";
import { buildSettingsBackup, parseSettingsBackup } from "../lib/settingsBackup";
import { APP_VERSION } from "../lib/version";
import { ThemeModeSwitch, ThemePaletteSelect } from "./ThemeControls";

/** 主题默认字号/行高（唯一一套排版，这里镜像一份用于「跟随主题」时的显示值） */
const BASE_METRICS = { fs: 16, lh: 1.75 };

const WIDTH_PRESETS = [
  { label: "跟随主题", value: null },
  { label: "窄", value: 720 },
  { label: "标准", value: 860 },
  { label: "宽", value: 1100 },
] as const;

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
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
        checked ? "bg-[var(--accent)]" : "bg-[var(--border)]"
      }`}
    >
      <span
        className={`absolute left-0 top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-[19px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 py-2">
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--fg)]">{title}</div>
        {description && (
          <div className="mt-0.5 max-w-[360px] text-[11.5px] leading-4 text-[var(--fg-faint)]">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[var(--border)] py-3.5 first:pt-0 last:border-0 last:pb-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold text-[var(--fg-soft)]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSettings);
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  /** 桌面端 mdcraft.json 的实际路径（浏览器模式为 null） */
  const [configPath, setConfigPath] = useState<string | null>(null);

  // 聚焦对话框本身而不是某个按钮：避免鼠标打开时出现按钮焦点环
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!backend.isTauri) return;
    let alive = true;
    backend
      .settingsFilePath()
      .then((path) => {
        if (alive) setConfigPath(path);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 对话框内 Esc 优先关闭，避免触发编辑器/面板的 Esc 行为
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const fontSize = settings.fontSize ?? BASE_METRICS.fs;
  const lineHeight = settings.lineHeight ?? BASE_METRICS.lh;
  const followingTheme =
    settings.fontSize === null && settings.lineHeight === null && settings.contentWidth === null;

  const handleExport = async () => {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const json = buildSettingsBackup(useStore.getState().settings);
      const name = `mdcraft-settings-${new Date().toISOString().slice(0, 10)}.json`;
      const saved = await backend.saveJsonFile(name, json);
      if (saved) setBackupMsg({ kind: "ok", text: "配置已导出为 JSON" });
    } catch (error) {
      setBackupMsg({ kind: "error", text: `导出失败：${String(error)}` });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImport = async () => {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const picked = await backend.pickJsonFile();
      if (!picked) return;
      const patch = parseSettingsBackup(picked.content);
      useStore.getState().setSettings(patch);
      // 侧栏宽度不经过 mdcraft:settings，导入时同步写入它自己的持久化键
      if (typeof patch.sidebarWidth === "number") {
        localStorage.setItem("mdcraft:sidebar-width", String(patch.sidebarWidth));
      }
      setBackupMsg({ kind: "ok", text: `已导入 ${picked.name}` });
    } catch (error) {
      setBackupMsg({ kind: "error", text: `导入失败：${String(error)}` });
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <div
      className="modal-overlay fixed inset-0 z-[110] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-card flex max-h-[88vh] w-[700px] max-w-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-[0_16px_48px_rgba(0,0,0,0.25)] outline-none"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-3.5">
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold text-[var(--fg-strong)]">
              设置
            </h2>
            <p className="mt-0.5 text-[11.5px] text-[var(--fg-faint)]">偏好会持久化到本机，修改即时生效</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭设置"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Section
            title="外观"
            action={
              <button
                type="button"
                disabled={followingTheme}
                onClick={() => set({ fontSize: null, lineHeight: null, contentWidth: null })}
                className={`text-[11px] transition-colors ${
                  followingTheme
                    ? "cursor-default text-[var(--fg-faint)] opacity-50"
                    : "cursor-pointer text-[var(--accent)] hover:underline"
                }`}
              >
                跟随主题
              </button>
            }
          >
            <SettingRow title="主题模式" description="浅色 / 深色 / 跟随系统">
              <ThemeModeSwitch />
            </SettingRow>
            <SettingRow title="配色主题" description="界面与正文的配色方案（与主题模式相互独立）">
              <ThemePaletteSelect />
            </SettingRow>

            <SettingRow title="正文字号" description="仅影响编辑区；跟随主题时使用主题默认字号">
              <div className="w-52">
                <div className="mb-0.5 text-right text-[11.5px] tabular-nums text-[var(--fg-soft)]">
                  {fontSize} px
                </div>
                <input
                  type="range"
                  min={12}
                  max={24}
                  step={1}
                  value={fontSize}
                  aria-label="正文字号"
                  onChange={(e) => set({ fontSize: Number(e.target.value) })}
                  className="settings-range w-full"
                />
              </div>
            </SettingRow>

            <SettingRow title="行高" description="正文行间距，影响阅读密度">
              <div className="w-52">
                <div className="mb-0.5 text-right text-[11.5px] tabular-nums text-[var(--fg-soft)]">
                  {lineHeight.toFixed(2)}
                </div>
                <input
                  type="range"
                  min={1.3}
                  max={2.2}
                  step={0.05}
                  value={lineHeight}
                  aria-label="正文行高"
                  onChange={(e) => set({ lineHeight: Number(e.target.value) })}
                  className="settings-range w-full"
                />
              </div>
            </SettingRow>

            <SettingRow title="正文宽度" description="宽屏下的阅读栏宽；跟随主题时由主题决定">
              <div className="flex items-center gap-1">
                {WIDTH_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => set({ contentWidth: preset.value })}
                    className={`rounded-md px-2 py-1 text-[11.5px] transition-colors duration-150 ${
                      settings.contentWidth === preset.value
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--fg-soft)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow title="右侧缩略图" description="在编辑区右侧显示全文缩略导航，可点击或拖动定位">
              <Switch
                checked={settings.showMinimap}
                onChange={(value) => set({ showMinimap: value })}
                label="右侧缩略图"
              />
            </SettingRow>
          </Section>

          <Section title="编辑器与启动">
            <SettingRow title="恢复上次打开的文件夹" description="下次启动时自动重新打开；关闭后从空状态开始">
              <Switch
                checked={settings.restoreFolder}
                onChange={(value) => set({ restoreFolder: value })}
                label="恢复上次打开的文件夹"
              />
            </SettingRow>
            <SettingRow title="目录树显示所有文件" description="显示文件夹内全部文件（含 txt/js/json 等）；关闭则仅显示 Markdown 与资源文件">
              <Switch
                checked={settings.showAllFiles}
                onChange={(value) => set({ showAllFiles: value })}
                label="目录树显示所有文件"
              />
            </SettingRow>
          </Section>

          <Section title="配置文件">
            <SettingRow
              title="mdcraft.json"
              description={
                configPath ?? "浏览器模式无配置文件，设置保存在 localStorage"
              }
            >
              {configPath && (
                <button
                  type="button"
                  onClick={() =>
                    void backend
                      .showInFolder(configPath)
                      .catch((error: unknown) => alert(`打开失败：${String(error)}`))
                  }
                  className="flex cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[11.5px] text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <FolderOpen size={13} />
                  在文件夹中显示
                </button>
              )}
            </SettingRow>
          </Section>

          <Section title="配置备份">
            <SettingRow
              title="导出 / 导入配置"
              description="导出的备份为 JSON，仅包含设置项，不包含文档内容"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={backupBusy}
                  onClick={() => void handleImport()}
                  className="flex cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[11.5px] text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-50"
                >
                  <Upload size={13} />
                  导入 JSON
                </button>
                <button
                  type="button"
                  disabled={backupBusy}
                  onClick={() => void handleExport()}
                  className="flex cursor-pointer items-center gap-1 rounded-md bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11.5px] text-[var(--accent)] transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-50"
                >
                  <Download size={13} />
                  导出 JSON
                </button>
              </div>
            </SettingRow>
            {backupMsg && (
              <div
                aria-live="polite"
                className={`px-0.5 text-[11px] ${
                  backupMsg.kind === "ok" ? "text-[var(--accent)]" : "text-[var(--danger)]"
                }`}
              >
                {backupMsg.text}
              </div>
            )}
          </Section>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <span className="text-[11px] text-[var(--fg-faint)]">MDCraft v{APP_VERSION}</span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
