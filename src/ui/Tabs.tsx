// 文档标签页（活动指示条滑动跟随，切换文档时视觉连续）

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { FileText, LocateFixed, X, FolderSearch, AlertTriangle } from "lucide-react";
import * as backend from "../lib/backend";
import { saveDocById } from "../lib/docActions";
import type { DocFile } from "../lib/types";

/** 右键菜单项统一样式（与文件树菜单一致） */
const MENU_ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-left text-[13.5px] text-[var(--fg)] hover:bg-[var(--bg-hover)]";

export default function Tabs() {
  const docs = useStore((s) => s.docs);
  const activeDocId = useStore((s) => s.activeDocId);
  const folderRoot = useStore((s) => s.folderRoot);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const active = docs.find((d) => d.id === activeDocId);
  const listRef = useRef<HTMLDivElement>(null);
  /** 活动指示条位置（相对标签滚动容器） */
  const [indicator, setIndicator] = useState({ x: 0, w: 0, on: false });
  /** 上一次布局的标签左缘：关闭标签后做 FLIP，让剩余标签平滑左移 */
  const positionsRef = useRef<Map<string, number>>(new Map());
  /** Tab 右键菜单位置（仅存有 docId 时显示） */
  const [menu, setMenu] = useState<{ x: number; y: number; docId: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** 待关闭的脏文档（弹保存确认） */
  const [pendingClose, setPendingClose] = useState<DocFile | null>(null);
  const [saving, setSaving] = useState(false);

  /** 请求关闭一个标签：脏文档先弹保存确认，否则直接关闭 */
  const requestClose = (id: string) => {
    const doc = docs.find((d) => d.id === id);
    if (!doc) return;
    if (!doc.dirty) {
      useStore.getState().closeDoc(id);
      return;
    }
    setPendingClose(doc);
  };

  /** 确认框里「保存并关闭」：保存成功才关闭；用户取消或保存失败则保持打开 */
  const onSaveAndClose = async () => {
    if (!pendingClose) return;
    setSaving(true);
    const ok = await saveDocById(pendingClose.id);
    setSaving(false);
    if (!ok) return;
    useStore.getState().closeDoc(pendingClose.id);
    setPendingClose(null);
  };

  /** 确认框里「不保存并关闭」 */
  const onDiscard = () => {
    if (!pendingClose) return;
    useStore.getState().closeDoc(pendingClose.id);
    setPendingClose(null);
  };

  // 点击菜单外部 / Esc 关闭右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // 仅当当前文档是磁盘文件且位于打开的文件夹内时可定位
  const canLocate = (() => {
    if (!active?.path || !folderRoot) return false;
    const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
    const path = norm(active.path);
    const root = norm(folderRoot);
    return path.startsWith(root + "\\") || path.startsWith(root + "/");
  })();

  const locate = () => {
    if (!canLocate || !active?.path) return;
    // 定位时展开侧栏并切换到文件页签。
    const patch: Partial<typeof settings> = {};
    if (!settings.sidebarVisible) patch.sidebarVisible = true;
    if (settings.sidebarTab !== "files") patch.sidebarTab = "files";
    if (Object.keys(patch).length) setSettings(patch);
    useStore.getState().setLocateRequest(active.path);
  };

  // 活动标签变化 / 标签数量变化后重新测量；宽度变化（未保存圆点、字体加载）也跟随
  useLayoutEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (!list || !el) {
      setIndicator((prev) => (prev.on ? { ...prev, on: false } : prev));
      return;
    }
    const measure = () => {
      const x = el.offsetLeft;
      const w = el.offsetWidth;
      setIndicator((prev) => (prev.on && prev.x === x && prev.w === w ? prev : { x, w, on: true }));
    };
    measure();
    const observer = new ResizeObserver(() => {
      measure();
      // 宽度变化（窗口缩放、字体加载）后同步旧位置，避免下一次 FLIP 用错基准
      const next = new Map<string, number>();
      list.querySelectorAll<HTMLElement>("[data-tab-id]").forEach((tab) => {
        next.set(tab.dataset.tabId ?? "", tab.offsetLeft);
      });
      positionsRef.current = next;
    });
    observer.observe(el);
    observer.observe(list);
    // 从文件树打开的新标签可能在可视区外：平滑滚入
    if (el.offsetLeft < list.scrollLeft || el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: Math.max(0, el.offsetLeft - 16), behavior: "smooth" });
    }
    return () => observer.disconnect();
  }, [activeDocId, docs.length]);

  // 关闭标签后：剩余标签从旧位置滑到新位置（FLIP），避免整排瞬间左跳
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const prev = positionsRef.current;
    const tabs = list.querySelectorAll<HTMLElement>("[data-tab-id]");
    tabs.forEach((tab) => {
      const oldLeft = prev.get(tab.dataset.tabId ?? "");
      if (oldLeft == null || typeof tab.animate !== "function") return;
      const delta = oldLeft - tab.offsetLeft;
      if (Math.abs(delta) < 0.5) return;
      tab.animate(
        [{ transform: `translateX(${delta}px)` }, { transform: "none" }],
        { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    });
    const next = new Map<string, number>();
    tabs.forEach((tab) => next.set(tab.dataset.tabId ?? "", tab.offsetLeft));
    positionsRef.current = next;
  }, [docs]);

  if (docs.length === 0) return null;

  return (
    <div className="flex h-9 shrink-0 select-none items-stretch border-b border-[var(--border)] bg-[var(--bg)] px-1">
      <div className="flex h-full shrink-0 items-center gap-1 px-1">
        <button
          title={canLocate ? "在目录树中定位此文件" : "当前文件不在打开的文件夹中"}
          onClick={locate}
          disabled={!canLocate}
          className={`flex h-7 w-7 items-center justify-center rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
            canLocate
              ? "cursor-pointer text-[var(--fg-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
              : "cursor-default text-[var(--fg-faint)] opacity-40"
          }`}
        >
          <LocateFixed size={16} />
        </button>
        <span className="h-4 w-px bg-[var(--border)]" />
      </div>
      <div ref={listRef} className="relative flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
        {docs.map((d) => (
          <div
            key={d.id}
            data-tab-id={d.id}
            data-active={d.id === activeDocId ? "true" : undefined}
            onAuxClick={(e) => {
              if (e.button === 1) requestClose(d.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, docId: d.id });
            }}
            className={`tab-enter group flex h-full shrink-0 items-center gap-1 pl-2.5 pr-1 text-[12px] transition-colors duration-150 ${
              d.id === activeDocId
                ? "font-medium text-[var(--fg-strong)]"
                : "text-[var(--fg-soft)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <button
              title={d.path ?? d.name}
              aria-current={d.id === activeDocId ? "page" : undefined}
              onClick={() => useStore.getState().setActiveDoc(d.id)}
              className="flex h-full min-w-0 cursor-pointer items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <FileText size={14} className={`shrink-0 ${d.id === activeDocId ? "text-[var(--accent)]" : "text-[var(--fg-faint)]"}`} />
              <span className="max-w-48 truncate">{d.name}</span>
              {d.dirty && <span title="未保存" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />}
            </button>
            <button
              className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                d.id === activeDocId
                  ? "text-[var(--fg-faint)]"
                  : "text-[var(--fg-faint)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              }`}
              onClick={() => requestClose(d.id)}
              title="关闭"
              aria-label={`关闭 ${d.name}`}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {indicator.on && (
          <span
            className="tab-indicator"
            style={{ width: indicator.w, transform: `translateX(${indicator.x}px)` }}
          />
        )}
      </div>
      {menu &&
        (() => {
          const doc = docs.find((d) => d.id === menu.docId);
          // 仅桌面模式且是磁盘文件时可打开系统文件管理器
          const canReveal = !!doc?.path && backend.isTauri;
          return (
            <div
              ref={menuRef}
              className="ctx-menu ui-pop fixed z-50 min-w-[180px] rounded-md border border-[var(--border)] bg-[var(--bg-soft)] py-1 shadow-lg"
              style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 140) }}
            >
              <button
                disabled={!canReveal}
                title={canReveal ? undefined : "仅桌面模式且为磁盘文件时可打开"}
                className={`${MENU_ITEM} ${canReveal ? "" : "cursor-not-allowed opacity-40"}`}
                onClick={() => {
                  setMenu(null);
                  if (!doc?.path) return;
                  backend.showInFolder(doc.path).catch((e: unknown) => alert(`打开失败：${e}`));
                }}
              >
                <FolderSearch size={15} /> 在文件管理器中显示
              </button>
            </div>
          );
        })()}
      {pendingClose && (
        <div
          className="modal-overlay fixed inset-0 z-[200] flex items-center justify-center bg-black/35 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) setPendingClose(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="未保存的更改"
            className="modal-card w-[420px] max-w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 shadow-[0_12px_36px_rgba(0,0,0,0.22)] outline-none"
          >
            <div className="mb-2 flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                <AlertTriangle size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-[var(--fg)]">未保存的更改</h2>
                <p className="mt-0.5 truncate text-[11.5px] text-[var(--fg-faint)]">
                  关闭前是否保存「{pendingClose.name}」的修改？
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setPendingClose(null)}
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
                不保存
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onSaveAndClose()}
                className="cursor-pointer rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
