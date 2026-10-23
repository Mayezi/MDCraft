// 当前活动 EditorView 的模块级引用（供大纲跳转、保存、插入表格等外部调用）

import type { EditorView } from "@codemirror/view";

let view: EditorView | null = null;

export function setView(v: EditorView | null) {
  view = v;
  // 调试钩子：浏览器控制台可通过 __mdView 访问编辑器实例（自动化测试/排查用）
  (globalThis as Record<string, unknown>).__mdView = v ?? undefined;
}

export function getView(): EditorView | null {
  return view;
}

/**
 * 跳到指定行（col 为 1-based 字符列，用于定位到搜索命中的具体位置）
 *
 * y：滚动定位方式。默认 "center"（目标居中）；
 * "start" 让目标落在视口顶部——大纲点击用这个，标题正好成为视口锚点。
 */
export function jumpToLine(line: number, col = 1, y: "center" | "start" = "center") {
  const v = getView();
  if (!v) return;
  const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
  const pos = l.from + Math.min(Math.max(0, col - 1), l.length);
  // EditorView 仅在此处按需加载：侧栏/面包屑只导入本函数，不应把编辑器大包带进首屏
  void import("@codemirror/view").then(({ EditorView }) => {
    if (getView() !== v) return; // 期间切换/销毁了视图
    v.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y }),
    });
    v.focus();
  });
}
