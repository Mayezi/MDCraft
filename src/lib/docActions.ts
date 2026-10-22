// 文档动作：保存 / 导出（连通 store、editor 状态、后端）

import type { EditorState } from "@codemirror/state";
import { editorStates, useStore } from "../store";
import { getView } from "../editor/viewref";
import * as backend from "./backend";
import { ensureWorkspaceFor } from "./workspace";
import { notifyError } from "./notify";

/** 取当前活动文档的编辑器状态（并把视图状态写回状态池） */
export function currentDocState(): EditorState | null {
  const { activeDocId } = useStore.getState();
  const view = getView();
  if (view) {
    editorStates.set(activeDocId, view.state);
  }
  return editorStates.get(activeDocId) ?? null;
}

/** 保存指定文档；saveAs=true 或无路径时弹出保存位置。
 *  活动文档取实时 EditorView，非活动文档取状态池里的最近状态。 */
export async function saveDocById(docId: string, saveAs = false): Promise<boolean> {
  const store = useStore.getState();
  const doc = store.docs.find((d) => d.id === docId);
  if (!doc) return false;

  let state = editorStates.get(docId);
  if (docId === store.activeDocId) {
    const view = getView();
    if (view) {
      editorStates.set(docId, view.state);
      state = view.state;
    }
  }
  const content = state ? state.doc.toString() : doc.initialContent;

  let path = doc.path;

  // 另存为，或当前还是没有磁盘路径的新草稿（Ctrl+N 后直接 Ctrl+S）：
  // 必须弹出保存对话框，否则会静默 return，看起来像保存没生效。
  if (saveAs || !path) {
    let picked: string | null;
    try {
      picked = await backend.pickSaveFile(doc.name);
    } catch (error) {
      notifyError(`打开保存对话框失败：${error}`);
      return false;
    }
    if (!picked) return false;
    const name = backend.isTauri
      ? picked.split(/[\\/]/).pop() ?? doc.name
      : picked.replace(/\.md$/, "") + ".md";
    path = backend.isTauri ? picked : `mdcraft:doc:${name}`;
    useStore.setState((s) => ({
      docs: s.docs.map((d) => (d.id === doc.id ? { ...d, name, path } : d)),
    }));
  }

  if (!path) return false;

  try {
    await backend.writeFileText(path, content);
  } catch (error) {
    notifyError(`保存失败：${error}`);
    return false;
  }
  if (backend.isTauri) useStore.getState().addRecentEntry(path, "file");
  useStore.getState().markSaved(doc.id);
  return true;
}

/** 保存当前活动文档 */
export async function saveActiveDoc(saveAs = false): Promise<boolean> {
  return saveDocById(useStore.getState().activeDocId, saveAs);
}

/** 依次保存所有脏文档；任一个取消/失败即停止并返回 false。 */
export async function saveAllDirty(): Promise<boolean> {
  const ids = useStore.getState().docs.filter((d) => d.dirty).map((d) => d.id);
  for (const id of ids) {
    if (!(await saveDocById(id))) return false;
  }
  return true;
}

// ---------- 导出（针对文件：入口在文件树右键菜单）----------

/**
 * HTML 导出公共实现：
 * 桌面模式弹出目录选择框，让用户自选保存位置，写入后返回输出路径；
 * 浏览器模式走下载兜底，返回 null（无路径可提示）。
 */
async function exportHtml(
  md: string,
  name: string,
  path: string | null,
): Promise<string | null> {
  // 导出依赖 marked + KaTeX，按需加载，避免拖慢启动首屏
  const { buildExportHtml } = await import("./export");
  const html = buildExportHtml(name.replace(/\.md$/i, ""), md);
  const outName = name.replace(/\.md$/i, "") + ".html";
  if (backend.isTauri && path && !path.startsWith("mdcraft:doc:")) {
    // 默认定位到源文件所在目录、同名 .html；用户可改目录与文件名
    const defaultDir = path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
    const sep = /^[A-Za-z]:$/.test(defaultDir) || defaultDir.includes("\\") ? "\\" : "/";
    const out = await backend.pickExportPath(defaultDir + sep + outName);
    if (!out) return null; // 用户取消
    await backend.writeFileText(out, html);
    return out;
  }
  backend.downloadBlob(outName, new Blob([html], { type: "text/html;charset=utf-8" }));
  return null;
}

/** 按磁盘路径导出该文件为同名 .html（文件树右键）；返回输出路径（取消/浏览器返回 null） */
export async function exportDocByPath(path: string): Promise<string | null> {
  const name = path.split(/[\\/]/).pop() ?? "untitled.md";
  const md = await backend.readFileText(path);
  return exportHtml(md, name, path);
}

/** 导出草稿（浏览器模式：内容取编辑器状态，下载 .html）；返回输出路径（浏览器返回 null） */
export async function exportDraftDoc(docId: string): Promise<string | null> {
  const doc = useStore.getState().docs.find((d) => d.id === docId);
  if (!doc) return null;
  const state = editorStates.get(docId);
  const md = state ? state.doc.toString() : doc.initialContent;
  return exportHtml(md, doc.name, doc.path);
}

export async function openDocByPath(path: string, name?: string) {
  const content = await backend.readFileText(path);
  // 文件不在当前工作区内 → 目录树切换到其所在文件夹（与 tab 切换同一语义）
  await ensureWorkspaceFor(path);
  const docName = name ?? path.split(/[\\/]/).pop() ?? "untitled.md";
  return useStore.getState().openContent(docName, path, content);
}
