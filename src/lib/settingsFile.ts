// 桌面端用户配置文件（mdcraft.json）：JSON 文件为设置项的唯一权威来源；
// 浏览器模式没有文件系统权限，继续使用 localStorage（见 store.ts）。

import * as backend from "./backend";
import { parseSettingsBackup, settingsSnapshot } from "./settingsBackup";
import type { Settings } from "./types";

const CONFIG_VERSION = 1;
/** 滑块 / 侧栏拖拽会连续触发 setSettings，合并成一次落盘 */
const SAVE_DELAY_MS = 300;

let fileReady = false;
let saveTimer: number | undefined;
let pending: Settings | null = null;
/** 串行写入，避免旧内容后落盘覆盖新内容 */
let writeQueue: Promise<void> = Promise.resolve();

/** 配置文件文本：与「导出配置」同构，便于阅读和手工编辑 */
export function serializeSettingsFile(settings: Settings): string {
  return `${JSON.stringify(
    {
      app: "MDCraft",
      version: CONFIG_VERSION,
      settings: settingsSnapshot(settings),
    },
    null,
    2,
  )}\n`;
}

export type SettingsFileLoad =
  | { status: "loaded"; settings: Partial<Settings> }
  | { status: "missing" }
  | { status: "error"; error: unknown };

/**
 * 启动时读取配置文件：
 * - loaded：文件有效，优先于 localStorage 缓存；
 * - missing：首次运行 / 文件被删除，调用方写入当前设置完成迁移；
 * - error：读取或解析失败，沿用本地设置，不覆盖原文件。
 */
export async function loadSettingsFile(): Promise<SettingsFileLoad> {
  if (!backend.isTauri) {
    fileReady = true;
    return { status: "missing" };
  }
  try {
    const raw = await backend.readSettingsFile();
    if (raw == null) return { status: "missing" };
    return { status: "loaded", settings: parseSettingsBackup(raw) };
  } catch (error) {
    console.warn("[settings] 读取配置文件失败，沿用本地设置：", error);
    return { status: "error", error };
  } finally {
    fileReady = true;
  }
}

/** 设置变更后延迟落盘 */
export function scheduleSettingsFileSave(settings: Settings): void {
  if (!backend.isTauri || !fileReady) return;
  pending = settings;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!pending) return;
    const next = pending;
    pending = null;
    void saveSettingsFile(next);
  }, SAVE_DELAY_MS);
}

/** 立即写入（启动迁移用）；多次调用按顺序执行 */
export function saveSettingsFile(settings: Settings): Promise<void> {
  if (!backend.isTauri) return Promise.resolve();
  const content = serializeSettingsFile(settings);
  writeQueue = writeQueue.then(async () => {
    try {
      await backend.writeSettingsFile(content);
    } catch (error) {
      console.warn("[settings] 写入配置文件失败：", error);
    }
  });
  return writeQueue;
}
