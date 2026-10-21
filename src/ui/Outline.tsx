// 大纲面板（思源式）：H 级别标记、当前光标位置高亮+滚动跟随、
// 嵌套树折叠（grid 0fr↔1fr 高度过渡）、展开层级工具

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useStore } from "../store";
import { jumpToLine } from "../editor/viewref";
import { ChevronRight, ListTree } from "lucide-react";
import type { OutlineItem } from "../lib/types";

/** H1~H6 级别标记（等宽灰色小字） */
const H_LABEL = ["H1", "H2", "H3", "H4", "H5", "H6"];

interface OutlineNode {
  item: OutlineItem;
  children: OutlineNode[];
}

/** 扁平标题列表 → 嵌套树；超出当前展开层级的节点整棵跳过 */
function buildTree(items: OutlineItem[], maxLevel: number | null): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const item of items) {
    if (maxLevel !== null && item.level > maxLevel) continue;
    const node: OutlineNode = { item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].item.level >= item.level) stack.pop();
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

function NodeView({
  node,
  collapsed,
  toggle,
  currentLine,
  activeRef,
}: {
  node: OutlineNode;
  collapsed: Set<number>;
  toggle: (line: number) => void;
  currentLine: number | null;
  activeRef: RefObject<HTMLButtonElement | null>;
}) {
  const item = node.item;
  const hasChildren = node.children.length > 0;
  const open = !collapsed.has(item.line);
  const isCurrent = currentLine === item.line;

  return (
    <div>
      <div
        className={`group flex items-center rounded pr-1.5 transition-colors duration-150 ${
          isCurrent ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]"
        }`}
        style={{ marginLeft: (item.level - 1) * 14 }}
      >
        {/* 折叠三角：旋转过渡；无子项时留出等宽占位 */}
        <button
          title={hasChildren ? (open ? "折叠子标题" : "展开子标题") : ""}
          disabled={!hasChildren}
          aria-expanded={hasChildren ? open : undefined}
          onClick={() => hasChildren && toggle(item.line)}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors duration-150 ${
            hasChildren
              ? "cursor-pointer text-[var(--fg-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
              : "cursor-default"
          }`}
        >
          {hasChildren && (
            <ChevronRight
              size={13}
              className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
            />
          )}
        </button>
        <button
          ref={isCurrent ? activeRef : undefined}
          title={item.text}
          onClick={() => jumpToLine(item.line)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 truncate py-[3px] pr-1 text-left text-[13px] text-[var(--fg)]"
        >
          <span className="shrink-0 text-[10.5px] font-medium tabular-nums text-[var(--fg-faint)]">
            {H_LABEL[item.level - 1]}
          </span>
          <span className="truncate" style={{ fontWeight: item.level <= 2 ? 600 : 400 }}>
            {item.text}
          </span>
        </button>
      </div>
      {hasChildren && (
        <div className={`outline-kids ${open ? "is-open" : ""}`} aria-hidden={!open} inert={!open}>
          <div className="outline-kids-inner">
            {node.children.map((child) => (
              <NodeView
                key={child.item.line}
                node={child}
                collapsed={collapsed}
                toggle={toggle}
                currentLine={currentLine}
                activeRef={activeRef}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Outline() {
  const outline = useStore((s) => s.outline);
  const chain = useStore((s) => s.headingChain);
  const activeDocId = useStore((s) => s.activeDocId);
  /** 折叠的标题行号集合 */
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  /** 展开层级：null=全部，1~6=只显示到该级 */
  const [expandLevel, setExpandLevel] = useState<number | null>(null);
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const levelBtnRef = useRef<HTMLDivElement>(null);

  // 当前高亮项（标题链末项）；变化时滚动到面板可见区
  const current = chain.length > 0 ? chain[chain.length - 1] : null;
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!activeRef.current) return;
    // 当前标题被折叠在某个父标题下时 DOM 仍在但视觉隐藏，滚动过去会看到空白
    if (chain.slice(0, -1).some((item) => collapsed.has(item.line))) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeRef.current.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [current?.line]);

  // 切换文档时清空折叠状态（行号属于上一份文档，保留会指错标题）
  useLayoutEffect(() => {
    setCollapsed(new Set());
  }, [activeDocId]);

  // 展开层级菜单：点击外部关闭
  useEffect(() => {
    if (!levelMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (!levelBtnRef.current?.contains(e.target as Node)) setLevelMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [levelMenuOpen]);

  const tree = useMemo(() => buildTree(outline, expandLevel), [outline, expandLevel]);

  const toggleCollapse = (line: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部工具条：展开层级 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] px-1.5 py-1">
        <div className="relative" ref={levelBtnRef}>
          <button
            title={expandLevel === null ? "展开层级：全部（点击选择展开到某一级）" : `展开层级：${expandLevel} 级`}
            onClick={() => setLevelMenuOpen((v) => !v)}
            className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors duration-150 ${
              expandLevel !== null
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--fg-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
            }`}
          >
            <ListTree size={12} />
            {expandLevel === null ? "全部层级" : `${expandLevel} 级`}
          </button>
          {levelMenuOpen && (
            <div className="ui-pop absolute left-0 top-6 z-50 w-28 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-lg">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  className="block w-full cursor-pointer rounded-md px-2.5 py-1 text-left text-[12.5px] text-[var(--fg)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    setExpandLevel(n === 6 ? null : n);
                    setLevelMenuOpen(false);
                  }}
                >
                  展开{H_LABEL[n - 1]}
                </button>
              ))}
              <div className="mx-2 my-1 h-px bg-[var(--border)]" />
              <button
                className="block w-full cursor-pointer rounded-md px-2.5 py-1 text-left text-[12.5px] text-[var(--fg)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  setExpandLevel(null);
                  setLevelMenuOpen(false);
                }}
              >
                全部层级
              </button>
            </div>
          )}
        </div>
      </div>

      {outline.length === 0 ? (
        <div className="px-3 py-2.5 text-xs text-[var(--fg-faint)]">
          当前文档没有标题。
          <br />
          输入 / 快速插入标题层级。
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {tree.map((node) => (
            <NodeView
              key={node.item.line}
              node={node}
              collapsed={collapsed}
              toggle={toggleCollapse}
              currentLine={current?.line ?? null}
              activeRef={activeRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}
