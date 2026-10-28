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

/** 配色方案（参考 dbx 的 13 套预设，色值见 styles/themes/palettes.css） */
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

export type ImageStorageTarget = "local" | "imageHost";

export type ImageHostType = "aliyun" | "tencent" | "qiniu" | "gitee" | "custom";

export interface ImageHostConfig {
  /** 存储目标：local (本地 assets 目录) | imageHost (云端图床) */
  target: ImageStorageTarget;
  /** 图床类型：aliyun | tencent | qiniu | gitee | custom */
  type: ImageHostType;
  /** 图床上传失败时是否自动回退至本地存储保存（桌面模式生效） */
  fallbackToLocal: boolean;

  /** 阿里云 OSS 配置 */
  aliyun: {
    /** Bucket 名称 */
    bucket: string;
    /** 地域节点，如 oss-cn-hangzhou */
    region: string;
    /** AccessKey ID */
    accessKeyId: string;
    /** AccessKey Secret */
    accessKeySecret: string;
    /** 存储目录前缀，如 images/ */
    dir: string;
    /** 自定义绑定域名 / CDN 域名（选填） */
    customUrl: string;
  };

  /** 腾讯云 COS 配置 */
  tencent: {
    /** 存储桶名称（含 AppId，如 mybucket-1250000000） */
    bucket: string;
    /** 所属地域，如 ap-shanghai */
    region: string;
    /** SecretId */
    secretId: string;
    /** SecretKey */
    secretKey: string;
    /** 存储目录前缀，如 images/ */
    dir: string;
    /** 自定义加速域名（选填） */
    customUrl: string;
  };

  /** 七牛云 Kodo 配置 */
  qiniu: {
    /** 空间名称 Bucket */
    bucket: string;
    /** 上传区域地址，如 https://upload.qiniup.com */
    uploadUrl: string;
    /** AccessKey (AK) */
    accessKey: string;
    /** SecretKey (SK) */
    secretKey: string;
    /** 访问外链域名（必填，如 https://img.example.com） */
    domain: string;
    /** 存储目录前缀，如 images/ */
    dir: string;
  };

  /** Gitee 码云图床配置 */
  gitee: {
    /** 用户名/仓库名，如 owner/repo */
    repo: string;
    /** 分支名，默认 master */
    branch: string;
    /** 存储目录路径，如 images/ */
    dir: string;
    /** Gitee 私人令牌 Personal Access Token */
    token: string;
    /** 自定义访问域名或前缀（选填） */
    customUrl: string;
  };

  /** 自定义图床 API */
  custom: {
    /** 接收上传的 API 接口 URL (POST) */
    uploadUrl: string;
    /** 请求头 Header (JSON 或每行 Key: Value，如 Authorization: Bearer xxx) */
    headers: string;
    /** 表单文件字段名称，默认 file */
    paramName: string;
    /** 响应 JSON 中图片 URL 的键路径，默认 url（支持嵌套如 data.url） */
    jsonPath: string;
  };
}

export const DEFAULT_IMAGE_HOST_CONFIG: ImageHostConfig = {
  target: "local",
  type: "aliyun",
  fallbackToLocal: true,
  aliyun: {
    bucket: "",
    region: "oss-cn-hangzhou",
    accessKeyId: "",
    accessKeySecret: "",
    dir: "images/",
    customUrl: "",
  },
  tencent: {
    bucket: "",
    region: "ap-shanghai",
    secretId: "",
    secretKey: "",
    dir: "images/",
    customUrl: "",
  },
  qiniu: {
    bucket: "",
    uploadUrl: "https://upload.qiniup.com",
    accessKey: "",
    secretKey: "",
    domain: "",
    dir: "images/",
  },
  gitee: {
    repo: "",
    branch: "master",
    dir: "images/",
    token: "",
    customUrl: "",
  },
  custom: {
    uploadUrl: "",
    headers: "",
    paramName: "file",
    jsonPath: "url",
  },
};

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
  /** 启动时自动检查更新 */
  autoCheckUpdate: boolean;
  /** 图片存储与图床配置 */
  imageHost: ImageHostConfig;
}

/** 可持久化偏好的默认值（不含主题/侧栏等由各自入口管理的字段） */
export const DEFAULT_PREFERENCES: Pick<
  Settings,
  | "fontSize"
  | "lineHeight"
  | "contentWidth"
  | "showMinimap"
  | "restoreFolder"
  | "showAllFiles"
  | "autoCheckUpdate"
  | "imageHost"
> = {
  fontSize: null,
  lineHeight: null,
  contentWidth: null,
  showMinimap: true,
  restoreFolder: true,
  showAllFiles: false,
  autoCheckUpdate: true,
  imageHost: DEFAULT_IMAGE_HOST_CONFIG,
};
