// 侧栏：文件 / 大纲 两面板；右缘可拖拽调宽（180~480，localStorage 持久化）

import { useCallback, useEffect, useRef } from "react";
import { useStore } from "../store";
import FileTree from "./FileTree";
import Outline from "./Outline";

const TABS = [
  { key: "files", label: "文件" },
  { key: "outline", label: "大纲" },
] as const;

const MIN_W = 180;
const MAX_W = 480;

export default function Sidebar({ onRecentHeightChange }: { onRecentHeightChange?: (height: number) => void }) {
  const tab = useStore((s) => s.settings.sidebarTab);
  const width = useStore((s) => s.settings.sidebarWidth);
  const set = useStore((s) => s.setSettings);
  /** 面板切换方向：用于决定入场滑动的方向 */
  const prevTab = useRef(tab);
  const tabIndex = TABS.findIndex((t) => t.key === tab);
  const prevIndex = TABS.findIndex((t) => t.key === prevTab.current);
  const dir = tabIndex < prevIndex ? "back" : "forward";

  useEffect(() => {
    prevTab.current = tab;
  }, [tab]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      // 拖拽时关闭外壳宽度过渡，否则面板宽度会追着鼠标慢半拍
      document.documentElement.dataset.sidebarResizing = "1";

      const onMove = (ev: PointerEvent) => {
        const next = Math.min(MAX_W, Math.max(MIN_W, startW + (ev.clientX - startX)));
        set({ sidebarWidth: next });
      };
      const finish = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        delete document.documentElement.dataset.sidebarResizing;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        window.removeEventListener("blur", finish);
        // 拖拽结束持久化（拖拽过程中的高频 set 不写 storage）
        localStorage.setItem("mdcraft:sidebar-width", String(useStore.getState().settings.sidebarWidth));
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
      window.addEventListener("blur", finish);
    },
    [set, width],
  );

  return (
    <div
      className="relative flex h-full shrink-0 select-none flex-col border-r border-[var(--border)] bg-[var(--bg-soft)]"
      style={{ width }}
    >
      {/* 胶囊式分段控制器：文件 / 大纲 */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg)] p-2.5">
        <div className="grid grid-cols-2 p-1 rounded-lg bg-[var(--bg-hover)]">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`flex cursor-pointer items-center justify-center rounded-md py-1.5 text-[12px] font-medium transition-all duration-150 ${
                tab === t.key
                  ? "bg-[var(--bg)] text-[var(--fg-strong)] shadow-sm"
                  : "text-[var(--fg-faint)] hover:text-[var(--fg)]"
              }`}
              onClick={() => set({ sidebarTab: t.key })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {/* key=tab 触发入场动画；方向由上一次页签位置决定 */}
      <div
        key={tab}
        data-dir={dir}
        className="sidebar-panel flex min-h-0 flex-1 flex-col"
      >
        {tab === "files" && <FileTree onRecentHeightChange={onRecentHeightChange} />}
        {tab === "outline" && <Outline />}
      </div>
      {/* 右缘拖拽条：无任何 hover/拖拽色（Notion/Obsidian 同款——hover 仅变光标，反馈由宽度实时变化承担） */}
      <div
        onPointerDown={onPointerDown}
        className="absolute inset-y-0 right-0 z-20 w-[5px] cursor-col-resize"
        title="拖拽调节侧栏宽度"
      />
    </div>
  );
}
