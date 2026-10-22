// 顶部菜单栏：文件/帮助 —— 编辑快捷键集中展示在帮助菜单
// （品牌位：应用图标 + 名称；主题入口在工具栏右侧按钮；导出在文件树右键）
// 段落类命令由斜杠面板承载；源码模式入口在左下角状态栏（Ctrl+/ 同效）

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, FileText, HelpCircle, Moon, Palette, Settings as SettingsIcon, Sun } from "lucide-react";
import { useStore } from "../store";
import * as backend from "../lib/backend";
import { openDocByPath, saveActiveDoc } from "../lib/docActions";
import { openFolder } from "../lib/workspace";
import { getView } from "../editor/viewref";
import { THEME_MODES, THEME_PALETTES } from "../lib/types";
import { PaletteDot } from "./ThemeControls";
import { WELCOME } from "../lib/samples";
import GithubIcon from "./GithubIcon";
import SettingsDialog, { type SettingsCategory } from "./SettingsDialog";
import { checkUpdate, openUpdateDialog, useUpdateState } from "../lib/updater";
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
  const updateState = useUpdateState();
  const hasUpdate = updateState.status === "available";
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 设置面板打开时定位到的分类（帮助菜单的「关于」直达设置里的「关于」） */
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory | undefined>(undefined);
  /** 配色主题弹出菜单（主题模式用按钮循环切换，见 dbx 的做法） */
  const [paletteMenuOpen, setPaletteMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const paletteMenuRef = useRef<HTMLDivElement>(null);
  /** 二级子菜单是否需向左展开（父项贴近右缘时），避免溢出窗口右边界 */
  const [subFlip, setSubFlip] = useState<Record<string, boolean>>({});

  // 主题模式按钮：图标随当前模式变化（浅色=太阳 / 深色=月亮）
  const modeLabel = THEME_MODES.find((m) => m.id === settings.themeMode)?.label ?? "浅色";
  const paletteLabel = THEME_PALETTES.find((p) => p.id === settings.palette)?.label ?? "";
  const modeIcon =
    settings.themeMode === "light" ? <Sun size={16} /> : <Moon size={16} />;
  /** 点击按钮循环切换：浅色 ↔ 深色（对齐 dbx） */
  const cycleThemeMode = () => {
    setSettings({ themeMode: settings.themeMode === "light" ? "dark" : "light" });
  };

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
    const close = (e: PointerEvent) => {
      if (menuOpen !== null && !menuRef.current?.contains(e.target as Node)) setMenuOpen(null);
      if (!paletteMenuRef.current?.contains(e.target as Node)) setPaletteMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(null);
        setPaletteMenuOpen(false);
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

  /** 打开设置面板（可指定初始分类） */
  const openSettings = (category?: SettingsCategory) => {
    setSettingsCategory(category);
    setSettingsOpen(true);
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
            openUpdateDialog();
            void checkUpdate(true);
          },
        },
        { label: "关于 MDCraft", run: () => openSettings("about") },
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
        // 弹窗（设置 / 更新）渲染在工具栏 DOM 内，弹窗上的双击不能缩放窗口
        const target = e.target as HTMLElement;
        if (target.closest('[role="dialog"], .modal-overlay')) return;
        if (backend.isTauri && !target.closest("button")) {
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

        {/* 主题模式：点击循环切换 浅色 ↔ 深色（对齐 dbx） */}
        <Tooltip content={`主题：${modeLabel}`}>
          <button
            aria-label="切换主题"
            onMouseDown={(e) => e.preventDefault()}
            onClick={cycleThemeMode}
            className="my-1 flex h-8 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] active:[&_svg]:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <span key={settings.themeMode} className="theme-mode-icon flex items-center">
              {modeIcon}
            </span>
          </button>
        </Tooltip>

        {/* 配色主题：13 套预设，名称前带色块 */}
        <div ref={paletteMenuRef} className="relative">
          <Tooltip content={`配色主题：${paletteLabel}`}>
            <button
              aria-label="配色主题"
              aria-expanded={paletteMenuOpen}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPaletteMenuOpen(!paletteMenuOpen)}
              className="my-1 flex h-8 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] active:[&_svg]:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <Palette size={16} className="transition-transform duration-200" />
            </button>
          </Tooltip>
          {paletteMenuOpen && (
            <div className="ui-pop ui-pop-right absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-[196px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
              {THEME_PALETTES.map((palette) => (
                <button
                  key={palette.id}
                  onClick={() => {
                    setSettings({ palette: palette.id });
                    setPaletteMenuOpen(false);
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
            onClick={() => openSettings()}
            className="my-1 flex h-8 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] active:[&_svg]:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <SettingsIcon size={16} className="transition-transform duration-200" />
          </button>
        </Tooltip>
        <div className="mx-1 w-px self-center bg-[var(--border)]" aria-hidden="true" />
        <WindowControls />
      </div>

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          initialCategory={settingsCategory}
        />
      )}
    </div>
  );
}
