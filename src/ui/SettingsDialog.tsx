// 设置面板：左侧分类 tab + 右侧顶部全局搜索。
// 放跨会话偏好与全局动作（外观 / 文件与启动 / 配置文件 / 配置备份 / 更新），临时状态不进来。
// 修改即时生效并写入桌面端 mdcraft.json（浏览器模式降级 localStorage）。

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useStore } from "../store";
import * as backend from "../lib/backend";
import { buildSettingsBackup, parseSettingsBackup } from "../lib/settingsBackup";
import { matchSettingsRows, type SettingsSearchable } from "../lib/settingsSearch";
import { APP_VERSION } from "../lib/version";
import { checkUpdate, downloadAndInstallUpdate, useUpdateState } from "../lib/updater";
import { ThemeModeSwitch, ThemePaletteSelect } from "./ThemeControls";

/** 主题默认字号/行高（唯一一套排版，这里镜像一份用于「跟随主题」时的显示值） */
const BASE_METRICS = { fs: 16, lh: 1.75 };

const WIDTH_PRESETS = [
  { label: "跟随主题", value: null },
  { label: "窄", value: 720 },
  { label: "标准", value: 860 },
  { label: "宽", value: 1100 },
] as const;

/** 左侧分类 tab（顺序即导航顺序） */
const CATEGORIES = [
  { id: "appearance", label: "外观" },
  { id: "files", label: "文件与启动" },
  { id: "config", label: "配置文件" },
  { id: "backup", label: "配置备份" },
  { id: "update", label: "更新" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

/** 单条设置：id 同时是搜索锚点与 DOM id */
interface RowDef extends SettingsSearchable {
  /** 右侧控件 */
  control: ReactNode;
}

/** 键盘聚焦描边（与项目其它按钮保持一致） */
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
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 ${FOCUS_RING} ${
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

/** 小号次要按钮 */
function MiniButton({
  children,
  onClick,
  disabled,
  icon,
  primary,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1.5 text-[11.5px] transition-colors disabled:cursor-default disabled:opacity-50 ${FOCUS_RING} ${
        primary
          ? "bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-80"
          : "border border-[var(--border)] text-[var(--fg-soft)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSettings);
  const updateState = useUpdateState();
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  /** 桌面端 mdcraft.json 的实际路径（浏览器模式为 null） */
  const [configPath, setConfigPath] = useState<string | null>(null);
  /** 左侧当前分类 tab */
  const [category, setCategory] = useState<CategoryId>("appearance");
  /** 搜索关键词（非空时右侧内容切换为搜索结果） */
  const [query, setQuery] = useState("");
  /** 搜索结果高亮项下标（按展示顺序） */
  const [activeIndex, setActiveIndex] = useState(0);
  /** 待定位的设置项（搜索结果点击后跳转并闪烁高亮；seq 保证重复选中也能重放动画） */
  const [pendingFocus, setPendingFocus] = useState<{ id: string; seq: number } | null>(null);

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

  // 对话框内 Esc 优先关闭，避免触发编辑器/面板的 Esc 行为；
  // 搜索态下 Esc 先退出搜索态
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (query.trim()) {
          setQuery("");
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, query]);

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

  const handleCheckUpdate = () => {
    void checkUpdate(true);
  };

  const handleInstallUpdate = () => {
    void downloadAndInstallUpdate();
  };

  /** 各分类下的设置项（渲染与搜索共用同一份数据，避免两处不同步） */
  const rows: Record<CategoryId, RowDef[]> = {
    appearance: [
      {
        id: "theme-mode",
        title: "主题模式",
        description: "浅色 / 深色",
        keywords: ["theme", "light", "dark", "主题", "深色", "浅色"],
        control: <ThemeModeSwitch />,
      },
      {
        id: "palette",
        title: "配色主题",
        description: "界面与正文的配色方案（与主题模式相互独立）",
        keywords: ["palette", "color", "配色", "色板"],
        control: <ThemePaletteSelect />,
      },
      {
        id: "font-size",
        title: "正文字号",
        description: "仅影响编辑区；跟随主题时使用主题默认字号",
        keywords: ["font", "size", "字号", "字体"],
        control: (
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
        ),
      },
      {
        id: "line-height",
        title: "行高",
        description: "正文行间距，影响阅读密度",
        keywords: ["line", "height", "行距"],
        control: (
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
        ),
      },
      {
        id: "content-width",
        title: "正文宽度",
        description: "宽屏下的阅读栏宽；跟随主题时由主题决定",
        keywords: ["width", "宽度", "栏宽"],
        control: (
          <div className="flex items-center gap-1">
            {WIDTH_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => set({ contentWidth: preset.value })}
                className={`rounded-md px-2 py-1 text-[11.5px] transition-colors duration-150 ${FOCUS_RING} ${
                  settings.contentWidth === preset.value
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--fg-soft)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        ),
      },
      {
        id: "minimap",
        title: "右侧缩略图",
        description: "在编辑区右侧显示全文缩略导航，可点击或拖动定位",
        keywords: ["minimap", "缩略图", "概览"],
        control: (
          <Switch
            checked={settings.showMinimap}
            onChange={(value) => set({ showMinimap: value })}
            label="右侧缩略图"
          />
        ),
      },
    ],
    files: [
      {
        id: "restore-folder",
        title: "恢复上次打开的文件夹",
        description: "下次启动时自动重新打开；关闭后从空状态开始",
        keywords: ["startup", "启动", "恢复", "recent"],
        control: (
          <Switch
            checked={settings.restoreFolder}
            onChange={(value) => set({ restoreFolder: value })}
            label="恢复上次打开的文件夹"
          />
        ),
      },
      {
        id: "show-all-files",
        title: "目录树显示所有文件",
        description: "显示文件夹内全部文件（含 txt/js/json 等）；关闭则仅显示 Markdown 与资源文件",
        keywords: ["tree", "文件树", "目录", "所有文件"],
        control: (
          <Switch
            checked={settings.showAllFiles}
            onChange={(value) => set({ showAllFiles: value })}
            label="目录树显示所有文件"
          />
        ),
      },
    ],
    config: [
      {
        id: "config-file",
        title: "mdcraft.json",
        description: configPath ?? "浏览器模式无配置文件，设置保存在 localStorage",
        keywords: ["config", "json", "配置", "路径", "文件"],
        control: configPath ? (
          <MiniButton
            icon={<FolderOpen size={13} />}
            onClick={() =>
              void backend
                .showInFolder(configPath)
                .catch((error: unknown) => alert(`打开失败：${String(error)}`))
            }
          >
            在文件夹中显示
          </MiniButton>
        ) : null,
      },
    ],
    backup: [
      {
        id: "backup-transfer",
        title: "导出 / 导入配置",
        description: "导出的备份为 JSON，仅包含设置项，不包含文档内容",
        keywords: ["backup", "备份", "导出", "导入", "export", "import"],
        control: (
          <div className="flex items-center gap-2">
            <MiniButton
              disabled={backupBusy}
              icon={<Upload size={13} />}
              onClick={() => void handleImport()}
            >
              导入 JSON
            </MiniButton>
            <MiniButton
              primary
              disabled={backupBusy}
              icon={<Download size={13} />}
              onClick={() => void handleExport()}
            >
              导出 JSON
            </MiniButton>
          </div>
        ),
      },
    ],
    update: [
      {
        id: "current-version",
        title: "当前版本",
        description: "已安装的应用版本",
        keywords: ["version", "版本", "当前"],
        control: <span className="font-mono text-[12.5px] text-[var(--fg-soft)]">v{APP_VERSION}</span>,
      },
      {
        id: "check-update",
        title: "检查更新",
        description: "从 GitHub Releases 获取最新版本，下载时校验签名",
        keywords: ["update", "更新", "升级", "版本", "release"],
        control: (
          <MiniButton
            primary
            disabled={updateState.status === "checking"}
            icon={
              <RefreshCw
                size={13}
                className={updateState.status === "checking" ? "animate-spin" : undefined}
              />
            }
            onClick={handleCheckUpdate}
          >
            {updateState.status === "checking" ? "检查中…" : "检查更新"}
          </MiniButton>
        ),
      },
      {
        id: "release-history",
        title: "全部历史版本",
        description: "在 GitHub Releases 查看过往版本与更新说明",
        keywords: ["release", "历史版本", "github", "下载"],
        control: (
          <MiniButton
            icon={<ExternalLink size={13} />}
            onClick={() => void backend.openUrl("https://github.com/Mayezi/MDCraft/releases")}
          >
            打开 Releases
          </MiniButton>
        ),
      },
    ],
  };

  const allRows: (RowDef & { category: CategoryId })[] = CATEGORIES.flatMap((cat) =>
    rows[cat.id].map((row) => ({ ...row, category: cat.id })),
  );
  const searching = query.trim().length > 0;
  const results = searching ? matchSettingsRows(query, allRows) : [];
  // 结果按分类分组展示，键盘上下键必须跟着视觉顺序走
  const resultGroups = CATEGORIES.map((cat) => ({
    cat,
    items: results.filter((item) => item.category === cat.id),
  })).filter((group) => group.items.length > 0);
  const displayResults = resultGroups.flatMap((group) => group.items);
  const activeOptionId =
    displayResults[activeIndex] && searching ? `settings-opt-${displayResults[activeIndex].id}` : undefined;

  // 搜索结果点击：切到对应分类、退出搜索、滚动定位并闪烁高亮
  useEffect(() => {
    if (!pendingFocus) return;
    const el = document.getElementById(`setting-${pendingFocus.id}`);
    if (!el) {
      setPendingFocus(null);
      return;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    // 先移除再加，保证同一条目重复选中时动画能重放
    el.classList.remove("settings-hit");
    void el.offsetWidth;
    el.classList.add("settings-hit");
    const timer = window.setTimeout(() => {
      el.classList.remove("settings-hit");
      setPendingFocus(null);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [pendingFocus]);

  const selectResult = (item: { category: CategoryId; id: string }) => {
    setCategory(item.category);
    setQuery("");
    setActiveIndex(0);
    setPendingFocus({ id: item.id, seq: Date.now() });
    // 搜索视图随即卸载，把焦点收回搜索框，便于继续输入
    searchRef.current?.focus();
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(displayResults.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const item = displayResults[activeIndex];
      if (!item) return;
      e.preventDefault();
      selectResult(item);
    }
  };

  const activeCategory = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];

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
        className="modal-card flex h-[min(640px,88vh)] w-[880px] max-w-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-[0_16px_48px_rgba(0,0,0,0.25)] outline-none"
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
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] ${FOCUS_RING}`}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左侧分类 tab */}
          <nav
            aria-label="设置分类"
            className="w-[168px] shrink-0 overflow-y-auto border-r border-[var(--border)] px-2.5 py-3"
          >
            <div className="flex flex-col gap-0.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setCategory(cat.id);
                    setQuery("");
                    setActiveIndex(0);
                  }}
                  aria-current={cat.id === category}
                  className={`rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors duration-150 ${FOCUS_RING} ${
                    cat.id === category
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                      : "text-[var(--fg-soft)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </nav>

          {/* 右侧：顶部搜索 + 分类内容 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]"
                />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={onSearchKeyDown}
                  type="text"
                  role="combobox"
                  aria-label="搜索设置"
                  aria-expanded={searching}
                  aria-controls="settings-search-results"
                  aria-activedescendant={activeOptionId}
                  placeholder="搜索设置…"
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] pl-9 pr-8 text-[12.5px] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--fg-faint)] focus:border-[var(--accent)]"
                />
                {query.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                    title="清空"
                    aria-label="清空搜索"
                    className={`absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] ${FOCUS_RING}`}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
              {searching ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className={`mb-3 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-[var(--fg-faint)] transition-colors hover:text-[var(--fg)] ${FOCUS_RING}`}
                  >
                    <ArrowLeft size={13} />
                    返回设置
                  </button>
                  {displayResults.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-10 text-center text-[12px] text-[var(--fg-faint)]">
                      没有匹配「{query.trim()}」的设置项
                    </div>
                  ) : (
                    <div id="settings-search-results" role="listbox" aria-label="设置搜索结果">
                      {resultGroups.map((group) => (
                        <div
                          key={group.cat.id}
                          role="group"
                          aria-label={group.cat.label}
                          className="mb-5 last:mb-0"
                        >
                          <div className="mb-1.5 px-1 text-[11px] font-medium text-[var(--fg-faint)]">
                            {group.cat.label}
                          </div>
                          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                            {group.items.map((item) => {
                              const index = displayResults.indexOf(item);
                              const active = index === activeIndex;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  role="option"
                                  id={`settings-opt-${item.id}`}
                                  aria-selected={active}
                                  onMouseEnter={() => setActiveIndex(index)}
                                  onClick={() => selectResult(item)}
                                  className={`flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left transition-colors ${FOCUS_RING} ${
                                    active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--bg-hover)]"
                                  }`}
                                >
                                  <span className="text-[12.5px] text-[var(--fg)]">{item.title}</span>
                                  {item.description && (
                                    <span className="text-[11px] leading-4 text-[var(--fg-faint)]">
                                      {item.description}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-[12px] font-semibold text-[var(--fg-soft)]">
                      {activeCategory.label}
                    </h3>
                    {category === "appearance" && (
                      <button
                        type="button"
                        disabled={followingTheme}
                        onClick={() => set({ fontSize: null, lineHeight: null, contentWidth: null })}
                        className={`text-[11px] transition-colors ${FOCUS_RING} ${
                          followingTheme
                            ? "cursor-default text-[var(--fg-faint)] opacity-50"
                            : "cursor-pointer text-[var(--accent)] hover:underline"
                        }`}
                      >
                        跟随主题
                      </button>
                    )}
                  </div>
                  {rows[category].map((row) => (
                    <div
                      key={row.id}
                      id={`setting-${row.id}`}
                      className="-mx-2 flex items-center justify-between gap-5 rounded-md px-2 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] text-[var(--fg)]">{row.title}</div>
                        {row.description && (
                          <div className="mt-0.5 max-w-[360px] text-[11.5px] leading-4 text-[var(--fg-faint)]">
                            {row.description}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">{row.control}</div>
                    </div>
                  ))}

                  {category === "backup" && backupMsg && (
                    <div
                      aria-live="polite"
                      className={`px-0.5 pt-1 text-[11px] ${
                        backupMsg.kind === "ok" ? "text-[var(--accent)]" : "text-[var(--danger)]"
                      }`}
                    >
                      {backupMsg.text}
                    </div>
                  )}

                  {category === "update" && (
                    <div
                      aria-live="polite"
                      className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2.5 text-[11.5px] leading-5 text-[var(--fg-soft)]"
                    >
                      {updateState.status === "idle" && <span>尚未检查更新。</span>}
                      {updateState.status === "checking" && <span>正在检查更新…</span>}
                      {updateState.status === "up-to-date" && (
                        <span>
                          当前已是最新版本
                          {updateState.date
                            ? `（发布于 ${new Date(updateState.date).toLocaleDateString()}）`
                            : ""}
                          。
                        </span>
                      )}
                      {updateState.status === "available" && (
                        <div className="space-y-2">
                          <div>
                            发现新版本{" "}
                            <span className="font-mono font-medium text-[var(--accent)]">
                              v{updateState.info.version}
                            </span>
                            。
                          </div>
                          <MiniButton
                            primary
                            icon={<Download size={13} />}
                            onClick={handleInstallUpdate}
                          >
                            {backend.isTauri ? "立即下载并安装" : "前往下载新版"}
                          </MiniButton>
                        </div>
                      )}
                      {updateState.status === "downloading" && (
                        <div className="space-y-1.5">
                          <div>正在下载更新包 {updateState.progress}%</div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                            <div
                              className="h-full bg-[var(--accent)] transition-all duration-200"
                              style={{ width: `${updateState.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {updateState.status === "ready-to-install" && (
                        <span>更新包已准备就绪，应用将自动退出并完成升级。</span>
                      )}
                      {updateState.status === "error" && (
                        <div className="space-y-1.5">
                          <div className="text-[var(--danger)]">{updateState.message}</div>
                          <MiniButton icon={<RefreshCw size={13} />} onClick={handleCheckUpdate}>
                            重试检查
                          </MiniButton>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <span className="text-[11px] text-[var(--fg-faint)]">MDCraft v{APP_VERSION}</span>
          <button
            type="button"
            onClick={onClose}
            className={`cursor-pointer rounded-md bg-[var(--accent)] px-4 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 ${FOCUS_RING}`}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
