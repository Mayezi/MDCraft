// 全局错误浮层：window error / unhandledrejection / React 渲染错误统一呈现。
// DOM 直接插在 document.body（不经 React root）——即使 React 崩溃白屏，浮层仍然可见可反馈。

let installed = false;

/** 最多保留最近 N 条错误 */
const MAX = 3;
const items: { id: number; title: string; detail: string }[] = [];
let seq = 0;
let host: HTMLElement | null = null;

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function render() {
  if (!host) return;
  host.replaceChildren();
  if (!items.length) {
    host.style.display = "none";
    return;
  }
  host.style.display = "";
  for (const item of items) {
    const card = el("div", "err-card");
    const head = el("div", "err-head");
    head.append(
      el("span", "err-badge", "错误"),
      el("span", "err-title", item.title),
    );
    const close = el("button", "err-close", "×");
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "关闭");
    close.onclick = () => {
      const i = items.findIndex((x) => x.id === item.id);
      if (i >= 0) items.splice(i, 1);
      render();
    };
    head.append(close);
    card.append(head);
    if (item.detail) card.append(el("pre", "err-detail", item.detail));
    host.append(card);
  }
}

function ensureHost(): HTMLElement {
  if (!host) {
    host = el("div", "err-reporter");
    host.style.display = "none";
    document.body.append(host);
  }
  return host;
}

/** 显示一条错误（去重：同标题只保留最新） */
export function showError(title: string, detail = ""): void {
  ensureHost();
  const at = items.findIndex((x) => x.title === title);
  if (at >= 0) items.splice(at, 1);
  items.unshift({ id: ++seq, title, detail });
  if (items.length > MAX) items.length = MAX;
  render();
}

/** 挂 window 级监听（幂等；main.tsx 启动时调用） */
export function installErrorReporter(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (event) => {
    if (event.error instanceof Error) {
      showError(event.message, event.error.stack ?? "");
    } else {
      showError(event.message || "未知脚本错误");
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    showError(message, reason instanceof Error ? (reason.stack ?? "") : "");
  });
}