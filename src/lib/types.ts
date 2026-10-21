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

export type ThemeName = "github" | "newsprint" | "night" | "pixyll" | "whitey";

/** 主题元信息（菜单展示与暗色判定） */
export const THEMES: { id: ThemeName; label: string; dark: boolean }[] = [
  { id: "github", label: "GitHub", dark: false },
  { id: "newsprint", label: "Newsprint", dark: false },
  { id: "night", label: "Night", dark: true },
  { id: "pixyll", label: "Pixyll", dark: false },
  { id: "whitey", label: "Whitey", dark: false },
];

export interface Settings {
  theme: ThemeName;
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
