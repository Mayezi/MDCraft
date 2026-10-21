// 设置配置的 JSON 备份格式：只包含用户偏好，不包含文档、最近文件等数据。

import { THEMES, type Settings } from "./types";

const BACKUP_VERSION = 1;
const SIDEBAR_TABS = ["files", "outline"] as const;

export interface SettingsBackup {
  app: "MDCraft";
  version: number;
  exportedAt: string;
  settings: Settings;
}

/** 提取需要持久化的设置字段（排除未来可能出现的会话级字段） */
export function settingsSnapshot(settings: Settings): Settings {
  return {
    theme: settings.theme,
    sourceMode: settings.sourceMode,
    sidebarVisible: settings.sidebarVisible,
    sidebarTab: settings.sidebarTab,
    sidebarWidth: settings.sidebarWidth,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    contentWidth: settings.contentWidth,
    showMinimap: settings.showMinimap,
    restoreFolder: settings.restoreFolder,
    showAllFiles: settings.showAllFiles,
  };
}

/** 生成可读的 JSON 配置文本 */
export function buildSettingsBackup(settings: Settings): string {
  const backup: SettingsBackup = {
    app: "MDCraft",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: settingsSnapshot(settings),
  };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

function clampNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function nullableNumber(
  value: unknown,
  min: number,
  max: number,
): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/** 解析导入的 JSON；兼容带 settings 外壳的备份和直接平铺的配置。
 *  只接受并覆盖已知字段，非法字段忽略；没有任何可识别字段时抛错。 */
export function parseSettingsBackup(raw: string): Partial<Settings> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("不是有效的 JSON 文件");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("配置格式不正确");
  }
  const root = parsed as Record<string, unknown>;
  const data =
    root.settings && typeof root.settings === "object" && !Array.isArray(root.settings)
      ? (root.settings as Record<string, unknown>)
      : root;

  const patch: Partial<Settings> = {};

  const theme = THEMES.find((item) => item.id === data.theme);
  if (theme) patch.theme = theme.id;

  if (typeof data.sourceMode === "boolean") patch.sourceMode = data.sourceMode;
  if (typeof data.sidebarVisible === "boolean") patch.sidebarVisible = data.sidebarVisible;
  if (typeof data.showMinimap === "boolean") patch.showMinimap = data.showMinimap;
  if (typeof data.restoreFolder === "boolean") patch.restoreFolder = data.restoreFolder;
  if (typeof data.showAllFiles === "boolean") patch.showAllFiles = data.showAllFiles;
  if (
    typeof data.sidebarTab === "string" &&
    (SIDEBAR_TABS as readonly string[]).includes(data.sidebarTab)
  ) {
    patch.sidebarTab = data.sidebarTab as Settings["sidebarTab"];
  }

  const sidebarWidth = clampNumber(data.sidebarWidth, 180, 480);
  if (sidebarWidth != null) patch.sidebarWidth = Math.round(sidebarWidth);

  const fontSize = nullableNumber(data.fontSize, 12, 24);
  if (fontSize !== undefined) patch.fontSize = fontSize;
  const lineHeight = nullableNumber(data.lineHeight, 1.3, 2.2);
  if (lineHeight !== undefined) patch.lineHeight = lineHeight;
  const contentWidth = nullableNumber(data.contentWidth, 640, 1400);
  if (contentWidth !== undefined) patch.contentWidth = contentWidth;

  if (Object.keys(patch).length === 0) {
    throw new Error("没有可识别的 MDCraft 设置项");
  }
  return patch;
}
