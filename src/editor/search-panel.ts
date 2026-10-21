// 文内查找面板：CM6 搜索状态（SearchQuery）的中文面板
// 布局：置顶单行 —— 查找词 · 命中计数 · 选项(Aa/.*/W) · 上/下一个 · 替换 · 关闭；
// 替换区默认收起，点击「替换」或按 Ctrl+H 展开。
// ⚠ CM6 限制：自定义面板必须自行把 keydown 交给 scope="search-panel" 的快捷键
//   （Esc 关闭 / F3 上下一个 / Mod-f 再聚焦），否则默认面板的快捷键全部失效；
//   打开面板时聚焦的输入框须带 main-field 属性，mount() 时选中内容。

import { EditorView, runScopeHandlers, type Panel, type ViewUpdate } from "@codemirror/view";
import { type EditorState } from "@codemirror/state";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  setSearchQuery,
} from "@codemirror/search";

/** 计数上限：超长文档不做全量统计，超出显示「N+」 */
const COUNT_CAP = 2000;

/** 当前面板实例：Ctrl+H 需要它展开替换区（面板由编辑器状态创建/销毁） */
let activePanel: MdSearchPanel | null = null;
/** 创建面板时的一次性标志（构造函数在 dispatch 内同步执行） */
let openWithReplace = false;

/** Ctrl+H：打开查找面板并展开替换区 */
export function openReplacePanel(view: EditorView): boolean {
  openWithReplace = true;
  const ok = openSearchPanel(view);
  openWithReplace = false;
  if (ok) activePanel?.setReplaceVisible(true);
  return ok;
}

/** 查找面板扩展（内容见 MdSearchPanel，置顶由 Panel.top 控制） */
export function mdSearchPanel() {
  return search({ createPanel: (view) => new MdSearchPanel(view) });
}

type ToggleKey = "caseSensitive" | "regexp" | "wholeWord";

class MdSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;

  private view: EditorView;
  private query: SearchQuery;
  private findField: HTMLInputElement;
  private replaceField: HTMLInputElement;
  private countEl: HTMLSpanElement;
  private replaceRow: HTMLElement;
  private replaceToggle: HTMLButtonElement;
  private toggles: { key: ToggleKey; btn: HTMLButtonElement }[] = [];
  private opt: Record<ToggleKey, boolean> = { caseSensitive: false, regexp: false, wholeWord: false };
  private replaceVisible = false;

  constructor(view: EditorView) {
    this.view = view;
    this.query = getSearchQuery(view.state);

    this.findField = document.createElement("input");
    this.findField.type = "text";
    this.findField.className = "md-search__input";
    this.findField.placeholder = "查找";
    this.findField.setAttribute("main-field", "true"); // CM 打开面板时聚焦此输入
    this.findField.setAttribute("aria-label", "查找");
    this.findField.addEventListener("input", () => this.commit());

    this.countEl = document.createElement("span");
    this.countEl.className = "md-search__count";

    this.replaceField = document.createElement("input");
    this.replaceField.type = "text";
    this.replaceField.className = "md-search__input";
    this.replaceField.placeholder = "替换为";
    this.replaceField.setAttribute("aria-label", "替换为");
    this.replaceField.addEventListener("input", () => this.commit());

    const findRow = document.createElement("div");
    findRow.className = "md-search__row";
    findRow.append(
      this.findField,
      this.countEl,
      this.sep(),
      this.toggle("Aa", "区分大小写", "caseSensitive"),
      this.toggle(".*", "正则表达式", "regexp"),
      this.toggle("W", "全词匹配", "wholeWord"),
      this.sep(),
      this.button("↑", "上一个（Shift+Enter）", () => findPrevious(view)),
      this.button("↓", "下一个（Enter）", () => findNext(view)),
      (this.replaceToggle = this.button("替换", "展开替换（Ctrl+H）", () => this.setReplaceVisible(!this.replaceVisible))),
      this.button("✕", "关闭（Esc）", () => closeSearchPanel(view)),
    );

    this.replaceRow = document.createElement("div");
    this.replaceRow.className = "md-search__row";
    this.replaceRow.append(
      this.replaceField,
      this.button("替换", "替换当前（Enter）", () => replaceNext(view)),
      this.button("全部替换", "替换全部匹配", () => replaceAll(view)),
    );

    this.dom = document.createElement("div");
    this.dom.className = "md-search";
    this.dom.setAttribute("role", "search");
    this.dom.append(findRow, this.replaceRow);
    this.dom.addEventListener("keydown", (e) => this.onKeydown(e));

    activePanel = this;
    this.setReplaceVisible(openWithReplace);
    this.syncFrom(this.query);
  }

  // ---------- DOM 工具 ----------

  private sep(): HTMLElement {
    const el = document.createElement("span");
    el.className = "md-search__sep";
    return el;
  }

  private button(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "md-search__btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  private toggle(label: string, title: string, key: ToggleKey): HTMLButtonElement {
    const b = this.button(label, title, () => {
      this.opt[key] = !this.opt[key];
      this.commit();
    });
    b.className = "md-search__btn md-search__toggle";
    b.setAttribute("aria-pressed", "false");
    this.toggles.push({ key, btn: b });
    return b;
  }

  // ---------- 状态同步 ----------

  /** 输入 → 查询状态（高亮与计数随之更新） */
  private commit() {
    const q = new SearchQuery({
      search: this.findField.value,
      caseSensitive: this.opt.caseSensitive,
      regexp: this.opt.regexp,
      wholeWord: this.opt.wholeWord,
      replace: this.replaceField.value,
    });
    if (q.eq(this.query)) return;
    this.query = q;
    this.view.dispatch({ effects: setSearchQuery.of(q) });
    this.updateCount();
  }

  /** 查询状态 → 输入（外部改动：带入选区词、Mod-f 重复触发等；值相同则不动，避免光标跳动） */
  private syncFrom(q: SearchQuery) {
    if (this.findField.value !== q.search) this.findField.value = q.search;
    if (this.replaceField.value !== q.replace) this.replaceField.value = q.replace;
    this.opt = { caseSensitive: q.caseSensitive, regexp: q.regexp, wholeWord: q.wholeWord };
    for (const { key, btn } of this.toggles) btn.setAttribute("aria-pressed", String(this.opt[key]));
    this.updateCount();
  }

  private updateCount(state: EditorState = this.view.state) {
    const q = getSearchQuery(state);
    if (!q.search) return this.setCount("", false);
    if (!q.valid) return this.setCount("正则无效", true);

    const sel = state.selection.main;
    let total = 0;
    let current = 0;
    for (let cur = q.getCursor(state), r = cur.next(); !r.done && total < COUNT_CAP; r = cur.next()) {
      total++;
      if (r.value.from === sel.from && r.value.to === sel.to) current = total;
    }
    if (total === 0) return this.setCount("无结果", true);
    const capped = total >= COUNT_CAP;
    this.setCount(current > 0 ? `${current}/${total}${capped ? "+" : ""}` : `${total}${capped ? "+" : ""} 处`, false);
  }

  private setCount(text: string, warn: boolean) {
    this.countEl.textContent = text;
    this.countEl.classList.toggle("md-search__count--warn", warn);
  }

  setReplaceVisible(visible: boolean) {
    this.replaceVisible = visible;
    this.replaceRow.hidden = !visible;
    this.replaceToggle.setAttribute("aria-pressed", String(visible));
    this.replaceToggle.title = visible ? "收起替换（Ctrl+H）" : "展开替换（Ctrl+H）";
  }

  // ---------- Panel 接口 ----------

  mount() {
    this.findField.select();
  }

  update(update: ViewUpdate) {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) this.syncFrom(effect.value);
      }
    }
    // 计数只在文档/选区/查询变化时重算，滚动等纯视图更新不触发全量扫描
    if (update.docChanged || update.selectionSet) this.updateCount(update.state);
  }

  destroy() {
    if (activePanel === this) activePanel = null;
  }

  /** 面板内快捷键（scope="search-panel"）优先，其次 Enter 走上下一个/替换 */
  private onKeydown(e: KeyboardEvent) {
    if (runScopeHandlers(this.view, e, "search-panel")) {
      e.preventDefault();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.target === this.replaceField) replaceNext(this.view);
    else (e.shiftKey ? findPrevious : findNext)(this.view);
  }
}
