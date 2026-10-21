// 本地图片：粘贴 / 拖拽落盘，以及渲染时把相对路径解析为资源协议 URL
//
// 存储约定（无工作区概念，锚点即「文档所在目录」）：
//   - 图片统一重命名（UUID）写入 <文档目录>/assets/，后端负责防冲突；
//   - markdown 里只记相对路径（assets/xxx.png）—— 可移植，不绑定任何工作区。
// 读取：资源协议（convertFileSrc）只认绝对路径，故渲染时用「当前文档目录」还原绝对路径。

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import * as backend from "../lib/backend";

/** 当前活动文档的磁盘路径（null = 未保存草稿）——渲染相对图片路径时作为解析基准 */
let activeDocPath: string | null = null;

export function setActiveDocPath(path: string | null) {
  activeDocPath = path;
}

/** 取路径的所在目录（去文件名与尾分隔符）；草稿/空路径返回 null */
export function docDirOf(path: string | null): string | null {
  if (!path || path.startsWith("mdcraft:doc:")) return null;
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : null;
}

/** 相对/绝对本地路径 → 绝对设备路径；非本地（http/data/blob/根路径）或无法解析时返回 null */
export function resolveLocalImage(src: string): string | null {
  const s = src.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // 有 scheme：http/data/blob/file/asset…
  if (s.startsWith("/") || s.startsWith("//")) return null; // WebView 根路径（如 /app-icon.png）
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\")) return s; // 已是绝对路径
  const dir = docDirOf(activeDocPath);
  if (!dir) return null; // 未保存草稿：无基准目录
  const sep = dir.includes("\\") ? "\\" : "/";
  const rel = s.replace(/^\.\//, "").split(/[\\/]/).join(sep);
  return dir + sep + rel;
}

/** 图片最终用于 `img.src` 的地址：本地路径走资源协议，其余（含网络图 / 无基准）原样返回 */
export function imageSrc(src: string): string {
  const abs = resolveLocalImage(src);
  return abs && backend.isTauri ? backend.assetSrc(abs) : src;
}

// ---------- 粘贴 / 拖拽落盘 ----------

/** 未保存文档时由宿主提供：触发另存为并返回新路径（取消返回 null） */
export type EnsureSaved = () => Promise<string | null>;

function imageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const direct = Array.from(dt.files).filter((f) => f.type.startsWith("image/"));
  if (direct.length) return direct;
  // 部分来源（如从网页拖图）只有 items 没有 files
  const out: File[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

function extFromMime(mime: string): string {
  const t = mime.toLowerCase();
  if (t === "image/jpeg") return "jpg";
  if (t === "image/svg+xml") return "svg";
  const m = /^image\/([a-z0-9]+)$/.exec(t);
  return m ? m[1] : "";
}

function extFromName(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "png";
}

/** 在 pos（缺省为当前光标）处插入块级内容，必要时补换行避免与正文粘连 */
function insertBlock(view: EditorView, text: string, pos?: number) {
  const doc = view.state.doc;
  const at = Math.min(Math.max(0, pos ?? view.state.selection.main.head), doc.length);
  const before = at > 0 ? doc.sliceString(at - 1, at) : "\n";
  const after = at < doc.length ? doc.sliceString(at, at + 1) : "\n";
  const pre = before === "\n" ? "" : "\n";
  const post = after === "\n" ? "" : "\n";
  const insert = pre + text + post;
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + pre.length + text.length },
    scrollIntoView: true,
  });
  view.focus();
}

async function saveImages(
  view: EditorView,
  files: File[],
  pos: number | undefined,
  ensureSaved: EnsureSaved,
) {
  try {
    // 伪路径（mdcraft:doc:）与 null 都视为未保存：必须以真实磁盘目录为基准
    let docPath = docDirOf(activeDocPath) ? activeDocPath : null;
    if (!docPath) {
      docPath = await ensureSaved();
      if (!docPath) return; // 用户取消另存为 → 放弃本次粘贴
      setActiveDocPath(docPath);
    }
    const links: string[] = [];
    for (const f of files) {
      const buf = new Uint8Array(await f.arrayBuffer());
      const ext = extFromMime(f.type) || extFromName(f.name);
      const rel = await backend.saveAsset(docPath, buf, ext);
      links.push(`![](${rel})`);
    }
    insertBlock(view, links.join("\n"), pos);
  } catch (e) {
    console.error("图片保存失败:", e);
    window.alert(`图片保存失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 粘贴 / 拖拽图片 → 落盘到文档同级 assets/ 并插入相对路径引用（仅桌面模式） */
export function imageAssets(ensureSaved: EnsureSaved): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (!backend.isTauri) return false;
      const files = imageFiles(event.clipboardData);
      if (!files.length) return false;
      event.preventDefault();
      void saveImages(view, files, undefined, ensureSaved);
      return true;
    },
    drop(event, view) {
      if (!backend.isTauri) return false;
      const files = imageFiles(event.dataTransfer);
      if (!files.length) return false;
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined;
      void saveImages(view, files, pos, ensureSaved);
      return true;
    },
  });
}
