// 自绘窗口控制按钮（最小化 / 最大化还原 / 关闭）：
// 无边框窗口（decorations:false）下替代系统标题栏按钮，置于工具栏最右侧（主题/设置之后）。
// 仅桌面（Tauri）渲染；浏览器模式返回 null。
// 最大化状态经窗口 onResized 监听，图标在「最大化/还原」间切换。

import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import * as backend from "../lib/backend";
import Tooltip from "./Tooltip";

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!backend.isTauri) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        if (disposed) return;
        setMaximized(await win.isMaximized());
        unlisten = await win.onResized(async () => {
          if (!disposed) setMaximized(await win.isMaximized());
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!backend.isTauri) return null;

  const run = (fn: "minimize" | "toggleMaximize" | "close") => {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow()[fn]())
      .catch(() => {});
  };

  const ctl =
    "flex w-11 items-center justify-center text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)] active:[&_svg]:scale-90";

  return (
    <div className="flex items-stretch self-stretch">
      <Tooltip content="最小化" align="right">
        <button aria-label="最小化" onClick={() => run("minimize")} className={ctl}>
          <Minus size={15} className="transition-transform duration-200" />
        </button>
      </Tooltip>
      <Tooltip content={maximized ? "还原" : "最大化"} align="right">
        <button
          aria-label={maximized ? "还原" : "最大化"}
          onClick={() => run("toggleMaximize")}
          className={ctl}
        >
          {maximized ? <Copy size={12} className="transition-transform duration-200" /> : <Square size={12} className="transition-transform duration-200" />}
        </button>
      </Tooltip>
      <Tooltip content="关闭" align="right">
        <button
          aria-label="关闭"
          onClick={() => run("close")}
          className={`${ctl} hover:bg-red-500 hover:text-white`}
        >
          <X size={15} className="transition-transform duration-200" />
        </button>
      </Tooltip>
    </div>
  );
}