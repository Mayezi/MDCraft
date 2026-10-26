// 文档动作：保存 / 导出（连通 store、editor 状态、后端）

import { useEffect, useState } from "react";
import type { EditorState } from "@codemirror/state";
import { editorStates, useStore } from "../store";
import { getView } from "../editor/viewref";
import * as backend from "./backend";
import { ensureWorkspaceFor } from "./workspace";
import { notify, notifyError } from "./notify";
import { fileNameOf, isTextEditable } from "./fileTypes";
import { showUnsupportedFile } from "./unsupportedFile";

/** 取当前活动文档的编辑器状态（并把视图状态写回状态池） */
export function currentDocState(): EditorState | null {
  const { activeDocId } = useStore.getState();
  const view = getView();
  if (view) {
    editorStates.set(activeDocId, view.state);
  }
  return editorStates.get(activeDocId) ?? null;
}

/** 获取指定 docId 的最新 Markdown 文本（若为当前活动文档则同步实时 EditorView） */
export function getDocContentById(docId: string): string {
  const store = useStore.getState();
  const doc = store.docs.find((d) => d.id === docId);
  if (!doc) return "";
  let state = editorStates.get(docId);
  if (docId === store.activeDocId) {
    const view = getView();
    if (view) {
      editorStates.set(docId, view.state);
      state = view.state;
    }
  }
  return state ? state.doc.toString() : doc.initialContent;
}

/** 保存指定文档；saveAs=true 或无路径时弹出保存位置。
 *  活动文档取实时 EditorView，非活动文档取状态池里的最近状态。 */
export async function saveDocById(docId: string, saveAs = false): Promise<boolean> {
  const store = useStore.getState();
  const doc = store.docs.find((d) => d.id === docId);
  if (!doc) return false;

  const content = getDocContentById(docId);
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

// ---------- 导出成功通知 ----------

/** 导出成功通知：桌面端附带「打开文件 / 打开所在目录」操作 */
export function notifyExportedFile(path: string | null, label: string) {
  if (!path) return;
  notify(`已导出 ${label}`, "success", [
    {
      label: "打开文件",
      onClick: () => void backend.openPath(path).catch((e: unknown) => notifyError(`打开失败：${e}`)),
    },
    {
      label: "打开所在目录",
      onClick: () => void backend.showInFolder(path).catch((e: unknown) => notifyError(`打开失败：${e}`)),
    },
  ]);
}

// ---------- HTML 导出 ----------

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
  if (backend.isTauri) {
    const out = await backend.pickExportPath(outName);
    if (!out) return null;
    await backend.writeFileText(out, html);
    return out;
  }
  backend.downloadBlob(outName, new Blob([html], { type: "text/html;charset=utf-8" }));
  return null;
}

/** 读取指定磁盘路径的最新 Markdown 内容（若该文件已在标签页打开，优先取编辑器实时缓冲） */
async function readLatestMarkdownByPath(path: string): Promise<string> {
  const openDoc = useStore.getState().docs.find((d) => d.path === path);
  if (openDoc) {
    return getDocContentById(openDoc.id);
  }
  return backend.readFileText(path);
}

/** 按磁盘路径导出该文件为同名 .html（文件树右键）；返回输出路径（取消/浏览器返回 null） */
export async function exportDocByPath(path: string): Promise<string | null> {
  const name = path.split(/[\\/]/).pop() ?? "untitled.md";
  const md = await readLatestMarkdownByPath(path);
  return exportHtml(md, name, path);
}

/** 导出草稿或已打开标签页文档为 .html；返回输出路径（浏览器返回 null） */
export async function exportDraftDoc(docId: string): Promise<string | null> {
  const doc = useStore.getState().docs.find((d) => d.id === docId);
  if (!doc) return null;
  const md = getDocContentById(docId);
  return exportHtml(md, doc.name, doc.path);
}

/** 导出当前活动文档为 HTML */
export async function exportActiveDocHtml(): Promise<void> {
  const { activeDocId, docs } = useStore.getState();
  const doc = docs.find((d) => d.id === activeDocId);
  if (!doc) return;
  try {
    const out = await exportDraftDoc(doc.id);
    notifyExportedFile(out, "HTML 文件");
  } catch (e) {
    notifyError(`导出失败：${e}`);
  }
}

// ---------- PDF 导出预览与设置弹窗状态 ----------

export interface PdfExportTarget {
  /** 文件名（如 README.md） */
  name: string;
  /** 磁盘路径（草稿为 null 或 mdcraft:doc:xxx） */
  path: string | null;
  /** Markdown 原文 */
  md: string;
}

let currentPdfTarget: PdfExportTarget | null = null;
const pdfTargetListeners = new Set<(target: PdfExportTarget | null) => void>();

function emitPdfTarget(target: PdfExportTarget | null) {
  currentPdfTarget = target;
  pdfTargetListeners.forEach((fn) => fn(target));
}

export function openPdfExportDialog(target: PdfExportTarget): void {
  emitPdfTarget(target);
}

export function closePdfExportDialog(): void {
  if (!currentPdfTarget) return;
  emitPdfTarget(null);
}

export function usePdfExportTarget(): PdfExportTarget | null {
  const [target, setTarget] = useState<PdfExportTarget | null>(currentPdfTarget);
  useEffect(() => {
    const fn = (next: PdfExportTarget | null) => setTarget(next);
    pdfTargetListeners.add(fn);
    return () => {
      pdfTargetListeners.delete(fn);
    };
  }, []);
  return target;
}

/** 按磁盘路径打开 PDF 导出预览与设置弹窗（文件树右键「导出 ▸ PDF…」） */
export async function openPdfExportByPath(path: string): Promise<void> {
  try {
    const name = path.split(/[\\/]/).pop() ?? "untitled.md";
    const md = await readLatestMarkdownByPath(path);
    openPdfExportDialog({ name, path, md });
  } catch (e) {
    notifyError(`读取文档失败：${e}`);
  }
}

/** 按文档 ID 打开 PDF 导出预览与设置弹窗（草稿右键 / 菜单栏导出） */
export function openPdfExportByDocId(docId: string): void {
  const doc = useStore.getState().docs.find((d) => d.id === docId);
  if (!doc) return;
  const md = getDocContentById(docId);
  openPdfExportDialog({ name: doc.name, path: doc.path, md });
}

/** 打开当前活动文档的 PDF 导出预览与设置弹窗 */
export function openPdfExportActiveDoc(): void {
  const { activeDocId, docs } = useStore.getState();
  if (!docs.length || !activeDocId) return;
  openPdfExportByDocId(activeDocId);
}

// ---------- 打开文件 ----------

export async function openDocByPath(path: string, name?: string) {
  const content = await backend.readFileText(path);
  // 文件不在当前工作区内 → 目录树切换到其所在文件夹（与 tab 切换同一语义）
  await ensureWorkspaceFor(path);
  const docName = name ?? path.split(/[\\/]/).pop() ?? "untitled.md";
  return useStore.getState().openContent(docName, path, content);
}

/**
 * 打开磁盘文件（最近打开 / 文件选择器等入口统一走这里）：
 * 文本类直接进编辑器；图片、程序、无扩展名等返回 false 并弹出
 * 「此文件不支持直接打开」，由用户自选打开方式。
 */
export async function openEditableFile(path: string, name?: string): Promise<boolean> {
  const fileName = name ?? fileNameOf(path);
  // 浏览器模式的草稿本来就是文本内容，直接打开即可
  if (!backend.isTauri) {
    await openDocByPath(path, fileName);
    return true;
  }
  if (!isTextEditable(fileName)) {
    showUnsupportedFile(path);
    return false;
  }
  await openDocByPath(path, fileName);
  return true;
}
