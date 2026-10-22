// 顶部菜单栏：文件/视图/帮助 —— 编辑快捷键集中展示在帮助菜单
// （品牌位：应用图标 + 名称；主题入口在视图菜单；导出在文件树右键）
// 段落类命令由斜杠面板承载；源码模式入口在左下角状态栏（Ctrl+/ 同效）

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Eye, FileText, HelpCircle, Palette, Settings as SettingsIcon } from "lucide-react";
import { useStore } from "../store";
import * as backend from "../lib/backend";
import { openDocByPath, saveActiveDoc } from "../lib/docActions";
import { openFolder } from "../lib/workspace";
import { getView } from "../editor/viewref";
import { THEME_MODES, THEME_PALETTES } from "../lib/types";
import { PaletteDot } from "./ThemeControls";
import { APP_VERSION } from "../lib/version";
import { WELCOME } from "../lib/samples";
import SettingsDialog from "./SettingsDialog";
import UpdateDialog from "./UpdateDialog";
import { checkUpdate, useUpdateState } from "../lib/updater";
import Tooltip from "./Tooltip";
import WindowControls from "./WindowControls";

// ---------- 菜单数据 ----------

interface MItem {
  label?: string;
  hint?: string;
  run?: () => void;
  checked?: boolean;
  disabled?: boolean;
  sep?: boolean;
  /** 色块（配色主题项：名称前显示色点） */
  color?: string;
  items?: MItem[];
}

interface MGroup {
  label: string;
  icon?: ReactNode;
  build: () => MItem[];
}

export default function Toolbar() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const updateState = useUpdateState();
  const hasUpdate = updateState.status === "available";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  /** 二级子菜单是否需向左展开（父项贴近右缘时），避免溢出窗口右边界 */
  const [subFlip, setSubFlip] = useState<Record<string, boolean>>({});

  // 菜单：点击菜单组之外关闭 / Esc 关闭
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveDoc(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void onOpenFile();
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void onOpenFolderBtn();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (menuOpen === null) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(null);
      if (!themeMenuRef.current?.contains(e.target as Node)) setThemeMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(null);
        getView()?.focus();
      }
    };
    // 用 pointerdown 而非 mousedown：工具栏空白区是 Tauri 拖拽区（data-tauri-drag-region），
    // 其 mousedown 会被窗口拖拽在原生层消费、不派发给 JS，导致点菜单栏空白关不掉；
    // pointerdown 在 mousedown 之前独立派发，不受拖拽区拦截。
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const onOpenFile = async () => {
    const picked = await backend.pickOpenFile();
    if (picked) await openDocByPath(picked.path, picked.name);
  };

  const onOpenFolderBtn = async () => {
    const root = await backend.pickOpenFolder();
    if (!root) return;
    await openFolder(root);
  };

  const groups: MGroup[] = [
    {
      label: "文件",
      icon: <FileText size={13} />,
      build: () => [
        { label: "新建文档", hint: "Ctrl+N", run: () => useStore.getState().newDoc() },
        { label: "打开文件", hint: "Ctrl+O", run: () => void onOpenFile() },
        { label: "打开文件夹", hint: "Ctrl+Shift+O", run: () => void onOpenFolderBtn() },
        { sep: true },
        { label: "保存", hint: "Ctrl+S", run: () => void saveActiveDoc() },
        { label: "另存为", hint: "Ctrl+Shift+S", run: () => void saveActiveDoc(true) },
        { sep: true },
        { label: "关闭标签", run: () => useStore.getState().closeDoc(useStore.getState().activeDocId) },
      ],
    },
    {
      label: "视图",
      icon: <Eye size={13} />,
      build: () => [
        {
          label: "主题模式",
          items: THEME_MODES.map((mode) => ({
            label: mode.label,
            checked: settings.themeMode === mode.id,
            run: () => setSettings({ themeMode: mode.id }),
          })),
        },
        {
          label: "配色主题",
          items: THEME_PALETTES.map((palette) => ({
            label: palette.label,
            color: palette.color,
            checked: settings.palette === palette.id,
            run: () => setSettings({ palette: palette.id }),
          })),
        },
        { sep: true },
        {
          label: "源码模式",
          hint: "Ctrl+/（左下角）",
          checked: settings.sourceMode,
          run: () => setSettings({ sourceMode: !settings.sourceMode }),
        },
      ],
    },
    {
      label: "帮助",
      icon: <HelpCircle size={13} />,
      build: () => [
        { label: "欢迎使用 MDCraft", run: () => useStore.getState().openContent("欢迎使用 MDCraft.md", null, WELCOME) },
        {
          label: "快捷键",
          items: [
            { label: "新建文档", hint: "Ctrl+N" },
            { label: "打开文件", hint: "Ctrl+O" },
            { label: "打开文件夹", hint: "Ctrl+Shift+O" },
            { label: "保存", hint: "Ctrl+S" },
            { label: "另存为", hint: "Ctrl+Shift+S" },
            { sep: true },
            { label: "撤销", hint: "Ctrl+Z" },
            { label: "重做", hint: "Ctrl+Y" },
            { label: "剪切", hint: "Ctrl+X" },
            { label: "复制", hint: "Ctrl+C" },
            { label: "粘贴", hint: "Ctrl+V" },
            { label: "全选", hint: "Ctrl+A" },
            { sep: true },
            { label: "文内查找", hint: "Ctrl+F" },
            { label: "文内替换", hint: "Ctrl+H" },
            { label: "查找上/下一个", hint: "Shift+F3 / F3" },
            { sep: true },
            { label: "加粗", hint: "Ctrl+B" },
            { label: "斜体", hint: "Ctrl+I" },
            { label: "行内代码", hint: "Ctrl+E" },
            { label: "插入链接", hint: "Ctrl+K" },
            { label: "行内公式", hint: "Ctrl+Shift+M" },
            { label: "公式块", hint: "Ctrl+Alt+M" },
            { label: "代码块", hint: "Ctrl+Alt+C" },
            { label: "标题 1–6", hint: "Ctrl+1…6" },
            { label: "恢复正文", hint: "Ctrl+0" },
            { label: "源码模式", hint: "Ctrl+/" },
          ],
        },
        { sep: true },
        {
          label: "检查更新...",
          hint: hasUpdate ? `新版 v${updateState.info.version}` : undefined,
          run: () => {
            setUpdateOpen(true);
            void checkUpdate(true);
          },
        },
        { label: "关于 MDCraft", run: () => setAboutOpen(true) },
      ],
    },
  ];

  const renderMenuItems = (items: MItem[]): ReactNode =>
    items.map((item, i) => {
      if (item.sep) {
        return <div key={i} className="mx-2 my-1 h-px bg-[var(--border)]" />;
      }
      const subKey = item.label ?? String(i);
      return (
        <div key={i} className="group/item relative">
          <button
            disabled={item.disabled}
            onClick={() => {
              setMenuOpen(null);
              item.run?.();
            }}
            onMouseEnter={(e) => {
              // 二级子菜单：父项贴近右缘时向左展开，避免溢出窗口右边界
              if (item.items) {
                const r = e.currentTarget.getBoundingClientRect();
                setSubFlip((p) => ({ ...p, [subKey]: r.right + 220 > window.innerWidth }));
              }
            }}
            className="flex min-h-[28px] w-full cursor-pointer select-none items-center gap-3 rounded-md px-2.5 py-0.5 text-left text-[13px] text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-40"
          >
            {item.checked && <span className="shrink-0 text-[var(--accent)]">
              {item.checked && <Check size={13} strokeWidth={2.5} />}
            </span>}
            {item.color && <PaletteDot color={item.color} />}
            <span className="flex-1 whitespace-nowrap">{item.label}</span>
            {item.hint && (
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--fg-faint)]">{item.hint}</span>
            )}
            {item.items && <ChevronRight size={13} className="shrink-0 text-[var(--fg-faint)]" />}
          </button>
          {item.items && (
            <div
              className={`pointer-events-none absolute top-0 z-50 max-h-[calc(100vh-16px)] min-w-[180px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-opacity group-hover/item:pointer-events-auto group-hover/item:opacity-100 ${
                subFlip[subKey] ? "right-full" : "left-full"
              }`}
            >
              {renderMenuItems(item.items)}
            </div>
          )}
        </div>
      );
    });

  return (
    <div
      className="flex h-10 shrink-0 select-none items-stretch gap-1 border-b border-[var(--border)] bg-[var(--bg)] pl-3 pr-0"
      data-tauri-drag-region
      onDoubleClick={(e) => {
        // 无边框窗口：双击工具栏空白区（非按钮）最大化/还原
        if (backend.isTauri && !(e.target as HTMLElement).closest("button")) {
          void import("@tauri-apps/api/window")
            .then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
            .catch(() => {});
        }
      }}
    >
      {/* 无边框窗口下整条工具栏为拖拽区（按钮由 Tauri 自动排除） */}

      {/* 品牌位：应用图标 + 名称 */}
      <div className="flex items-center gap-1.5 select-none" aria-hidden="true">
        <img src="/app-icon.png" alt="MDCraft" className="h-4 w-4 rounded" draggable={false} />
        <span className="text-[12.5px] font-semibold text-[var(--fg)]">MDCraft</span>
      </div>

      {/* 菜单组 */}
      <div ref={menuRef} className="flex items-stretch">
        {groups.map((g, gi) => (
          <div key={g.label} className="relative">
            <button
              onMouseDown={(e) => {
                e.preventDefault(); // 不抢编辑器焦点
                setMenuOpen(menuOpen === gi ? null : gi);
              }}
              className={`my-1 flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-[12.5px] transition-colors relative ${
                menuOpen === gi
                  ? "bg-[var(--bg-hover)] text-[var(--fg)]"
                  : "text-[var(--fg)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
              }`}
            >
              {g.icon}
              {g.label}
              {g.label === "帮助" && hasUpdate && (
                <span className="absolute right-1 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              )}
            </button>
            {menuOpen === gi && (
              <div className="ui-pop absolute left-0 top-full z-50 min-w-[200px] rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
                {renderMenuItems(g.build())}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ml-auto flex items-stretch gap-1">
        <Tooltip content="GitHub 开源仓库 (Mayezi/MDCraft)">
          <a
            href="https://github.com/Mayezi/MDCraft"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub 开源仓库"
            onClick={(e) => {
              // 桌面端 WebView 不会用系统浏览器打开 target=_blank，统一走后端命令
              e.preventDefault();
              void backend.openUrl("https://github.com/Mayezi/MDCraft");
            }}
            className="my-1 flex h-8 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] active:[&_svg]:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <GithubIcon size={16} className="transition-transform duration-200" />
          </a>
        </Tooltip>

        <div ref={themeMenuRef} className="relative">
          <Tooltip content="切换主题">
            <button
              aria-label="切换主题"
              aria-expanded={themeMenuOpen}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setThemeMenuOpen(!themeMenuOpen)}
className="my-1 flex h-8 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] active:[&_svg]:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <Palette size={16} className="transition-transform duration-200" />
            </button>
          </Tooltip>
          {themeMenuOpen && (
            <div className="ui-pop ui-pop-right absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-[196px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
              <div className="px-2 py-1 text-[11px] text-[var(--fg-faint)]">主题模式</div>
              {THEME_MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => {
                    setSettings({ themeMode: mode.id });
                    setThemeMenuOpen(false);
                  }}
                  className="flex min-h-[28px] w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] text-[var(--fg)] hover:bg-[var(--bg-hover)]"
                >
                  <span className="flex-1">{mode.label}</span>
                  {settings.themeMode === mode.id && (
                    <Check size={14} className="text-[var(--accent)]" />
                  )}
                </button>
              ))}
              <div className="mx-2 my-1 h-px bg-[var(--border)]" />
              <div className="px-2 py-1 text-[11px] text-[var(--fg-faint)]">配色主题</div>
              {THEME_PALETTES.map((palette) => (
                <button
                  key={palette.id}
                  onClick={() => {
                    setSettings({ palette: palette.id });
                    setThemeMenuOpen(false);
                  }}
                  className="flex min-h-[28px] w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] text-[var(--fg)] hover:bg-[var(--bg-hover)]"
                >
                  <PaletteDot color={palette.color} />
                  <span className="flex-1">{palette.label}</span>
                  {settings.palette === palette.id && (
                    <Check size={14} className="text-[var(--accent)]" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <Tooltip content="设置">
          <button
            aria-label="设置"
            onClick={() => setSettingsOpen(true)}
            className="my-1 flex h-8 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] active:[&_svg]:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <SettingsIcon size={16} className="transition-transform duration-200" />
          </button>
        </Tooltip>
        <div className="mx-1 w-px self-center bg-[var(--border)]" aria-hidden="true" />
        <WindowControls />
      </div>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <UpdateDialog open={updateOpen} onClose={() => setUpdateOpen(false)} />
    </div>
  );
}

function GithubIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="modal-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-card w-80 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-6 shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
        <div className="mb-4 flex items-center gap-3">
          <img src="/app-icon.png" alt="MDCraft" className="h-10 w-10 rounded-lg" draggable={false} />
          <div>
            <div className="text-[15px] font-semibold text-[var(--fg)]">MDCraft</div>
            <div className="text-[11px] text-[var(--fg-faint)]">v{APP_VERSION} · 开源 Markdown 编辑器</div>
          </div>
        </div>
        <p className="mb-3 text-[12.5px] leading-5 text-[var(--fg-soft)]">
          所见即所得 Markdown 编辑器。输入 <code className="rounded bg-[var(--bg-soft)] px-1">/</code>{" "}
          快速插入内容；表格、公式、图片等块级元素点击即可编辑。
        </p>
        <p className="mb-5 text-[11.5px] leading-5 text-[var(--fg-faint)]">
          技术栈：Tauri 2 + Rust + React 19 + CodeMirror 6
        </p>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/Mayezi/MDCraft"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault();
              void backend.openUrl("https://github.com/Mayezi/MDCraft");
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] py-1.5 text-[12.5px] font-medium text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            <GithubIcon size={14} />
            <span>GitHub 仓库</span>
          </a>
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-md bg-[var(--accent)] py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
