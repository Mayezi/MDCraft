// 打开的文件夹生命周期：打开 / 关闭 / 持久化恢复（仅桌面模式持久化到 localStorage）
// 模型即为字面含义：打开文件夹 → 侧栏文件树显示该目录；没有"工作区"等额外概念
import * as backend from "./backend";
import { useStore } from "../store";

const FOLDER_KEY = "mdcraft:open-folder";

/** 打开文件夹：设根、建树、起监听、持久化 */
export async function openFolder(root: string): Promise<boolean> {
  useStore.getState().setFolderRoot(root);
  useStore.getState().setTree([], true);
  try {
    const tree = await backend.listDir(root);
    // 加载期间用户可能已切换/关闭文件夹 → 只提交仍然匹配的结果
    if (useStore.getState().folderRoot === root) {
      useStore.getState().setTree(tree, false);
    }
  } catch (e) {
    // 目录不可达（已删除/移动/U盘移除）→ 回退为未打开状态
    closeFolder();
    console.warn("openFolder failed:", e);
    return false;
  }
  if (backend.isTauri) {
    localStorage.setItem(FOLDER_KEY, root);
    useStore.getState().addRecentEntry(root, "folder");
  }
  void backend.watchDir(root);
  return true;
}

/** 关闭文件夹（清除状态与持久化记录；监听线程由下一次 watch 的代际计数自然退出） */
export function closeFolder(): void {
  useStore.getState().setFolderRoot(null);
  useStore.getState().setTree([], false);
  localStorage.removeItem(FOLDER_KEY);
}

/** 确保目录树工作区覆盖该文件：
 * 文件父目录不是当前根（或不在其子树内）时，把工作区切换到父目录。
 * tab 切换 / 打开文件 / 最近打开共用，语义一致；已在工作区内则不动（幂等）。
 * 浏览器模式无目录树，no-op。 */
export async function ensureWorkspaceFor(path: string): Promise<void> {
  if (!backend.isTauri) return;
  const parentEnd = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  const parent = parentEnd > 0 ? path.slice(0, parentEnd) : null;
  if (!parent) return;
  const currentRoot = useStore.getState().folderRoot;
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").toLowerCase();
  const inCurrentFolder = currentRoot
    ? normalize(parent) === normalize(currentRoot) ||
      normalize(parent).startsWith(normalize(currentRoot) + "\\") ||
      normalize(parent).startsWith(normalize(currentRoot) + "/")
    : false;
  if (!inCurrentFolder) await openFolder(parent);
}

/** 启动恢复上次打开的文件夹（仅桌面模式）；目录已不可达则静默丢弃。
 * 直接复用 openFolder：它内部会 listDir 建树并持久化，失败时自动 closeFolder 清理记录，
 * 避免这里再探活重复扫描一遍目录。 */
export async function restoreFolder(): Promise<void> {
  if (!backend.isTauri) return;
  const saved = localStorage.getItem(FOLDER_KEY);
  if (!saved) return;
  await openFolder(saved);
}
