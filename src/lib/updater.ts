// 客户端更新模块：支持静默检查、手动检查、进度展示与一键安装
//
// 1. 桌面正式模式走 Tauri 官方更新插件（@tauri-apps/plugin-updater），配合 minisign 签名与增量安装；
// 2. 网页/开发模式自动降级为查询 GitHub Releases API，呈现新版说明与下载入口；
// 3. 支持实时下载进度回调（百分比 / 已下载大小 / 总量）。

import * as backend from "./backend";
import { APP_VERSION } from "./version";
import { useState, useEffect } from "react";
import type { Update } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
  rawUpdate?: Update | null;
  downloadUrl?: string;
}

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; info: UpdateInfo }
  | {
      status: "up-to-date";
      currentVersion: string;
      notes?: string;
      date?: string;
      releaseUrl?: string;
    }
  | { status: "downloading"; progress: number; total?: number; downloaded: number }
  | { status: "ready-to-install" }
  | { status: "error"; message: string };

let currentState: UpdateState = { status: "idle" };
const listeners = new Set<(state: UpdateState) => void>();

function setState(next: UpdateState) {
  currentState = next;
  listeners.forEach((fn) => fn(next));
}

export function getUpdateState(): UpdateState {
  return currentState;
}

export function subscribeUpdate(fn: (state: UpdateState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React hook 订阅更新状态变化 */
export function useUpdateState(): UpdateState {
  const [state, setLocalState] = useState<UpdateState>(currentState);
  useEffect(() => {
    return subscribeUpdate(setLocalState);
  }, []);
  return state;
}

/** 是否跑在 vite dev server 上（开发构建不覆盖正在运行的二进制） */
function isDevServer(): boolean {
  if (typeof window === "undefined") return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(window.location.origin);
}

/** 比较 semver 版本号（remote > local 返回 true） */
function isNewerVersion(remote: string, local: string): boolean {
  const clean = (v: string) => v.replace(/^v/i, "").trim();
  const rParts = clean(remote).split(".").map((n) => parseInt(n, 10) || 0);
  const lParts = clean(local).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
    const r = rParts[i] ?? 0;
    const l = lParts[i] ?? 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

/**
 * 检查更新（支持静默模式与手动模式）
 * @param manual 是否由用户主动点击触发（手动模式下会给出明确的“已是最新”或失败提示）
 */
export async function checkUpdate(manual = false): Promise<UpdateState> {
  // 如果当前正在下载中，不重复触发检查
  if (currentState.status === "downloading") return currentState;

  setState({ status: "checking" });

  // 1. 桌面正式模式：使用 @tauri-apps/plugin-updater
  if (backend.isTauri && !isDevServer()) {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        let currentNotes: string | undefined;
        let releaseDate: string | undefined;
        let releaseUrl: string | undefined;
        if (manual) {
          try {
            const resp = await fetch("https://api.github.com/repos/Mayezi/MDCraft/releases/latest", {
              headers: { Accept: "application/vnd.github.v3+json" },
            });
            if (resp.ok) {
              const data = (await resp.json()) as { body?: string; published_at?: string; html_url?: string };
              currentNotes = data.body;
              releaseDate = data.published_at;
              releaseUrl = data.html_url;
            }
          } catch {
            // 静默忽略网络失败
          }
        }
        const next: UpdateState = {
          status: "up-to-date",
          currentVersion: APP_VERSION,
          notes: currentNotes,
          date: releaseDate,
          releaseUrl,
        };
        setState(next);
        return next;
      }

      const info: UpdateInfo = {
        version: update.version,
        currentVersion: update.currentVersion || APP_VERSION,
        body: update.body?.trim() || "无更新说明",
        date: update.date,
        rawUpdate: update,
        downloadUrl: `https://github.com/Mayezi/MDCraft/releases/tag/v${update.version}`,
      };
      const next: UpdateState = { status: "available", info };
      setState(next);
      return next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[MDCraft Updater] 桌面更新检查失败：", err);
      const next: UpdateState = manual
        ? { status: "error", message: `检查更新失败：${msg}` }
        : { status: "idle" };
      setState(next);
      return next;
    }
  }

  // 2. 网页端 / 开发环境：降级查询 GitHub Releases API
  try {
    const resp = await fetch("https://api.github.com/repos/Mayezi/MDCraft/releases/latest", {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!resp.ok) {
      if (resp.status === 404) {
        const next: UpdateState = { status: "up-to-date", currentVersion: APP_VERSION };
        setState(next);
        return next;
      }
      throw new Error(`GitHub API HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as {
      tag_name?: string;
      body?: string;
      published_at?: string;
      html_url?: string;
    };
    const latestVersion = (data.tag_name ?? "").replace(/^v/i, "");
    if (latestVersion && isNewerVersion(latestVersion, APP_VERSION)) {
      const info: UpdateInfo = {
        version: latestVersion,
        currentVersion: APP_VERSION,
        body: data.body || "见 GitHub Releases 页面说明",
        date: data.published_at,
        downloadUrl: data.html_url || "https://github.com/Mayezi/MDCraft/releases/latest",
      };
      const next: UpdateState = { status: "available", info };
      setState(next);
      return next;
    }

    const next: UpdateState = {
      status: "up-to-date",
      currentVersion: APP_VERSION,
      notes: data.body,
      date: data.published_at,
      releaseUrl: data.html_url,
    };
    setState(next);
    return next;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[MDCraft Updater] GitHub Releases 检查失败：", e);
    const next: UpdateState = manual
      ? { status: "error", message: `网络连接失败或暂无法连接 GitHub：${msg}` }
      : { status: "idle" };
    setState(next);
    return next;
  }
}

/** 启动时静默检查更新（保留原有签名给 App.tsx 调用） */
export async function checkForUpdatesOnStartup(): Promise<void> {
  await checkUpdate(false);
}

/** 下载并安装当前可用更新 */
export async function downloadAndInstallUpdate(
  onProgress?: (progress: number, downloaded: number, total?: number) => void,
): Promise<void> {
  if (currentState.status !== "available") return;
  const raw = currentState.info.rawUpdate;
  if (!raw) {
    // 浏览器或开发环境：直接在新标签页（桌面端则用系统浏览器）打开下载链接
    if (currentState.info.downloadUrl && typeof window !== "undefined") {
      void backend.openUrl(currentState.info.downloadUrl);
    }
    return;
  }

  let totalBytes = 0;
  let downloadedBytes = 0;
  setState({ status: "downloading", progress: 0, total: 0, downloaded: 0 });

  try {
    await raw.downloadAndInstall((event) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength ?? 0;
        setState({
          status: "downloading",
          progress: 0,
          total: totalBytes,
          downloaded: 0,
        });
        onProgress?.(0, 0, totalBytes);
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        const pct = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
        setState({
          status: "downloading",
          progress: pct,
          total: totalBytes,
          downloaded: downloadedBytes,
        });
        onProgress?.(pct, downloadedBytes, totalBytes);
      } else if (event.event === "Finished") {
        setState({ status: "ready-to-install" });
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[MDCraft Updater] 下载安装失败：", err);
    setState({ status: "error", message: `下载更新失败：${msg}` });
  }
}

/** 重置更新状态会话 */
export function resetUpdateState(): void {
  setState({ status: "idle" });
}
