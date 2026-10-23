// 编辑器面板：CodeMirror 宿主、文档切换、大纲/状态同步

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import { editorStates, useStore } from "../store";
import { createState, reconfigure, type EditorSettings } from "../editor/setup";
import { setView } from "../editor/viewref";
import { imageAssets, setActiveDocPath } from "../editor/image";
import { frontmatterRange } from "../editor/livepreview";
import { countStats } from "../lib/stats";
import { saveActiveDoc } from "../lib/docActions";
import { dismissBootSplash } from "../lib/boot-splash";
import type { DocFile, OutlineItem } from "../lib/types";

let outlineTimer: ReturnType<typeof setTimeout> | null = null;

function computeOutline(view: EditorView): OutlineItem[] {
  const state = view.state;
  const items: OutlineItem[] = [];
  // frontmatter 内的行不进大纲：语法树不识别 frontmatter，
  // 其 title: xxx + 闭合 --- 按 CommonMark 会被误判为 Setext H2
  const fm = frontmatterRange(state);
  const fmEndPos = fm ? state.doc.line(fm[1]).to : -1;
  // 用 ensureSyntaxTree 强制完整解析：Language 的 field.tree 在创建时只按
  // 20ms 时间预算解析了一部分，大文档会得到不完整树导致大纲截断；
  // 这里以文档末尾为界确保拿到整棵树，避免大纲只显示前半段标题。
  const tree = ensureSyntaxTree(state, state.doc.length) ?? syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (fm && node.name !== "Document" && node.from < fmEndPos) return false;
      const m = /^(ATXHeading|SetextHeading)([1-6])$/.exec(node.name);
      if (m) {
        const level = Number(m[2]);
        const ln = state.doc.lineAt(node.from);
        const text = ln.text.replace(/^#{1,6} +/, "").replace(/\s+$/, "");
        if (text) items.push({ level, text, from: node.from, to: node.to, line: ln.number });
      }
    },
  });
  return items;
}

/**
 * 当前光标所在的标题链（H1→…→当前层），思源 setCurrent 同款思路：
 * 取光标前最近的标题，再向上收集各级父标题
 */
function computeHeadingChain(view: EditorView, items: OutlineItem[]): OutlineItem[] {
  const head = view.state.selection.main.head;
  let cur = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].from <= head) cur = i;
    else break;
  }
  if (cur === -1) return [];
  const chain: OutlineItem[] = [items[cur]];
  let level = items[cur].level;
  for (let i = cur - 1; i >= 0; i--) {
    if (items[i].level < level) {
      chain.push(items[i]);
      level = items[i].level;
      if (level === 1) break;
    }
  }
  return chain.reverse();
}

function settingsOf(s: { sourceMode: boolean; showMinimap: boolean }): EditorSettings {
  return { sourceMode: s.sourceMode, showMinimap: s.showMinimap };
}

export default function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeDocId = useStore((s) => s.activeDocId);
  const docCount = useStore((s) => s.docs.length);
  const settings = useStore((s) => s.settings);
  const storeRef = useRef(useStore.getState());
  storeRef.current = useStore.getState();
  /** 视图当前展示的文档 id */
  const shownDocRef = useRef<string | null>(null);

  /** 未保存草稿粘贴图片时：触发另存为，返回磁盘路径（用户取消返回 null） */
  const ensureDocPath = async (): Promise<string | null> => {
    const ok = await saveActiveDoc(true);
    if (!ok) return null;
    const st = useStore.getState();
    return st.docs.find((d) => d.id === st.activeDocId)?.path ?? null;
  };

  /** 取（或创建）文档的编辑器状态，附带本面板的更新监听器 */
  const getStateFor = (doc: DocFile): Parameters<typeof EditorView.prototype.setState>[0] => {
    let st = editorStates.get(doc.id);
    if (!st) {
      // 打开已有文件时初始光标放到文档末尾，避免首行标题被光标触碰而显示源码态
      // （livepreview 语义：光标触碰行内元素 → 显示该元素源码）；仅新建空草稿从首行开始输入。
      const isNewEmptyDraft = !doc.path && doc.initialContent.length === 0;
      const initialPos = isNewEmptyDraft ? 0 : doc.initialContent.length;
      st = createState(doc.initialContent, settingsOf(storeRef.current.settings), [
        EditorView.updateListener.of((u) => onEditorUpdate(u.view, u)),
        imageAssets(ensureDocPath),
      ], initialPos);
      editorStates.set(doc.id, st);
    }
    return st;
  };

  const onEditorUpdate = (view: EditorView, u: { docChanged: boolean; selectionSet: boolean }) => {
    if (u.docChanged) {
      // 注意：不能读 storeRef.current 的 docs/settings 快照——markDirty 只改 docs 内容、
      // 数组长度不变，EditorPane 不会因此重渲染，快照会一直是 dirty=false，后续保存/
      // 状态判断会拿到旧值。这里统一读 store 实时状态。
      const live = useStore.getState();
      const id = live.activeDocId;
      live.markDirty(id, true);
      const text = view.state.doc.toString();
      const pos = view.state.selection.main.head;
      const ln = view.state.doc.lineAt(pos);
      live.updateStatus({
        ...countStats(text),
        line: ln.number,
        col: pos - ln.from + 1,
      });

      // 大纲 + 当前标题链（400ms 防抖）
      if (outlineTimer) clearTimeout(outlineTimer);
      outlineTimer = setTimeout(() => {
        const items = computeOutline(view);
        storeRef.current.setOutline(items);
        storeRef.current.setHeadingChain(computeHeadingChain(view, items));
      }, 400);
    }
    if (u.selectionSet && !u.docChanged) {
      const pos = view.state.selection.main.head;
      const ln = view.state.doc.lineAt(pos);
      storeRef.current.updateStatus({ line: ln.number, col: pos - ln.from + 1 });
      // 纯光标移动即时刷新标题链（文档未变，直接用现有大纲项的位置，无需重遍历语法树）。
      // 注意：这里必须读 store 的实时状态——storeRef.current 只是最近一次 React 渲染的快照，
      // 文档切换后的 outline 更新不会触发本组件重渲染，读快照会拿到上一份文档的大纲。
      const live = useStore.getState();
      live.setHeadingChain(computeHeadingChain(view, live.outline));
    }
  };

  // 初始化视图（一次性；无文档时等待创建）
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const store = storeRef.current;
    const doc = store.docs.find((d) => d.id === store.activeDocId) ?? store.docs[0];
    if (!doc) return;

    // 图片相对路径以当前文档目录为基准：必须在建视图前更新，
    // 否则首帧 ImageWidget 会用上一篇文档的目录解析（错源 / 重新加载）
    setActiveDocPath(doc.path);
    const view = new EditorView({
      state: getStateFor(doc),
      parent: hostRef.current,
    });
    viewRef.current = view;
    setView(view);
    shownDocRef.current = doc.id;
    storeRef.current.updateStatus(countStats(view.state.doc.toString()));
    const items0 = computeOutline(view);
    storeRef.current.setOutline(items0);
    storeRef.current.setHeadingChain(computeHeadingChain(view, items0));
    // 仅新建空草稿时自动聚焦；打开已有文件首次载入不抢焦点
    if (!doc.path && doc.initialContent.length === 0) view.focus();
    dismissBootSplash();

    return () => {
      const id = storeRef.current.activeDocId;
      if (viewRef.current) editorStates.set(id, viewRef.current.state);
      viewRef.current?.destroy();
      viewRef.current = null;
      setView(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docCount > 0]);

  // 文档切换：旧状态回写 → 新状态载入
  useEffect(() => {
    const view = viewRef.current;
    if (!view || docCount === 0) return;
    const store = storeRef.current;
    const doc = store.docs.find((d) => d.id === store.activeDocId);
    if (!doc || shownDocRef.current === doc.id) return;

    // 1. 当前视图状态回写到它所属的文档
    if (shownDocRef.current) {
      if (!editorStates.has(shownDocRef.current) || editorStates.get(shownDocRef.current) !== view.state) {
        editorStates.set(shownDocRef.current, view.state);
      }
    }

    // 2. 载入新文档状态（不存在则创建）
    // 先切图片解析基准，再 setState —— 首帧渲染图片时才是新文档所在目录
    setActiveDocPath(doc.path);
    const st = editorStates.get(doc.id) ?? getStateFor(doc);
    view.setState(st);
    shownDocRef.current = doc.id;

    // 切换文档时编辑器内容轻淡入（只动 opacity，不影响 CM6 测量）
    const host = hostRef.current;
    if (host) {
      host.classList.remove("doc-enter");
      void host.offsetWidth;
      host.classList.add("doc-enter");
    }

    // 3. 应用当前设置 + 刷新统计、光标位置与大纲
    reconfigure(view, settingsOf(store.settings));
    const head = st.selection.main.head;
    const line = st.doc.lineAt(head);
    storeRef.current.updateStatus({
      ...countStats(st.doc.toString()),
      line: line.number,
      col: head - line.from + 1,
    });
    const items = computeOutline(view);
    storeRef.current.setOutline(items);
    storeRef.current.setHeadingChain(computeHeadingChain(view, items));
    // 仅新建空草稿（Ctrl+N）时自动聚焦进入输入；打开已有文件/切换文档
    // 不抢焦点、不定位首行，焦点保留在触发来源（文件树/拖入等）。
    const isNewEmptyDraft = !doc.path && st.doc.length === 0;
    if (isNewEmptyDraft) {
      view.focus();
      // 等一帧再聚焦一次：WebView2 下 Ctrl+N 的按键默认行为可能在本轮事件后
      // 改变焦点，延迟聚焦可确保新文档的空光标处于可输入状态
      requestAnimationFrame(() => {
        if (viewRef.current === view) view.focus();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId, docCount]);

  // 设置变化 → 重配置活动视图
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    reconfigure(view, settingsOf(settings));
  }, [settings.sourceMode, settings.showMinimap]);

  if (docCount === 0) {
    return <div ref={hostRef} className="h-full min-h-0 flex-1" />;
  }

  return <div ref={hostRef} className="doc-enter h-full min-h-0 flex-1" />;
}
