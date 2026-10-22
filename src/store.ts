import { create } from "zustand";
import {
  DEFAULT_PREFERENCES,
  type DocFile,
  type FileNode,
  type OutlineItem,
  type Settings,
  type ThemeMode,
  type ThemePalette,
  type RecentEntry,
} from "./lib/types";
import {
  THEME_MODE_KEY,
  THEME_PALETTE_KEY,
  normalizeThemeMode,
  normalizeThemePalette,
} from "./lib/theme";
import { scheduleSettingsFileSave } from "./lib/settingsFile";
import type { EditorState } from "@codemirror/state";

/** 编辑器状态池：docId -> EditorState（非序列化对象单独存放，避免 React 深拷贝） */
export const editorStates = new Map<string, EditorState>();

function makeId() {
  return "d" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

/** 在目录树中按 path 就地替换某个目录节点的子层（其余节点引用保持不变） */
function updateDirChildren(nodes: FileNode[], dirPath: string, children: FileNode[]): FileNode[] {
  return nodes.map((n) => {
    if (n.path === dirPath) return { ...n, children };
    if (n.isDir && n.children.length) {
      return { ...n, children: updateDirChildren(n.children, dirPath, children) };
    }
    return n;
  });
}

interface AppStore {
  docs: DocFile[];
  activeDocId: string;
  settings: Settings;
  folderRoot: string | null;
  tree: FileNode[];
  treeLoading: boolean;
  recentEntries: RecentEntry[];
  addRecentEntry: (path: string, kind: RecentEntry["kind"]) => void;
  outline: OutlineItem[];
  /** 当前光标所在的标题链（H1→…→当前层，面包屑/大纲高亮共用） */
  headingChain: OutlineItem[];
  status: { line: number; col: number; words: number; chars: number };
  /** 在目录树中定位文件的请求（面包屑「定位」按钮发起；ts 保证同文件重复触发） */
  locateRequest: { path: string; ts: number } | null;

  // 文档操作
  newDoc: () => void;
  openContent: (name: string, path: string | null, content: string) => string;
  closeDoc: (id: string) => void;
  setActiveDoc: (id: string) => void;
  markDirty: (id: string, dirty: boolean) => void;
  markSaved: (id: string) => void;
  updateStatus: (s: Partial<AppStore["status"]>) => void;
  setOutline: (items: OutlineItem[]) => void;
  setHeadingChain: (items: OutlineItem[]) => void;

  // 设置
  setSettings: (patch: Partial<Settings>) => void;

  // 打开的文件夹（右侧文件树的根）
  setFolderRoot: (root: string | null) => void;
  setTree: (tree: FileNode[], loading?: boolean) => void;
  /** 惰性树：按路径就地替换某个目录节点的子层（目录展开时按需加载） */
  setDirChildren: (dirPath: string, children: FileNode[]) => void;

  // 目录树定位
  setLocateRequest: (path: string | null) => void;
}

/** 主题模式：浅色 / 深色 / 跟随系统；旧版 mdcraft:theme（night 等）在此迁移 */
const savedThemeMode = ((): ThemeMode => {
  const raw = localStorage.getItem(THEME_MODE_KEY);
  if (raw) return normalizeThemeMode(raw);
  const legacy = localStorage.getItem("mdcraft:theme");
  if (!legacy) return "system";
  localStorage.removeItem("mdcraft:theme");
  return legacy === "dark" || legacy === "night" ? "dark" : "light";
})();

/** 配色方案（复刻 dbx 的 13 套预设） */
const savedPalette = ((): ThemePalette =>
  normalizeThemePalette(localStorage.getItem(THEME_PALETTE_KEY)))();

const savedRecentEntries = ((): RecentEntry[] => {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem("mdcraft:recent") ?? "[]");
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry): entry is RecentEntry =>
      !!entry && typeof entry.path === "string" && (entry.kind === "file" || entry.kind === "folder"),
    ).slice(0, 30);
  } catch {
    return [];
  }
})();

/** 侧栏宽度持久化：clamp 180~480，非法值回默认 256 */
const savedSidebarWidth = ((): number => {
  const raw = Number(localStorage.getItem("mdcraft:sidebar-width"));
  if (Number.isFinite(raw) && raw >= 180 && raw <= 480) return Math.round(raw);
  return 256;
})();

/** 可持久化偏好：mdcraft:settings（旧版本无此键 → 默认值） */
const savedPreferences = (() => {
  const out = { ...DEFAULT_PREFERENCES };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem("mdcraft:settings") ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    const obj = raw as Record<string, unknown>;
    const num = (value: unknown, min: number, max: number): number | null => {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      return Math.min(max, Math.max(min, value));
    };
    const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
    out.fontSize = num(obj.fontSize, 12, 24);
    out.lineHeight = num(obj.lineHeight, 1.3, 2.2);
    out.contentWidth = num(obj.contentWidth, 640, 1400);
    out.showMinimap = bool(obj.showMinimap, DEFAULT_PREFERENCES.showMinimap);
    out.restoreFolder = bool(obj.restoreFolder, DEFAULT_PREFERENCES.restoreFolder);
    out.showAllFiles = bool(obj.showAllFiles, DEFAULT_PREFERENCES.showAllFiles);
  } catch {
    /* 坏数据静默回落默认值 */
  }
  return out;
})();

/** 偏好字段集合：只要改动其中之一就整包写入，避免逐键散落 */
const PERSISTED_KEYS = [
  "fontSize",
  "lineHeight",
  "contentWidth",
  "showMinimap",
  "restoreFolder",
  "showAllFiles",
] as const satisfies readonly (keyof Settings)[];

function persistPreferences(settings: Settings) {
  const prefs: typeof DEFAULT_PREFERENCES = {
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    contentWidth: settings.contentWidth,
    showMinimap: settings.showMinimap,
    restoreFolder: settings.restoreFolder,
    showAllFiles: settings.showAllFiles,
  };
  try {
    localStorage.setItem("mdcraft:settings", JSON.stringify(prefs));
  } catch {
    /* 存储失败不影响本次会话 */
  }
}
// 启动时恢复持久化的浏览器文档
function bootDocs(): DocFile[] {
  const drafts: DocFile[] = [];
  const raw = localStorage.getItem("mdcraft:drafts");
  if (raw) {
    try {
      const names = JSON.parse(raw) as string[];
      for (const name of names) {
        const content = localStorage.getItem("mdcraft:doc:" + name);
        if (content !== null) drafts.push(mkDoc(name, name, content, false));
      }
    } catch {
      /* ignore */
    }
  }
  if (drafts.length === 0) {
    return [];
  }
  return drafts;
}

function mkDoc(name: string, path: string | null, content: string, dirty: boolean): DocFile {
  return {
    id: makeId(),
    name,
    path,
    initialContent: content,
    dirty,
    lastSaved: Date.now(),
  };
}

function persistDraftList(docs: DocFile[], activeId: string) {
  // 浏览器模式下持久化「文档名列表」与激活项（内容在保存时写入）
  const drafts = docs.filter((d) => d.path === null || d.path.startsWith("mdcraft:doc:"));
  localStorage.setItem("mdcraft:drafts", JSON.stringify(drafts.map((d) => d.name)));
  localStorage.setItem("mdcraft:drafts-active", activeId);
}

export const useStore = create<AppStore>((set, get) => {
  const boot = bootDocs();
  const activeId =
    localStorage.getItem("mdcraft:drafts-active") &&
    boot.some((d) => d.id === localStorage.getItem("mdcraft:drafts-active"))
      ? localStorage.getItem("mdcraft:drafts-active")!
      : (boot[0]?.id ?? "");

  return {
    docs: boot,
    activeDocId: activeId,
    settings: {
      themeMode: savedThemeMode,
      palette: savedPalette,
      sourceMode: false,
      sidebarVisible: true,
      sidebarTab: "files",
      sidebarWidth: savedSidebarWidth,
      ...savedPreferences,
    },
    folderRoot: null,
    tree: [],
    treeLoading: false,
    recentEntries: savedRecentEntries,
    addRecentEntry: (path, kind) => {
      const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      const recentEntries = [
        { path, kind },
        ...get().recentEntries.filter((entry) => entry.kind !== kind || normalize(entry.path) !== normalize(path)),
      ].slice(0, 10);
      localStorage.setItem("mdcraft:recent", JSON.stringify(recentEntries));
      set({ recentEntries });
    },
    outline: [],
    headingChain: [],
    status: { line: 1, col: 1, words: 0, chars: 0 },
    locateRequest: null,

    newDoc: () => {
      const existing = get().docs;
      let n = 1;
      let name = `未命名-${n}.md`;
      while (existing.some((d) => d.name === name)) name = `未命名-${++n}.md`;
      const doc = mkDoc(name, null, "", false);
      editorStates.delete("");
      set({ docs: [...existing, doc], activeDocId: doc.id });
      persistDraftList([...existing, doc], doc.id);
    },

    openContent: (name, path, content) => {
      if (path && /^[A-Za-z]:[\\/]|^\//.test(path)) get().addRecentEntry(path, "file");
      const existing = get().docs;
      const samePath = path ? existing.find((d) => d.path === path) : existing.find((d) => d.name === name);
      if (samePath) {
        set({ activeDocId: samePath.id });
        return samePath.id;
      }
      const doc = mkDoc(name, path, content, false);
      set({ docs: [...existing, doc], activeDocId: doc.id });
      persistDraftList([...existing, doc], doc.id);
      return doc.id;
    },

    closeDoc: (id) => {
      const { docs, activeDocId } = get();
      const idx = docs.findIndex((d) => d.id === id);
      if (idx === -1) return;
      const next = docs.filter((d) => d.id !== id);
      editorStates.delete(id);
      let nextActive = activeDocId;
      if (activeDocId === id) {
        nextActive = next[Math.min(idx, next.length - 1)]?.id ?? "";
      }
      set({ docs: next, activeDocId: nextActive });
      if (next.length === 0) set({ outline: [], headingChain: [] });
      persistDraftList(next, nextActive);
    },

    setActiveDoc: (id) => {
      // 大纲/标题链保留到 EditorPane 重算完成，避免切换瞬间闪一帧「没有标题」
      set({ activeDocId: id });
      persistDraftList(get().docs, id);
    },

    markDirty: (id, dirty) =>
      set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, dirty } : d)) })),

    markSaved: (id) =>
      set((s) => ({
        docs: s.docs.map((d) => (d.id === id ? { ...d, dirty: false, lastSaved: Date.now() } : d)),
      })),

    updateStatus: (st) => set((s) => ({ status: { ...s.status, ...st } })),

    setOutline: (items) => set({ outline: items }),

    setHeadingChain: (items) => set({ headingChain: items }),

    setSettings: (patch) =>
      set((s) => {
        const settings = { ...s.settings, ...patch };
        if (patch.themeMode !== undefined)
          localStorage.setItem(THEME_MODE_KEY, patch.themeMode);
        if (patch.palette !== undefined)
          localStorage.setItem(THEME_PALETTE_KEY, patch.palette);
        if (patch.sourceMode !== undefined)
          localStorage.setItem("mdcraft:source-mode", patch.sourceMode ? "1" : "0");
        if (PERSISTED_KEYS.some((key) => patch[key] !== undefined)) persistPreferences(settings);
        scheduleSettingsFileSave(settings);
        return { settings };
      }),

    setFolderRoot: (root) => set({ folderRoot: root }),
    setTree: (tree, loading = false) => set({ tree, treeLoading: loading }),
    setDirChildren: (dirPath, children) =>
      set((s) => ({ tree: updateDirChildren(s.tree, dirPath, children) })),

    setLocateRequest: (path) =>
      set(path ? { locateRequest: { path, ts: Date.now() } } : { locateRequest: null }),
  };
});
