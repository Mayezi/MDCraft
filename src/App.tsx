import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import Toolbar from "./ui/Toolbar";
import Sidebar from "./ui/Sidebar";
import Tabs from "./ui/Tabs";
import EmptyState from "./ui/EmptyState";
import EditorLoading from "./ui/EditorLoading";
import StatusBar from "./ui/StatusBar";
import DropOverlay from "./ui/DropOverlay";
import CloseConfirmDialog from "./ui/CloseConfirmDialog";
import { useStore } from "./store";
import * as backend from "./lib/backend";
import { importDroppedPaths, importDroppedFiles } from "./lib/drop";
import { ensureWorkspaceFor, restoreFolder } from "./lib/workspace";
import { checkForUpdatesOnStartup } from "./lib/updater";
import { dismissBootSplash } from "./lib/boot-splash";
import { getView } from "./editor/viewref";
import { saveActiveDoc, saveAllDirty } from "./lib/docActions";
import type { DocFile } from "./lib/types";

// 编辑器依赖 CodeMirror（大块头），拆成异步 chunk：首屏先出工具栏/侧栏，
// 没有文档时甚至完全不加载编辑器。
const EditorPane = lazy(() => import("./ui/EditorPane"));

export default function App() {
  const settings = useStore((s) => s.settings);
  const docCount = useStore((s) => s.docs.length);
  const theme = settings.theme;
  const sidebarVisible = settings.sidebarVisible;
  const sidebarWidth = settings.sidebarWidth;
  /** 活动文档的磁盘路径（草稿为 null）；tab 切换时驱动目录树跟随 */
  const activePath = useStore(
    (s) => s.docs.find((d) => d.id === s.activeDocId)?.path ?? null,
  );
  // 初值 = 左侧「最近打开」收起块实测高度（防首帧闪动），挂载后被 RecentFiles 实测覆盖
  const [recentHeight, setRecentHeight] = useState(39);
  const prevTheme = useRef(theme);
  /** 拖放导入：文件/文件夹拖入窗口时的全屏提示 */
  const [dragging, setDragging] = useState(false);
  /**
   * 主界面门控（参考 dbx StartupGate）：启动遮罩相当于 dbx 的 StartupLoading，
   * 覆盖到编辑器 chunk 预热完成才淡出，一次性露出完整主界面 —— 全程无"遮罩先消失、
   * 界面还没好"的卡顿空档。等待期间编辑器区域由 EditorLoading 承担明确 loading 提示。
   */
  const [bootReady, setBootReady] = useState(false);
  const bootedRef = useRef(false);
  /** 关闭确认：dirty 文档快照 + 保存状态 */
  const [closeDocs, setCloseDocs] = useState<DocFile[]>([]);
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const closePromptRef = useRef(false);
  const closingRef = useRef(false);

  // 启动门控：无条件预热 EditorPane 的 CodeMirror chunk（无论启动时有无文档，
  // 都提前下载缓存，之后点文件才能即时渲染、不出现 EditorLoading），
  // 所有资源就绪后才统一淡出启动遮罩。4 秒兜底：即使预热异常/过慢也不让遮罩卡死。
  useEffect(() => {
    if (bootedRef.current) return;
    let alive = true;
    const finish = () => {
      if (!alive) return;
      bootedRef.current = true;
      setBootReady(true);
      dismissBootSplash();
    };
    import("./ui/EditorPane")
      .then(finish)
      .catch(finish);
    const timer = window.setTimeout(finish, 4000);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  // 主题切换：支持 View Transition 时整页交叉淡变，否则直接切换
  useEffect(() => {
    const root = document.documentElement;
    const changed = prevTheme.current !== theme;
    prevTheme.current = theme;
    if (!changed) {
      root.dataset.theme = theme;
      return;
    }
    const doc = document as Document & {
      startViewTransition?: (update: () => void) => unknown;
    };
    if (
      typeof doc.startViewTransition === "function" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      doc.startViewTransition(() => {
        root.dataset.theme = theme;
      });
    } else {
      root.dataset.theme = theme;
    }
  }, [theme]);

  // 用户自定义排版：写内联 CSS 变量覆盖主题默认值；null 表示跟随主题
  useEffect(() => {
    const root = document.documentElement;
    const setVar = (name: string, value: number | null, unit = "") => {
      if (value == null) root.style.removeProperty(name);
      else root.style.setProperty(name, `${value}${unit}`);
    };
    setVar("--editor-fs", settings.fontSize, "px");
    setVar("--editor-lh", settings.lineHeight);
    setVar("--editor-maxw", settings.contentWidth, "px");
  }, [settings.fontSize, settings.lineHeight, settings.contentWidth]);

  // 桌面模式：恢复上次打开的文件夹（可在设置中关闭；浏览器模式为 no-op）
  useEffect(() => {
    if (useStore.getState().settings.restoreFolder) void restoreFolder();
  }, []);

  // 桌面正式构建：启动后静默检查更新（延迟几秒，不与启动流程抢资源）
  useEffect(() => {
    const t = setTimeout(() => void checkForUpdatesOnStartup(), 3000);
    return () => clearTimeout(t);
  }, []);

  // 桌面模式：切 tab / 开文档时，若当前文件不在已打开工作区内，
  // 目录树自动切换到该文件所在文件夹（仅在活动文档实际为磁盘文件时生效）
  useEffect(() => {
    if (!backend.isTauri || !activePath || activePath.startsWith("mdcraft:")) return;
    void ensureWorkspaceFor(activePath);
  }, [activePath]);

  // 拖放导入：桌面端用 Tauri 窗口级拖放事件（能拿到真实路径），浏览器端用 HTML5 DataTransfer
  useEffect(() => {
    if (backend.isTauri) {
      let unlisten: (() => void) | null = null;
      void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
        try {
          unlisten = await getCurrentWebview().onDragDropEvent((event) => {
            const payload = event.payload;
            if (payload.type === "enter" || payload.type === "over") {
              setDragging(true);
            } else if (payload.type === "leave") {
              setDragging(false);
            } else if (payload.type === "drop") {
              setDragging(false);
              void importDroppedPaths(payload.paths);
            }
          });
        } catch {
          /* 窗口拖放不可用时忽略（浏览器降级由下方 HTML5 分支承担） */
        }
      });
      return () => unlisten?.();
    }
    // 浏览器模式：HTML5 拖放（阻止默认导航，读文件内容作为草稿）
    const prevent = (e: DragEvent) => e.preventDefault();
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      // relatedTarget 为空 = 拖出窗口边界；子元素间移动不隐藏提示
      if (!e.relatedTarget) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) importDroppedFiles(files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", prevent);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // 全局快捷键：Ctrl+/ 源码模式、Ctrl+N 新建、Ctrl+S 保存、Ctrl+H 替换
  // 放在 App 而不是 EditorPane：空状态不挂载编辑器时这些快捷键也必须可用。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "/") {
        e.preventDefault();
        const s = useStore.getState().settings;
        useStore.getState().setSettings({ sourceMode: !s.sourceMode });
        return;
      }
      if (!e.shiftKey && key === "h") {
        if (!getView()) return;
        e.preventDefault();
        void import("./editor/search-panel").then(({ openReplacePanel }) => {
          const view = getView();
          if (view) openReplacePanel(view);
        });
        return;
      }
      if (!e.shiftKey && key === "s") {
        e.preventDefault();
        void saveActiveDoc();
        return;
      }
      if (!e.shiftKey && key === "n") {
        e.preventDefault();
        useStore.getState().newDoc();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 关闭窗口：先检查未保存文档，Tauri 下弹自定义确认框；浏览器降级为原生 beforeunload。
  useEffect(() => {
    if (!backend.isTauri) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      if (disposed) return;
      try {
        unlisten = await getCurrentWindow().onCloseRequested((event) => {
          if (closingRef.current) return;
          if (closePromptRef.current) {
            event.preventDefault();
            return;
          }
          const dirty = useStore.getState().docs.filter((d) => d.dirty);
          if (!dirty.length) return;
          event.preventDefault();
          closePromptRef.current = true;
          setCloseSaving(false);
          setCloseError(null);
          setCloseDocs(dirty);
        });
      } catch {
        /* 注册失败时退回系统默认关闭行为 */
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (backend.isTauri) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useStore.getState().docs.some((d) => d.dirty)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const finishClose = async () => {
    closingRef.current = true;
    closePromptRef.current = false;
    setCloseDocs([]);
    setCloseError(null);
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().destroy();
    } catch {
      // destroy 被拒绝时 close；closingRef 已置位，下一次 close 请求会直接放行
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
      } catch {
        /* 保持窗口打开，不做静默退出 */
      }
    }
  };

  const handleCloseCancel = () => {
    if (closeSaving) return;
    closePromptRef.current = false;
    setCloseDocs([]);
    setCloseError(null);
  };

  const handleCloseDiscard = () => {
    if (closeSaving) return;
    void finishClose();
  };

  const handleCloseSave = async () => {
    if (closeSaving) return;
    setCloseSaving(true);
    setCloseError(null);
    const ok = await saveAllDirty();
    if (!ok) {
      setCloseSaving(false);
      setCloseError("保存已取消或失败，应用尚未退出。");
      return;
    }
    await finishClose();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {/* 外壳裁切 + 宽度过渡：面板内部宽度固定，开合时不重排文本 */}
        <div
          className={`sidebar-shell ${sidebarVisible ? "is-open" : ""}`}
          style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
          aria-hidden={!sidebarVisible}
          inert={!sidebarVisible}
        >
          <Sidebar onRecentHeightChange={setRecentHeight} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Tabs />
          {docCount === 0 ? (
            <EmptyState />
          ) : bootReady ? (
            // chunk 已预热，Suspense 不会真正回退，编辑器即时渲染
            <Suspense fallback={<EditorLoading />}>
              <EditorPane />
            </Suspense>
          ) : (
            // 主界面就绪前的 loading 提示（配合全屏遮罩，明确"正在加载编辑器"）
            <EditorLoading />
          )}
          {/* 状态栏条带与左侧「最近打开」块（收起态）整块等高：分隔线同高、底边对齐，展开不影响编辑区高度 */}
          <div className="shrink-0 overflow-hidden" style={{ height: recentHeight }}>
            <StatusBar />
          </div>
        </div>
      </div>
      {dragging && <DropOverlay />}
      {closeDocs.length > 0 && (
        <CloseConfirmDialog
          docs={closeDocs}
          saving={closeSaving}
          error={closeError}
          onSave={() => void handleCloseSave()}
          onDiscard={handleCloseDiscard}
          onCancel={handleCloseCancel}
        />
      )}
    </div>
  );
}
