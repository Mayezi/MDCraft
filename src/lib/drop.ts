// 拖放导入：把文件/文件夹直接拖入窗口即打开。
// 桌面端：Tauri 窗口级拖放事件（onDragDropEvent）提供真实路径；
// 浏览器端：HTML5 DataTransfer 读文件内容，作为草稿打开。

import { useStore } from "../store";
import * as backend from "./backend";
import { openDocByPath } from "./docActions";
import { openFolder } from "./workspace";
import { notify, notifyError } from "./notify";

/** Markdown 扩展名判断（.md / .markdown / .mkd / .mdown） */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mkd|mdown)$/i.test(path);
}

/** 桌面端：处理拖入的系统路径列表（可混合文件夹与文件，逐个打开） */
export async function importDroppedPaths(paths: string[]): Promise<void> {
  const unsupported: string[] = [];
  for (const path of paths) {
    try {
      const kind = await backend.pathKind(path);
      if (kind === "dir") {
        await openFolder(path); // 文件夹 → 打开为工作空间
      } else if (kind === "file") {
        if (isMarkdownPath(path)) {
          await openDocByPath(path); // Markdown 文件 → 打开文档
        } else {
          unsupported.push(path);
        }
      }
    } catch {
      unsupported.push(path);
    }
  }
  if (unsupported.length) {
    const names = unsupported.map((p) => p.split(/[\\/]/).pop()).join("、");
    notify(`以下文件不是 Markdown，已忽略：${names}`);
  }
}

/** 浏览器端：处理拖入的 File 列表（读取文本作为草稿打开） */
export function importDroppedFiles(files: File[]): void {
  const md = files.filter((f) => isMarkdownPath(f.name));
  if (!md.length) {
    notify("仅支持 Markdown 文件（.md / .markdown）");
    return;
  }
  for (const file of md) {
    file
      .text()
      .then((text) => useStore.getState().openContent(file.name, null, text))
      .catch(() => notifyError(`读取 ${file.name} 失败`));
  }
}