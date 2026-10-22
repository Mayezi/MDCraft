// 最近打开的磁盘文件和文件夹，记录由 store 持久化。
// 展开/收起用 grid 行高过渡（0fr↔1fr），不做瞬时显隐。
import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, FilePlus, FileText, Folder, FolderOpen } from "lucide-react";
import * as backend from "../lib/backend";
import { useStore } from "../store";
import { openDocByPath } from "../lib/docActions";
import { openFolder } from "../lib/workspace";
import { notifyError } from "../lib/notify";
import type { RecentEntry } from "../lib/types";

export default function RecentFiles({ onHeightChange }: { onHeightChange?: (height: number) => void }) {
  const entries = useStore((s) => s.recentEntries);
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    const element = headerRef.current;
    if (!element || !onHeightChange) return;
    // 上报「收起态整块」高度：标题行 + 外层容器的上边框与上下内边距。
    // 右侧状态栏条带据此等高，两侧分隔线与底边对齐；
    // 展开列表高度不计入（展开不得撑高右侧编辑区条带）
    const report = () => {
      const base = element.getBoundingClientRect().height;
      const box = element.parentElement;
      if (!box) return onHeightChange(base);
      const style = getComputedStyle(box);
      const extra =
        (parseFloat(style.borderTopWidth) || 0) +
        (parseFloat(style.paddingTop) || 0) +
        (parseFloat(style.paddingBottom) || 0) +
        (parseFloat(style.borderBottomWidth) || 0);
      onHeightChange(base + extra);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeightChange, entries.length]);

  const reopen = async (entry: RecentEntry) => {
    try {
      if (entry.kind === "folder") {
        if (!await openFolder(entry.path)) notifyError("打开失败：文件夹可能已移动或删除");
      } else {
        await openDocByPath(entry.path);
      }
    } catch (error) {
      notifyError(`打开失败：${error}`);
    }
  };

  // 最近列表里没有想要的，直接在这里唤起系统对话框打开
  const pickFile = async () => {
    const picked = await backend.pickOpenFile();
    if (picked) await openDocByPath(picked.path, picked.name);
  };
  const pickFolder = async () => {
    const root = await backend.pickOpenFolder();
    if (root) await openFolder(root);
  };

  return (
    <div className="shrink-0 border-t border-[var(--border)] py-1">
      <button
        ref={headerRef}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-left text-[12px] font-medium text-[var(--fg-soft)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
      >
        <ChevronRight
          size={13}
          className={`shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        最近打开
      </button>
      <div
        id={listId}
        className={`recent-body ${open ? "is-open" : ""}`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="recent-body-inner">
          <div className="max-h-[min(45vh,320px)] overflow-y-auto">
            {(["folder", "file"] as const).map((kind) => {
              const recent = entries.filter((entry) => entry.kind === kind).slice(0, 5);
              if (!recent.length) return null;
              const Icon = kind === "folder" ? Folder : FileText;
              return (
                <div key={kind}>
                  <div className="px-5 py-1 text-[11px] text-[var(--fg-faint)]">{kind === "folder" ? "文件夹" : "文件"}</div>
                  {recent.map((entry) => (
                    <button
                      key={entry.path}
                      title={entry.path}
                      onClick={() => void reopen(entry)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded px-5 py-1.5 text-left text-[12px] text-[var(--fg-soft)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
                    >
                      <Icon size={14} className="shrink-0 text-[var(--fg-faint)]" />
                      <span className="truncate">{entry.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || entry.path}</span>
                    </button>
                  ))}
                </div>
              );
            })}
            {!entries.length && <div className="px-5 py-2 text-[12px] text-[var(--fg-faint)]">暂无最近打开记录</div>}
          </div>
          <div className="border-t border-[var(--border)] px-3 pb-2.5 pt-2">
            <div className="mb-2.5 px-2 text-[11px] text-[var(--fg-faint)]">没找到想要的？直接打开</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void pickFile()}
                className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] font-medium text-[var(--fg-soft)] transition-all duration-150 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] active:scale-[0.98]"
              >
                <FilePlus size={14} className="shrink-0" />
                打开文件
              </button>
              <button
                type="button"
                onClick={() => void pickFolder()}
                className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] font-medium text-[var(--fg-soft)] transition-all duration-150 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] active:scale-[0.98]"
              >
                <FolderOpen size={14} className="shrink-0" />
                打开文件夹
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
