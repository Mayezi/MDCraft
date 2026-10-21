// 自绘 tooltip（替换原生 title）：加粗、跟随主题、带 250ms 延迟淡入。
// 用于工具栏右侧图标与窗口控制按钮的 hover 提示；
// 始终渲染 + opacity 过渡，点击打开菜单时会被下层菜单浮层覆盖。

import { useState, type ReactNode } from "react";

interface Props {
  content: string;
  children: ReactNode;
  align?: "center" | "right";
}

export default function Tooltip({ content, children, align = "center" }: Props) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(false)}
    >
      {children}
      {content && (
        <span
          role="tooltip"
          aria-hidden={!show}
          className={`pointer-events-none absolute top-full z-50 mt-1.5 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] font-semibold text-[var(--fg)] shadow-[0_4px_12px_rgba(0,0,0,0.18)] transition-opacity duration-150 ease-out ${
            align === "right" ? "right-0" : "left-1/2 -translate-x-1/2"
          } ${show ? "opacity-100 delay-[250ms]" : "opacity-0 delay-0"}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}