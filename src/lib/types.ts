// 通用类型定义

export interface DocFile {
  id: string;
  name: string;
  /** null = 示例/未保存文档（浏览器模式存 localStorage） */
  path: string | null;
  /** 该文档的编辑器状态（切换标签时保存/恢复） */
  dirty: boolean;
  /** 正文内容（仅作为初始内容源，真实内容在 EditorState 中） */
  initialContent: string;
  lastSaved: number;
}

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children: FileNode[];
  /** Unix 毫秒时间戳；文件系统不支持时为空 */
  modifiedAt?: number | null;
  createdAt?: number | null;
}

export interface RecentEntry {
  path: string;
  kind: "file" | "folder";
}

export interface OutlineItem {
  level: number;
  text: string;
  from: number;
  to: number;
  line: number;
}

/** 主题模式：浅色 / 深色（跟随系统已移除，首次启动按系统偏好落成固定模式） */
export type ThemeMode = "light" | "dark";

/** 配色方案（复刻 dbx 的 13 套预设，色值见 styles/themes/palettes.css） */
export type ThemePalette =
  | "pearl"
  | "mist"
  | "graphite"
  | "cobalt"
  | "sage"
  | "amber"
  | "blush"
  | "vscode"
  | "idea"
  | "xcode"
  | "jetbrains"
  | "cursor"
  | "claude";

/** 主题模式元信息（菜单展示） */
export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
];

/** 配色方案元信息：color 为色块预览色（菜单里显示在名称前） */
export const THEME_PALETTES: { id: ThemePalette; label: string; color: string }[] = [
  { id: "pearl", label: "洁白", color: "#ffffff" },
  { id: "mist", label: "雾灰", color: "#e4eaf2" },
  { id: "graphite", label: "钛灰", color: "#d8dce4" },
  { id: "cobalt", label: "钴蓝", color: "#d8e6f7" },
  { id: "sage", label: "青绿", color: "#dbe9e2" },
  { id: "amber", label: "暖黄", color: "#f4e4b8" },
  { id: "blush", label: "樱粉", color: "#f4d9e6" },
  { id: "vscode", label: "VS Code", color: "#007acc" },
  { id: "idea", label: "IDEA", color: "#4b6eaf" },
  { id: "xcode", label: "Xcode", color: "#0a84ff" },
  { id: "jetbrains", label: "JetBrains", color: "#7b61ff" },
  { id: "cursor", label: "Cursor", color: "#6ba4ff" },
  { id: "claude", label: "Claude Code", color: "#c47a50" },
];

export interface Settings {
  /** 主题模式（浅色 / 深色） */
  themeMode: ThemeMode;
  /** 配色方案 */
  palette: ThemePalette;
  /** 全页源码模式（Ctrl+/，入口在左下角状态栏） */
  sourceMode: boolean;
  sidebarVisible: boolean;
  sidebarTab: "files" | "outline";
  /** 侧栏宽度（px，右缘拖拽调节；持久化） */
  sidebarWidth: number;
  /** 正文字号（px）；null = 跟随主题 */
  fontSize: number | null;
  /** 正文行高；null = 跟随主题 */
  lineHeight: number | null;
  /** 正文最大宽度（px）；null = 跟随主题 */
  contentWidth: number | null;
  /** 右侧文档缩略导航（minimap） */
  showMinimap: boolean;
  /** 启动时恢复上次打开的文件夹 */
  restoreFolder: boolean;
  /** 目录树显示所有文件（关闭则仅显示 Markdown 与资源文件） */
  showAllFiles: boolean;
}

/** 可持久化偏好的默认值（不含主题/侧栏等由各自入口管理的字段） */
export const DEFAULT_PREFERENCES: Pick<
  Settings,
  "fontSize" | "lineHeight" | "contentWidth" | "showMinimap" | "restoreFolder" | "showAllFiles"
> = {
  fontSize: null,
  lineHeight: null,
  contentWidth: null,
  showMinimap: true,
  restoreFolder: true,
  showAllFiles: false,
};
