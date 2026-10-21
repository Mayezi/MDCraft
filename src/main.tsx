import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ui/ErrorBoundary";
import { installErrorReporter, showError } from "./lib/error-reporter";
import { useStore } from "./store";
import { isTauri } from "./lib/backend";
import { loadSettingsFile, saveSettingsFile } from "./lib/settingsFile";
import type { Settings } from "./lib/types";

// 在 iframe 环境中避免原生 window.alert / window.open 触发异常
if (typeof window !== "undefined") {
  window.alert = (message?: unknown) => {
    const text = String(message ?? "");
    showError("提示", text);
  };
  const origOpen = window.open;
  window.open = (url?: string | URL, target?: string, features?: string) => {
    try {
      return origOpen ? origOpen.call(window, url, target ?? "_blank", features) : null;
    } catch (e) {
      console.warn("window.open blocked:", e);
      return null;
    }
  };
}
import "./styles/base.css";
import "./styles/editor.css";
import "./styles/slash-icons.css";
import "./styles/themes/github.css";
import "./styles/themes/newsprint.css";
import "./styles/themes/night.css";
import "./styles/themes/pixyll.css";
import "./styles/themes/whitey.css";
import "katex/dist/katex.min.css";

/** 首帧前应用持久化外观，避免主题/自定义字号在 React effect 之前闪一下 */
function applyAppearance(settings: Settings) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  if (settings.fontSize != null) root.style.setProperty("--editor-fs", `${settings.fontSize}px`);
  if (settings.lineHeight != null) root.style.setProperty("--editor-lh", String(settings.lineHeight));
  if (settings.contentWidth != null)
    root.style.setProperty("--editor-maxw", `${settings.contentWidth}px`);
}

async function bootstrap() {
  // 桌面端：等待 mdcraft.json 读入后再渲染，文件优先于 localStorage 缓存；
  // 首次启动（无文件）把当前设置写成初始配置，完成从旧版 localStorage 的迁移。
  if (isTauri) {
    const loaded = await loadSettingsFile();
    if (loaded.status === "loaded") {
      const settings = { ...useStore.getState().settings, ...loaded.settings };
      useStore.setState({ settings });
      // index.html 启动画面的主题脚本只能读 localStorage，这里同步一份主题缓存
      localStorage.setItem("mdcraft:theme", settings.theme);
    } else if (loaded.status === "missing") {
      await saveSettingsFile(useStore.getState().settings);
    }
  }

  applyAppearance(useStore.getState().settings);

  // 全局错误浮层：即使 React 崩溃白屏也能看到错误详情（右下角）
  installErrorReporter();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void bootstrap();
