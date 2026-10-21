// React 渲染错误边界：崩溃时上报到全局错误浮层（error-reporter），
// 页面本身显示一个可恢复的错误态，而不是整树卸载变白屏。

import { Component, type ReactNode } from "react";
import { showError } from "../lib/error-reporter";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? "") : "";
    showError(message, stack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <div>
            <p className="text-[15px] font-medium text-[var(--fg)]">界面出现异常</p>
            <p className="mt-2 text-[12px] text-[var(--fg-faint)]">错误详情见右下角提示；刷新页面即可恢复</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 cursor-pointer rounded-md bg-[var(--accent)] px-4 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}