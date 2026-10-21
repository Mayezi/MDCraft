// 后端抽象：Tauri（桌面）与浏览器双模式
// 桌面模式走 Rust 命令（mdcraft-core），浏览器模式用 localStorage / 内存数据

import type { FileNode } from "./types";
import { SAMPLE_DOCS } from "./samples";
// 静态导入：ImageWidget 渲染是同步的，需要同步可用的路径→URL 转换。
// 该模块顶层无副作用（仅 convertFileSrc 调用时才读 __TAURI_INTERNALS__），浏览器模式导入安全。
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---------- 用户配置文件 ----------

/** 读取 mdcraft.json 原文；文件不存在返回 null（浏览器模式无配置文件） */
export async function readSettingsFile(): Promise<string | null> {
  if (!isTauri) return null;
  return invoke<string | null>("read_settings");
}

/** 原子写入 mdcraft.json（浏览器模式 no-op） */
export async function writeSettingsFile(content: string): Promise<void> {
  if (!isTauri) return;
  await invoke("write_settings", { content });
}

/** mdcraft.json 绝对路径（浏览器模式返回 null） */
export async function settingsFilePath(): Promise<string | null> {
  if (!isTauri) return null;
  return invoke<string>("settings_path");
}

// ---------- 文件读取 ----------

/** 浏览器模式的草稿 key：兼容 path 已带 `mdcraft:doc:` 前缀的情况，避免重复拼接 */
function draftStorageKey(path: string): string {
  return path.startsWith("mdcraft:doc:") ? path : `mdcraft:doc:${path}`;
}

export async function readFileText(path: string): Promise<string> {
  if (isTauri) {
    const res = await invoke<{ content: string }>("open_file", { path });
    return res.content;
  }
  return localStorage.getItem(draftStorageKey(path)) ?? "";
}

export async function writeFileText(path: string, content: string): Promise<void> {
  if (isTauri) {
    // 数据安全护栏：空（纯空白）内容不写磁盘上的非空文件——
    // 缓冲被误清空 / 读取失败得到的空文档一旦保存，就会把原文覆盖成 0 字节；
    // 宁可这次写盘失败（抛错，由调用方静默），也不丢盘上数据。真的要清空文件，
    // 先在编辑器里删光内容是不够的（仍遭拦截）；此类需求另行显式操作
    if (!content.trim()) {
      let existing = "";
      try {
        existing = await readFileText(path);
      } catch {
        existing = "";
      }
      if (existing.trim()) {
        throw new Error(`空文档拒绝覆盖非空文件：${path}`);
      }
    }
    await invoke("write_file", { path, content });
    return;
  }
  localStorage.setItem(draftStorageKey(path), content);
}

// ---------- 目录树 ----------

export async function listDir(root: string): Promise<FileNode[]> {
  if (isTauri) {
    return invoke<FileNode[]>("list_dir", { root });
  }
  // 浏览器模式：示例文档作为虚拟树
  return SAMPLE_DOCS.map((d) => ({
    name: d.name,
    path: d.name,
    isDir: false,
    children: [],
  }));
}

// ---------- 文件选择对话框 ----------

export async function pickOpenFile(): Promise<{ path: string; name: string } | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] }],
    });
    if (typeof res === "string") {
      const name = res.split(/[\\/]/).pop() ?? "untitled.md";
      return { path: res, name };
    }
    return null;
  }
  // 浏览器：<input type="file">
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.mdx,.txt,text/markdown";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        const path = "mdcraft:doc:" + f.name;
        localStorage.setItem(path, String(reader.result ?? ""));
        resolve({ path, name: f.name });
      };
      reader.readAsText(f);
    };
    input.click();
  });
}

export async function pickOpenFolder(defaultPath?: string): Promise<string | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ directory: true, multiple: false, defaultPath });
    return typeof res === "string" ? res : null;
  }
  alert("浏览器模式不支持打开文件夹，请使用桌面版（pnpm tauri dev）");
  return null;
}

export async function pickSaveFile(defaultName: string): Promise<string | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const res = await save({
      defaultPath: defaultName,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    return typeof res === "string" ? res : null;
  }
  return defaultName; // 浏览器走 localStorage
}

/** 导出文件保存对话框：可同时自定义文件名与所在目录（仅桌面模式），取消返回 null */
export async function pickExportPath(defaultPath: string): Promise<string | null> {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const res = await save({
    defaultPath,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  return typeof res === "string" ? res : null;
}

/** 保存一个 JSON 配置文件（桌面走保存对话框 + 写盘，浏览器下载） */
export async function saveJsonFile(defaultName: string, content: string): Promise<boolean> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "JSON 配置", extensions: ["json"] }],
    });
    if (typeof path !== "string") return false;
    await writeFileText(path, content);
    return true;
  }
  downloadBlob(defaultName, new Blob([content], { type: "application/json;charset=utf-8" }));
  return true;
}

/** 选择并读取一个 JSON 配置文件（桌面走打开对话框，浏览器 file input） */
export async function pickJsonFile(): Promise<{ name: string; content: string } | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      multiple: false,
      filters: [{ name: "JSON 配置", extensions: ["json"] }],
    });
    if (typeof path !== "string") return null;
    const content = await readFileText(path);
    return { name: path.split(/[\\/]/).pop() ?? "mdcraft-settings.json", content };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    const done = (value: { name: string; content: string } | null) => {
      input.remove();
      resolve(value);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        done(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => done({ name: file.name, content: String(reader.result ?? "") });
      reader.onerror = () => done(null);
      reader.readAsText(file);
    };
    input.addEventListener("cancel", () => done(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

// ---------- 文件监听（打开的文件夹变更） ----------

export interface FsChangeEvent {
  kind: string;
  path: string;
}

/** 订阅文件系统变更：回调收到批量去抖后的事件（仅桌面模式） */
export function onFsEvent(cb: (events: FsChangeEvent[]) => void): () => void {
  if (!isTauri) return () => {};
  let unlisten: (() => void) | null = null;
  let disposed = false;
  import("@tauri-apps/api/event").then(({ listen }) => {
    if (disposed) return;
    listen<{ events: FsChangeEvent[] }>("fs-batch", (e) => cb(e.payload?.events ?? [])).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export async function watchDir(root: string): Promise<void> {
  if (!isTauri) return;
  await invoke("watch_dir", { root }).catch(() => {});
}

// ---------- 文件管理（新建 / 重命名 / 删除；仅桌面模式） ----------

export async function createFile(path: string): Promise<void> {
  await invoke("create_file", { path });
}

export async function createDir(path: string): Promise<void> {
  await invoke("create_dir", { path });
}

export async function renamePath(from: string, to: string): Promise<void> {
  await invoke("rename_path", { from, to });
}

/** 删除到系统回收站（可恢复） */
export async function trashPath(path: string): Promise<void> {
  await invoke("trash_path", { path });
}

/** 在系统文件管理器中显示（文件选中自身，目录于父目录中选中） */
export async function showInFolder(path: string): Promise<void> {
  await invoke("show_in_folder", { path });
}

/** 用系统默认程序打开文件/目录（打开导出结果等） */
export async function openPath(path: string): Promise<void> {
  if (!isTauri) return;
  await invoke("open_path", { path });
}

/** 打开外部链接：桌面端交系统默认浏览器（WebView 内 window.open 无效），浏览器模式新标签页 */
export async function openUrl(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await invoke("open_url", { url });
  } catch (error) {
    // 非 http/https（如 mailto:）或系统处理器缺失：不打断编辑，仅留日志
    console.warn("[MDCraft] 打开链接失败：", url, error);
  }
}

/** 弹出系统「打开方式」选择（仅桌面模式；其它平台退化为默认程序打开） */
export async function openWith(path: string): Promise<void> {
  if (!isTauri) return;
  await invoke("open_with", { path });
}

/** 判断路径是文件夹还是文件（拖放导入用）；不存在返回 null */
export async function pathKind(path: string): Promise<"dir" | "file" | null> {
  if (!isTauri) return null;
  try {
    return await invoke<"dir" | "file" | null>("path_kind", { path });
  } catch {
    return null;
  }
}

// ---------- 本地资源（图片） ----------

/** 保存图片到文档同级 assets/，返回 markdown 可用的相对路径（如 assets/xxx.png） */
export async function saveAsset(
  docPath: string,
  data: Uint8Array,
  ext: string,
): Promise<string> {
  return invoke<string>("save_asset", { path: docPath, data: Array.from(data), ext });
}

/** 绝对设备路径 → WebView 可加载的资源 URL（资源协议，仅桌面模式有意义） */
export function assetSrc(absPath: string): string {
  return convertFileSrc(absPath);
}

// ---------- 下载（浏览器导出兜底） ----------

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
