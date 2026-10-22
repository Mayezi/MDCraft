// 文件树：打开的文件夹（Tauri 后端目录）；浏览器模式显示草稿文档列表
// 交互：单击打开文件；活动文档高亮；右键菜单（新建/重命名/导出（二级：HTML 可用，PDF 等预留）/打开文件位置/删除回收站）；
// 编辑器不认的文件（exe / pdf / 无后缀…）单击拉起系统「选择应用」框，由用户自己选程序打开
// 无文件夹时提供「打开文件夹」按钮；顶部根目录栏：刷新 + 关闭文件夹

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, FilePlus2, FolderPlus, FileText, Folder, Pencil, Trash2, RefreshCw, EllipsisVertical, Check, FolderOpen, Download, FolderSearch, ArrowDownAZ, ArrowUpAZ, Files, ClockArrowDown, ClockArrowUp, CalendarArrowDown, CalendarArrowUp, FolderUp, List, Plus, FileImage, FileCode, FileJson, FileVideo, FileAudio, FileArchive, FileType, type LucideIcon } from "lucide-react";
import { useStore } from "../store";
import * as backend from "../lib/backend";
import { openDocByPath, exportDocByPath, exportDraftDoc } from "../lib/docActions";
import { isTextEditable } from "../lib/fileTypes";
import { showUnsupportedFile } from "../lib/unsupportedFile";
import { openFolder } from "../lib/workspace";
import { notifyError } from "../lib/notify";
import RecentFiles from "./RecentFiles";
import ExportResultDialog from "./ExportResultDialog";
import ConfirmDialog from "./ConfirmDialog";
import type { FileNode } from "../lib/types";

/** 路径拼接（平台分隔符自适应：Windows 反斜杠 / 其它正斜杠） */
function joinPath(dir: string, name: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  const sepChar = /^[A-Za-z]:$/.test(trimmed) || dir.includes("\\") ? "\\" : "/";
  return `${trimmed}${sepChar}${name}`;
}

/** 目录树「仅显示 Markdown 与资源」时放行的扩展名（与 md-core 历史口径一致） */
const MARKDOWN_EXT = ["md", "markdown", "mdx"];
const ASSET_EXT = ["png", "jpg", "jpeg", "gif", "svg", "webp", "pdf"];

/** 文件名是否为 Markdown 或资源文件（仅显示模式下的放行判定） */
function isVisibleFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return MARKDOWN_EXT.includes(ext) || ASSET_EXT.includes(ext);
}

/** 按扩展名返回对应文件图标（未匹配用通用文件图标） */
function fileIcon(name: string): LucideIcon {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const inList = (list: string[]) => list.includes(ext);
  if (inList(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"])) return FileImage;
  if (inList(["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "mpg"])) return FileVideo;
  if (inList(["mp3", "wav", "flac", "ogg", "m4a", "aac", "wma", "opus"])) return FileAudio;
  if (inList(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"])) return FileArchive;
  if (inList(["json", "jsonc"])) return FileJson;
  if (inList(["js", "ts", "jsx", "tsx", "cjs", "mjs", "html", "htm", "xml", "css", "scss", "less", "py", "rs", "go", "java", "c", "h", "cpp", "hpp", "cs", "rb", "php", "sh", "bash", "ps1", "bat", "cmd", "sql", "vue", "svelte"])) return FileCode;
  if (inList(["pdf"])) return FileType;
  return FileText;
}

/** 按设置过滤整棵树：showAllFiles 时原样返回，否则只保留目录与 md/资源文件 */
function filterTree(nodes: FileNode[], showAll: boolean): FileNode[] {
  if (showAll) return nodes;
  return nodes.filter((n) => n.isDir || isVisibleFile(n.name)).map((n) => (n.isDir ? { ...n, children: filterTree(n.children, showAll) } : n));
}

type SortOrder = "default" | "name-asc" | "name-desc" | "type" | "modified-desc" | "modified-asc" | "created-desc" | "created-asc";
const SORT_OPTIONS: { value: SortOrder; label: string; icon: LucideIcon }[] = [
  { value: "default", label: "默认排序", icon: List },
  { value: "name-asc", label: "名称", icon: ArrowDownAZ },
  { value: "name-desc", label: "名称", icon: ArrowUpAZ },
  { value: "type", label: "按文件类型", icon: Files },
  { value: "modified-desc", label: "修改时间", icon: ClockArrowDown },
  { value: "modified-asc", label: "修改时间", icon: ClockArrowUp },
  { value: "created-desc", label: "创建时间", icon: CalendarArrowDown },
  { value: "created-asc", label: "创建时间", icon: CalendarArrowUp },
];

const SORT_GROUPS: { asc: SortOrder; desc: SortOrder; label: string }[] = [
  { asc: "name-asc", desc: "name-desc", label: "名称" },
  { asc: "type", desc: "type", label: "文件类型" },
  { asc: "modified-asc", desc: "modified-desc", label: "修改时间" },
  { asc: "created-asc", desc: "created-desc", label: "创建时间" },
];

function sortTree(nodes: FileNode[], order: SortOrder, foldersFirst: boolean): FileNode[] {
  const compareName = (a: string, b: string) => a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
  return nodes.map((node) => ({ ...node, children: sortTree(node.children, order, foldersFirst) })).sort((a, b) => {
    const naturalDefault = order === "default";
    if ((foldersFirst || naturalDefault) && a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (order.startsWith("modified-") || order.startsWith("created-")) {
      const key = order.startsWith("modified-") ? "modifiedAt" : "createdAt";
      const left = a[key];
      const right = b[key];
      if (left == null && right != null) return 1;
      if (left != null && right == null) return -1;
      if (left != null && right != null && left !== right) {
        return (left - right) * (order.endsWith("desc") ? -1 : 1);
      }
    }
    if (order === "type") {
      const ext = (node: FileNode) => node.isDir ? "" : node.name.split(".").slice(1).pop() ?? "";
      const byType = compareName(ext(a), ext(b));
      if (byType) return byType;
    }
    return compareName(a.name, b.name) * (order === "name-desc" ? -1 : 1);
  });
}

// ---------- 内联输入（新建/重命名共用） ----------

function InlineInput({
  initial,
  depth,
  onConfirm,
  onCancel,
  icon,
}: {
  initial: string;
  depth: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  /** 节点图标（默认文件图标；新建/重命名文件夹时传入文件夹图标） */
  icon?: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  const confirm = (name: string) => {
    if (submitted.current) return;
    submitted.current = true;
    onConfirm(name.trim());
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: "nearest" });
    // 选中主体（不含扩展名），方便直接改名
    const dot = initial.lastIndexOf(".");
    ref.current?.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, []);
  return (
    <div className="flex items-center py-[5px] pr-2" style={{ paddingLeft: depth * 18 + 30 }}>
      {icon ?? <FileText size={16} className="shrink-0 text-[var(--fg-faint)]" />}
      <input
        ref={ref}
        defaultValue={initial}
        className="ml-1.5 min-w-0 flex-1 rounded border border-[var(--accent)] bg-[var(--bg)] px-1.5 py-[2px] text-[14.5px] outline-none"
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            confirm(e.currentTarget.value);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            submitted.current = true;
            onCancel();
          }
        }}
        onBlur={(e) => {
          // 点击别处即确认，与 Enter 共用标志避免重复提交。
          confirm(e.currentTarget.value);
        }}
      />
    </div>
  );
}

// ---------- 右键菜单 ----------

/** 菜单项统一样式（主菜单与二级子菜单共用） */
const MENU_ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-left text-[13.5px] text-[var(--fg)] hover:bg-[var(--bg-hover)]";

/** 导出格式登记表（右键「导出 ▸」二级菜单）：新格式在此追加条目；实现后去掉 disabled/hint 并在 onPick 分发 */
const EXPORT_FORMATS: { id: string; label: string; disabled?: boolean; hint?: string }[] = [
  { id: "html", label: "HTML…" },
  { id: "pdf", label: "PDF…", disabled: true, hint: "敬请期待" }, // 预留位：PDF 导出未实现
];

interface CtxMenu {
  x: number;
  y: number;
  node: FileNode | null; // null = 根目录
  depth: number;
}

/** 二级子菜单数据项 */
interface SubMenuItem {
  label: string;
  /** 预留未实现的格式：置灰不可点 */
  disabled?: boolean;
  /** 禁用项右侧提示小字（如「敬请期待」） */
  hint?: string;
  onClick?: () => void;
}

const SUB_MENU_W = 170; // 二级菜单宽度估算（右缘翻转判定用）

/**
 * 二级子菜单（「导出 ▸」等）：悬停父项展开、移出短延迟收起（容许父项→面板的移动缝隙）；
 * 悬停同一菜单的其它项时收起；右缘/底缘越界自动翻转。面板 DOM 挂在菜单容器内（fixed 定位浮出）。
 */
function SubMenu({ label, icon, items }: { label: string; icon: ReactNode; items: SubMenuItem[] }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null); // 父项矩形（null = 收起）
  const rootRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const clearTimer = () => window.clearTimeout(closeTimer.current);
  const scheduleClose = () => {
    clearTimer();
    closeTimer.current = window.setTimeout(() => setAnchor(null), 180);
  };
  useEffect(() => clearTimer, []);
  // 悬停同菜单其它项 → 收起（本组件父项/面板之外的 mouseover 均视为切走）
  useEffect(() => {
    if (!anchor) return;
    const container = rootRef.current?.closest(".ctx-menu");
    if (!container) return;
    const onOver = (e: Event) => {
      const t = e.target as Element;
      if (!rootRef.current?.contains(t) && !panelRef.current?.contains(t)) {
        clearTimer();
        setAnchor(null);
      }
    };
    container.addEventListener("mouseover", onOver);
    return () => container.removeEventListener("mouseover", onOver);
  }, [anchor]);

  const flipX = anchor ? anchor.right + 4 + SUB_MENU_W > window.innerWidth : false;
  const top = anchor
    ? Math.max(4, Math.min(anchor.top - 5, window.innerHeight - (items.length * 36 + 18)))
    : 0;
  return (
    <>
      <button
        ref={rootRef}
        className={`${MENU_ITEM} ${anchor ? "bg-[var(--bg-hover)]" : ""}`}
        onMouseEnter={(e) => {
          clearTimer();
          setAnchor(e.currentTarget.getBoundingClientRect());
        }}
        onMouseLeave={scheduleClose}
      >
        {icon} {label}
        <ChevronRight size={14} className="ml-auto shrink-0 text-[var(--fg-faint)]" />
      </button>
      {anchor && (
        <div
          ref={panelRef}
          className="ui-pop fixed z-50 min-w-[150px] rounded-md border border-[var(--border)] bg-[var(--bg-soft)] py-1 shadow-lg"
          style={flipX ? { right: window.innerWidth - anchor.left + 4, top } : { left: anchor.right + 4, top }}
          onMouseEnter={clearTimer}
          onMouseLeave={scheduleClose}
        >
          {items.map((it) =>
            it.disabled ? (
              <button
                key={it.label}
                className="flex w-full cursor-default items-center gap-2.5 rounded px-2 py-1.5 text-left text-[13.5px] text-[var(--fg-faint)]"
                title={it.hint ? `${it.label.replace(/…$/, "")}（${it.hint}）` : undefined}
              >
                {it.label}
                {it.hint && <span className="ml-auto shrink-0 text-[11px]">{it.hint}</span>}
              </button>
            ) : (
              <button key={it.label} className={MENU_ITEM} onClick={it.onClick}>
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}

/** 右键「导出 ▸」：二级菜单展示 EXPORT_FORMATS；onPick 按格式 id 分发（未实现的格式不会触发） */
function ExportSubMenu({ onPick }: { onPick: (id: string) => void }) {
  return (
    <SubMenu
      label="导出"
      icon={<Download size={15} />}
      items={EXPORT_FORMATS.map((f) => ({
        label: f.label,
        disabled: f.disabled,
        hint: f.hint,
        onClick: f.disabled ? undefined : () => onPick(f.id),
      }))}
    />
  );
}

function ContextMenu({
  menu,
  onClose,
  onNewFile,
  onNewDir,
  onRename,
  onDelete,
  onExportHtml,
  onReveal,
}: {
  menu: CtxMenu;
  onClose: () => void;
  onNewFile: (m: CtxMenu) => void;
  onNewDir: (m: CtxMenu) => void;
  onRename: (m: CtxMenu) => void;
  onDelete: (m: CtxMenu) => void;
  onExportHtml: (m: CtxMenu) => void;
  onReveal: (m: CtxMenu) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [onClose]);

  const isMdFile = !!menu.node && !menu.node.isDir && menu.node.name.toLowerCase().endsWith(".md");
  return (
    <div
      ref={ref}
      className="ctx-menu ui-pop fixed z-50 min-w-[180px] rounded-md border border-[var(--border)] bg-[var(--bg-soft)] py-1 shadow-lg"
      style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 260) }}
    >
      {menu.node?.isDir && (
        <>
          <button className={MENU_ITEM} onClick={() => onNewFile(menu)}>
            <FilePlus2 size={15} /> 新建文件
          </button>
          <button className={MENU_ITEM} onClick={() => onNewDir(menu)}>
            <FolderPlus size={15} /> 新建文件夹
          </button>
          <div className="mx-2 my-1 h-px bg-[var(--border)]" />
        </>
      )}
      {menu.node && (
        <>
          <button className={MENU_ITEM} onClick={() => onRename(menu)}>
            <Pencil size={15} /> 重命名
          </button>
          {isMdFile && (
            <ExportSubMenu
              onPick={(id) => {
                if (id === "html") onExportHtml(menu);
              }}
            />
          )}
          <button className={MENU_ITEM} onClick={() => onReveal(menu)}>
            <FolderSearch size={15} /> 打开文件位置
          </button>
          <div className="mx-2 my-1 h-px bg-[var(--border)]" />
          <button className={`${MENU_ITEM} text-[var(--syn-kw)]`} onClick={() => onDelete(menu)}>
            <Trash2 size={15} /> 删除（回收站）
          </button>
        </>
      )}
      {!menu.node && (
        <>
          <button className={MENU_ITEM} onClick={() => onNewFile(menu)}>
            <FilePlus2 size={15} /> 新建文件
          </button>
          <button className={MENU_ITEM} onClick={() => onNewDir(menu)}>
            <FolderPlus size={15} /> 新建文件夹
          </button>
        </>
      )}
    </div>
  );
}

// ---------- 树节点 ----------

function TreeNode({
  node,
  depth,
  activePath,
  onContext,
  inEdit,
  setEdit,
  refresh,
  loadDir,
}: {
  node: FileNode;
  depth: number;
  activePath: string | null;
  onContext: (m: CtxMenu) => void;
  /** 当前内联编辑的节点路径与模式 */
  inEdit: { path: string; mode: "newfile" | "newdir" | "rename" } | null;
  setEdit: (v: { path: string; mode: "newfile" | "newdir" | "rename" } | null) => void;
  refresh: () => void;
  /** 目录首次展开时按需加载其子层 */
  loadDir: (dirPath: string) => void;
}) {
  if (node.isDir) {
    // 文件夹重命名：替换为内联输入（与文件节点一致），确认后落盘并刷新
    if (inEdit?.path === node.path && inEdit.mode === "rename") {
      return (
        <InlineInput
          initial={node.name}
          depth={depth}
          icon={<Folder size={16} className="shrink-0 text-[var(--accent)]" />}
          onConfirm={(name) => {
            void applyRename(node, name, refresh).then(() => setEdit(null));
          }}
          onCancel={() => setEdit(null)}
        />
      );
    }
    return (
      <details
        className="tree-folder group"
        data-path={node.path}
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open) loadDir(node.path);
        }}
      >
        <summary
          className="flex cursor-pointer list-none items-center gap-1.5 rounded py-[5px] pr-2 text-[14.5px] text-[var(--fg)] transition-colors duration-150 hover:bg-[var(--bg-hover)] [&::-webkit-details-marker]:hidden"
          style={{ paddingLeft: depth * 18 + 8 }}
          onContextMenu={(e) => {
            e.preventDefault();
            onContext({ x: e.clientX, y: e.clientY, node, depth });
          }}
        >
          <ChevronRight size={14} className="shrink-0 text-[var(--fg-faint)] transition-transform group-open:rotate-90" />
          <Folder size={16} className="shrink-0 text-[var(--accent)] group-open:hidden" />
          <FolderOpen size={16} className="hidden shrink-0 text-[var(--accent)] group-open:block" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span
            role="button"
            tabIndex={-1}
            aria-label="更多操作"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--fg-faint)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] group-hover:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              onContext({ x: r.right - 190, y: r.bottom + 4, node, depth });
            }}
          >
            <EllipsisVertical size={15} />
          </span>
        </summary>
        {node.children.map((c) => (
          <TreeNode
            key={c.path}
            node={c}
            depth={depth + 1}
            activePath={activePath}
            onContext={onContext}
            inEdit={inEdit}
            setEdit={setEdit}
            refresh={refresh}
            loadDir={loadDir}
          />
        ))}
        {inEdit?.path === node.path && inEdit.mode !== "rename" && (
          <InlineInput
            initial={inEdit.mode === "newfile" ? "新文档.md" : "新文件夹"}
            depth={depth + 1}
            onConfirm={(name) => void applyEdit(node.path, name, inEdit.mode as "newfile" | "newdir", refresh).then(() => setEdit(null))}
            onCancel={() => setEdit(null)}
          />
        )}
      </details>
    );
  }

  // 文件节点
  if (inEdit?.path === node.path && inEdit.mode === "rename") {
    return (
      <InlineInput
        initial={node.name}
        depth={depth}
        onConfirm={(name) => {
          void applyRename(node, name, refresh).then(() => setEdit(null));
        }}
        onCancel={() => setEdit(null)}
      />
    );
  }

  const active = activePath === node.path;
  return (
    <button
      data-path={node.path}
      className={`group/file flex w-full cursor-pointer items-center gap-1.5 rounded py-[5px] pr-2 text-left text-[14.5px] transition-colors duration-150 ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : "text-[var(--fg)] hover:bg-[var(--bg-hover)]"
      }`}
      style={{ paddingLeft: depth * 18 + 30 }}
onClick={() => {
        if (isTextEditable(node.name)) {
          void openDocByPath(node.path, node.name);
          return;
        }
        // 编辑器不认的文件（exe / pdf / 无后缀…）：先提示无法直接打开，
        // 由用户自己决定要不要改用其它程序打开（不擅自用默认程序执行）
        showUnsupportedFile(node.path);
      }}
      onDoubleClick={() => {
        // 双击重命名只对文本文件生效：非文本文件的单击已弹出「不支持直接打开」，
        // 双击再触发重命名会与弹窗打架
        if (isTextEditable(node.name)) setEdit({ path: node.path, mode: "rename" });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext({ x: e.clientX, y: e.clientY, node, depth });
      }}
      title={node.name}
    >
      {(() => {
        const Icon = fileIcon(node.name);
        return <Icon size={16} className={`shrink-0 ${active ? "text-[var(--accent)]" : "text-[var(--fg-faint)]"}`} />;
      })()}
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      <span
        role="button"
        tabIndex={-1}
        aria-label="更多操作"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--fg-faint)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] group-hover/file:opacity-100"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          onContext({ x: r.right - 190, y: r.bottom + 4, node, depth });
        }}
      >
        <EllipsisVertical size={15} />
      </span>
    </button>
  );
}

/** 新建文件/文件夹在目录下落盘 */
async function applyEdit(
  dirPath: string,
  name: string,
  mode: "newfile" | "newdir",
  refresh: () => void,
): Promise<void> {
  if (!name) return;
  const target = joinPath(dirPath, name);
  try {
    if (mode === "newfile") await backend.createFile(target);
    else await backend.createDir(target);
    refresh();
  } catch (e) {
    notifyError(`创建失败：${e}`);
    return;
  }
  // 新建的 md 文件直接打开
  if (mode === "newfile" && name.toLowerCase().endsWith(".md")) {
    void openDocByPath(target, name);
  }
}

async function applyRename(node: FileNode, name: string, refresh: () => void): Promise<void> {
  if (!name || name === node.name) return;
  const parent = node.path.slice(0, Math.max(node.path.lastIndexOf("\\"), node.path.lastIndexOf("/")));
  const target = joinPath(parent, name);
  // 当前打开该文件 → 更新标签路径与名称；若为文件夹 → 更新其下所有打开文档的前缀路径
  const docs = useStore.getState().docs;
  const doc = docs.find((d) => d.path === node.path);
  try {
    await backend.renamePath(node.path, target);
    if (doc) {
      useStore.setState((s) => ({
        docs: s.docs.map((d) => (d.id === doc.id ? { ...d, name, path: target } : d)),
      }));
    } else if (node.isDir) {
      useStore.setState((s) => ({
        docs: s.docs.map((d) => {
          if (!d.path || !d.path.startsWith(node.path)) return d;
          return { ...d, path: target + d.path.slice(node.path.length) };
        }),
      }));
    }
    refresh();
  } catch (e) {
    notifyError(`重命名失败：${e}`);
  }
}

// ---------- 空状态卡片（对齐 UI 设计：图标卡片 + 标题 + 键帽提示 + 虚线按钮） ----------

/** 拟物小键帽（提示文案中的快捷键） */
const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-soft)]">
    {children}
  </kbd>
);

function EmptyPanel({
  icon: Icon,
  title,
  hint,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  hint: ReactNode;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-faint)] shadow-sm">
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <p className="mb-1 text-[12px] font-medium text-[var(--fg-soft)]">{title}</p>
      <p className="mb-4 px-2 text-[11px] leading-relaxed text-[var(--fg-faint)]">{hint}</p>
      <button
        onClick={onAction}
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-[12px] font-medium text-[var(--fg-soft)] transition-all hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
      >
        <Plus size={14} />
        {actionLabel}
      </button>
    </div>
  );
}

// ---------- 主组件 ----------

export default function FileTree({ onRecentHeightChange }: { onRecentHeightChange?: (height: number) => void }) {
  const tree = useStore((s) => s.tree);
  const root = useStore((s) => s.folderRoot);
  const loading = useStore((s) => s.treeLoading);
  const activeDocId = useStore((s) => s.activeDocId);
  const docs = useStore((s) => s.docs);
  const locateReq = useStore((s) => s.locateRequest);
  const showAllFiles = useStore((s) => s.settings.showAllFiles);
  const setSettings = useStore((s) => s.setSettings);
  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    const saved = localStorage.getItem("mdcraft:tree-sort");
    return SORT_OPTIONS.find((option) => option.value === saved)?.value ?? "default";
  });
  const [foldersFirst, setFoldersFirst] = useState(() => localStorage.getItem("mdcraft:tree-folders-first") !== "false");
  const [inEdit, setEdit] = useState<{ path: string; mode: "newfile" | "newdir" | "rename" } | null>(null);
  /** 浏览器模式：草稿右键菜单 */
  const [draftMenu, setDraftMenu] = useState<{ x: number; y: number; docId: string } | null>(null);
  /** 导出完成提示：待打开的导出文件路径 */
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  /** 待确认删除的节点（删除走应用内确认框，不用原生 window.confirm） */
  const [pendingDelete, setPendingDelete] = useState<FileNode | null>(null);
  /** 删除失败信息（弹窗保持打开时展示） */
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** 删除执行中 */
  const [deleting, setDeleting] = useState(false);


  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const pickAndOpenFolder = async () => {
    const p = await backend.pickOpenFolder();
    if (!p) return;
    await openFolder(p);
  };

  const active = docs.find((d) => d.id === activeDocId);
  const activePath = active?.path ?? null;
  // 排序结果缓存：仅在树 / 排序项变化时重算，避免每次渲染递归深拷贝整树
  const sortedTree = useMemo(() => sortTree(tree, sortOrder, foldersFirst), [tree, sortOrder, foldersFirst]);
  // 按「显示所有文件」设置过滤后的树（仅显示模式排除非 md/资源文件）
  const visibleTree = useMemo(
    () => filterTree(sortedTree, showAllFiles),
    [sortedTree, showAllFiles],
  );

  // 惰性树：记录已加载/加载中的目录路径，避免展开时重复请求
  const loadedRef = useRef<Set<string>>(new Set());
  // 排序状态的最新值（供异步加载 / 监听回调读取，避免闭包过期）
  const sortOrderRef = useRef(sortOrder);
  sortOrderRef.current = sortOrder;
  const foldersFirstRef = useRef(foldersFirst);
  foldersFirstRef.current = foldersFirst;

  /** 展开目录时按需加载其子层（单层惰性）；已加载/加载中则跳过 */
  const loadDir = async (dirPath: string) => {
    if (loadedRef.current.has(dirPath)) return;
    loadedRef.current.add(dirPath);
    try {
      const kids = await backend.listDir(dirPath);
      useStore
        .getState()
        .setDirChildren(dirPath, sortTree(kids, sortOrderRef.current, foldersFirstRef.current));
    } catch {
      loadedRef.current.delete(dirPath); // 失败允许下次重试
    }
  };

  const refresh = async (silent = false) => {
    if (!root) return;
    if (!silent) useStore.getState().setTree([], true);
    loadedRef.current.clear(); // 整树重置 → 已加载标记一并失效
    try {
      const t = await backend.listDir(root);
      // 关闭文件夹竞态保护
      if (useStore.getState().folderRoot === root) {
        useStore.getState().setTree(sortTree(t, sortOrderRef.current, foldersFirstRef.current), false);
      }
    } catch {
      if (!silent) useStore.getState().setTree([], false);
    }
  };

  // 文件夹变更事件 → 只重载受影响目录（增量），避免整树全量重扫导致展开状态丢失
  useEffect(() => {
    if (!root || !backend.isTauri) return;
    const off = backend.onFsEvent((events) => {
      const parents = new Set<string>([root]);
      for (const ev of events) {
        const idx = Math.max(ev.path.lastIndexOf("\\"), ev.path.lastIndexOf("/"));
        if (idx > 0) parents.add(ev.path.slice(0, idx));
      }
      // 只重载根目录与已展开过的目录（未展开的无需预取）
      const toReload = [...parents].filter((d) => d === root || loadedRef.current.has(d));
      void Promise.all(
        toReload.map(async (d) => {
          try {
            const kids = await backend.listDir(d);
            const sorted = sortTree(kids, sortOrderRef.current, foldersFirstRef.current);
            if (d === root) useStore.getState().setTree(sorted, false);
            else useStore.getState().setDirChildren(d, sorted);
          } catch {
            /* 忽略不可达目录 */
          }
        }),
      );
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // 切换排序 → 对已加载的整棵树重排（惰性树规模有限，可接受）
  useEffect(() => {
    if (!root) return;
    const cur = useStore.getState().tree;
    if (cur.length) useStore.getState().setTree(sortTree(cur, sortOrder, foldersFirst), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortOrder, foldersFirst]);

  // 定位请求（面包屑「定位」按钮）：展开祖先目录 → 滚动到目标 → 闪烁高亮
  useEffect(() => {
    if (!locateReq || !root || !backend.isTauri) return;
    const target = locateReq.path;
    // 目标必须在当前文件夹内（含分隔符的前缀匹配，避免 a/b 与 a/bc 误中）
    const norm = (p: string) => p.replace(/[\\/]+$/, "");
    if (!norm(target).toLowerCase().startsWith(norm(root).toLowerCase() + "\\") &&
        !norm(target).toLowerCase().startsWith(norm(root).toLowerCase() + "/")) return;
    const req = requestAnimationFrame(() => {
      // 展开全部祖先目录（details 非受控 open，直接改 DOM 即生效）
      document.querySelectorAll<HTMLDetailsElement>("details[data-path]").forEach((d) => {
        const p = d.dataset.path ?? "";
        if (norm(target).toLowerCase().startsWith(p.toLowerCase() + "\\") ||
            norm(target).toLowerCase().startsWith(p.toLowerCase() + "/")) {
          d.open = true;
        }
      });
      // 展开后等一帧布局稳定再滚动/闪烁
      requestAnimationFrame(() => {
        const btn = document.querySelector(`button[data-path="${CSS.escape(target)}"]`) as HTMLElement | null;
        if (!btn) return;
        btn.scrollIntoView({ block: "center" });
        btn.classList.remove("tree-locate-flash");
        void btn.offsetWidth; // 重启动画
        btn.classList.add("tree-locate-flash");
        setTimeout(() => btn.classList.remove("tree-locate-flash"), 1800);
      });
    });
    return () => cancelAnimationFrame(req);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateReq, root]);

  // 草稿右键菜单：点击外部关闭
  useEffect(() => {
    if (!draftMenu) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest(".fixed.z-50")) setDraftMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [draftMenu]);

  // ---------- 浏览器模式：草稿列表 ----------
  if (!backend.isTauri) {
    const drafts = docs.filter((d) => !d.path || d.path.startsWith("mdcraft:doc:"));
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 pt-1">
        {drafts.map((d) => (
          <button
            key={d.id}
            className={`flex w-full cursor-pointer items-center gap-1.5 rounded py-[5px] pl-4 pr-2 text-left text-[14.5px] transition-colors duration-150 ${
              d.id === activeDocId
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--fg)] hover:bg-[var(--bg-hover)]"
            }`}
            onClick={() => useStore.getState().setActiveDoc(d.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setDraftMenu({ x: e.clientX, y: e.clientY, docId: d.id });
            }}
          >
            <FileText size={16} className="shrink-0 text-[var(--fg-faint)]" />
            <span className="truncate">{d.name}</span>
          </button>
        ))}
        {!drafts.length && (
          <EmptyPanel
            icon={FileText}
            title="暂无草稿文档"
            hint={<>按 <Kbd>Ctrl+N</Kbd> 快速新建</>}
            actionLabel="新建第一篇草稿"
            onAction={() => useStore.getState().newDoc()}
          />
        )}
        {draftMenu && (
          <div
            className="ctx-menu ui-pop fixed z-50 min-w-[170px] rounded-md border border-[var(--border)] bg-[var(--bg-soft)] py-1 shadow-lg"
            style={{ left: Math.min(draftMenu.x, window.innerWidth - 190), top: Math.min(draftMenu.y, window.innerHeight - 140) }}
          >
            <ExportSubMenu
              onPick={(id) => {
                if (id === "html") void exportDraftDoc(draftMenu.docId);
                setDraftMenu(null);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // ---------- 桌面模式：未打开文件夹（空状态直接提供入口按钮） ----------
  if (!root) {
    const opened = docs.filter((d) => d.path && !d.path.startsWith("mdcraft:"));
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyPanel
          icon={FolderOpen}
          title="未打开文件夹"
          hint={<>打开本地文件夹即可浏览文件树；也可通过菜单「文件 → 打开文件…」打开单个文件</>}
          actionLabel="打开文件夹"
          onAction={() => void pickAndOpenFolder()}
        />
        {opened.length > 0 && (
          <div className="mb-2 min-h-0 shrink-0 overflow-y-auto border-t border-[var(--border)] pt-1" style={{ maxHeight: "50%" }}>
            <div className="px-3 py-1 text-[12px] font-medium text-[var(--fg-faint)]">已打开的文件</div>
            {opened.map((d) => (
              <button
                key={d.id}
                className={`flex w-full cursor-pointer items-center gap-1.5 rounded py-[5px] pl-4 pr-2 text-left text-[14.5px] transition-colors duration-150 ${
                  d.id === activeDocId
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--fg)] hover:bg-[var(--bg-hover)]"
                }`}
                onClick={() => useStore.getState().setActiveDoc(d.id)}
                title={d.path ?? undefined}
              >
                <FileText size={16} className="shrink-0 text-[var(--fg-faint)]" />
                <span className="truncate">{d.name}</span>
              </button>
            ))}
          </div>
        )}
        <RecentFiles onHeightChange={onRecentHeightChange} />
      </div>
    );
  }

  // ---------- 桌面模式：目录树 ----------
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <FolderOpen size={18} strokeWidth={2} className="shrink-0 text-[var(--accent)]" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-[var(--fg)]" title={root}>
          {root.split(/[\\/]/).filter(Boolean).pop() ?? root}
        </span>
        <button className="rounded p-1.5 text-[var(--fg-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]" title="刷新" onClick={() => void refresh()}>
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
        <div ref={moreRef} className="relative shrink-0">
          <button
            className="rounded p-1.5 text-[var(--fg-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
            title="更多"
            aria-label="目录树更多选项"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            <EllipsisVertical size={16} />
          </button>
          {moreOpen && (
            <div className="ui-pop ui-pop-right absolute right-0 top-full z-50 min-w-[200px] rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-lg">
              <button className={MENU_ITEM} onClick={() => { setMoreOpen(false); setEdit({ path: root, mode: "newfile" }); }}>
                <FilePlus2 size={15} /> 新建文件
              </button>
              <button className={MENU_ITEM} onClick={() => { setMoreOpen(false); setEdit({ path: root, mode: "newdir" }); }}>
                <FolderPlus size={15} /> 新建文件夹
              </button>
              <div className="mx-2 my-1 h-px bg-[var(--border)]" />
              <div className="px-2 py-1 text-[11px] text-[var(--fg-faint)]">文件排序</div>
              {(() => {
                const option = SORT_OPTIONS[0];
                return (
                  <button
                    className={MENU_ITEM}
                    onClick={() => {
                      setSortOrder("default");
                      localStorage.setItem("mdcraft:tree-sort", "default");
                    }}
                  >
                    <option.icon size={16} className={`shrink-0 ${sortOrder === "default" ? "text-[var(--accent)]" : "text-[var(--fg-faint)]"}`} />
                    <span className="flex-1 whitespace-nowrap">{option.label}</span>
                    <span className="w-4 shrink-0 text-[var(--accent)]">{sortOrder === "default" && <Check size={14} />}</span>
                  </button>
                );
              })()}
              <div className="mx-2 my-1 h-px bg-[var(--border)]" />
              {SORT_GROUPS.map((group) => {
                const selected = sortOrder === group.asc || sortOrder === group.desc;
                const defaultOrder = group.asc === "name-asc" || group.asc === "type" ? group.asc : group.desc;
                const displayedOrder = selected ? sortOrder : defaultOrder;
                const option = SORT_OPTIONS.find((item) => item.value === displayedOrder)!;
                return (
                <button
                  key={group.asc}
                  className={MENU_ITEM}
                  onClick={() => {
                    const nextOrder = selected ? (sortOrder === group.asc ? group.desc : group.asc) : defaultOrder;
                    setSortOrder(nextOrder);
                    localStorage.setItem("mdcraft:tree-sort", nextOrder);
                  }}
                  title={group.asc !== group.desc ? "再次点击切换排序方向" : undefined}
                >
                  <option.icon size={16} className={`shrink-0 ${selected ? "text-[var(--accent)]" : "text-[var(--fg-faint)]"}`} />
                  <span className="flex-1 whitespace-nowrap">{selected ? option.label : group.label}</span>
                  <span className="w-4 shrink-0 text-[var(--accent)]">{selected && <Check size={14} />}</span>
                </button>
                );
              })}
              <div className="mx-2 my-1 h-px bg-[var(--border)]" />
              <button className={MENU_ITEM} onClick={() => {
                setFoldersFirst(!foldersFirst);
                localStorage.setItem("mdcraft:tree-folders-first", String(!foldersFirst));
                setMoreOpen(false);
              }}>
                <FolderUp size={16} className="shrink-0 text-[var(--fg-faint)]" />
                <span className="flex-1">文件夹置顶</span>
                <span className="w-4 shrink-0 text-[var(--accent)]">{foldersFirst && <Check size={14} />}</span>
              </button>
              <div className="mx-2 my-1 h-px bg-[var(--border)]" />
              <button className={MENU_ITEM} onClick={() => setSettings({ showAllFiles: !showAllFiles })} title="关闭则仅显示 Markdown 与资源文件">
                <Files size={16} className="shrink-0 text-[var(--fg-faint)]" />
                <span className="flex-1">显示所有文件</span>
                <span className="w-4 shrink-0 text-[var(--accent)]">{showAllFiles && <Check size={14} />}</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {inEdit?.path === root && inEdit.mode !== "rename" && (
          <InlineInput
            key={inEdit.mode}
            initial={inEdit.mode === "newfile" ? "新文档.md" : "新文件夹"}
            depth={0}
            onConfirm={(name) => void applyEdit(root, name, inEdit.mode as "newfile" | "newdir", refresh).then(() => setEdit(null))}
            onCancel={() => setEdit(null)}
          />
        )}
        {visibleTree.map((n) => (
          <TreeNode
            key={n.path}
            node={n}
            depth={0}
            activePath={activePath}
            onContext={setMenu}
            inEdit={inEdit}
            setEdit={setEdit}
            refresh={refresh}
            loadDir={loadDir}
          />
        ))}
        {!loading && visibleTree.length === 0 && !inEdit && (
          <div className="px-3 py-2 text-[13px] text-[var(--fg-faint)]">
            {showAllFiles ? "目录中没有文件" : "目录中没有 Markdown 或资源文件"}
          </div>
        )}
      </div>
      <RecentFiles onHeightChange={onRecentHeightChange} />
      {menu && (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onNewFile={(m) => {
            setMenu(null);
            const target = m.node?.isDir ? m.node.path : root;
            setEdit({ path: target, mode: "newfile" });
          }}
          onNewDir={(m) => {
            setMenu(null);
            const target = m.node?.isDir ? m.node.path : root;
            setEdit({ path: target, mode: "newdir" });
          }}
          onRename={(m) => {
            setMenu(null);
            if (m.node) setEdit({ path: m.node.path, mode: "rename" });
          }}
          onExportHtml={(m) => {
            setMenu(null);
            const n = m.node;
            if (!n || n.isDir) return;
            void (async () => {
              try {
                const out = await exportDocByPath(n.path);
                if (out) setExportedPath(out);
              } catch (e) {
                notifyError(`导出失败：${e}`);
              }
            })();
          }}
          onReveal={(m) => {
            setMenu(null);
            if (!m.node) return;
            backend.showInFolder(m.node.path).catch((e: unknown) => notifyError(`打开失败：${e}`));
          }}
          onDelete={(m) => {
            setMenu(null);
            const n = m.node;
            if (!n) return;
            // 交给应用内确认框：原生 window.confirm 在 Tauri 里返回值不可靠
            setDeleteError(null);
            setPendingDelete(n);
          }}
/>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        busy={deleting}
        icon={<Trash2 size={17} />}
        title={pendingDelete?.isDir ? "删除文件夹" : "删除文件"}
        description={
          pendingDelete?.isDir ? (
            <>「{pendingDelete.name}」及其全部内容将移到系统回收站。</>
          ) : (
            <>「{pendingDelete?.name}」将移到系统回收站。</>
          )
        }
        detail={pendingDelete?.path}
        confirmText="移到回收站"
        error={deleteError}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError(null);
        }}
        onConfirm={() => {
          const n = pendingDelete;
          if (!n || deleting) return;
          setDeleting(true);
          void (async () => {
            try {
              await backend.trashPath(n.path);
              // 关闭以此目录为底的打开文档
              const affected = useStore.getState().docs.filter((d) => d.path?.startsWith(n.path));
              affected.forEach((d) => useStore.getState().closeDoc(d.id));
              setPendingDelete(null);
              setDeleteError(null);
              refresh();
            } catch (e) {
              setDeleteError(`删除失败：${e}`);
            } finally {
              setDeleting(false);
            }
          })();
        }}
      />
      {exportedPath && (
        <ExportResultDialog
          path={exportedPath}
          onOpen={() => {
            backend.openPath(exportedPath).catch((e: unknown) => notifyError(`打开失败：${e}`));
            setExportedPath(null);
          }}
          onReveal={() => {
            backend.showInFolder(exportedPath).catch((e: unknown) => notifyError(`打开失败：${e}`));
            setExportedPath(null);
          }}
          onClose={() => setExportedPath(null)}
        />
      )}
    </div>
  );
}
