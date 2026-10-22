// 底部状态栏：左下角侧栏开关 + 源码模式开关 + 光标位置 + 字数统计

import { useStore } from "../store";
import { PanelLeft, Code2 } from "lucide-react";
import { APP_VERSION } from "../lib/version";
import { THEME_PALETTES } from "../lib/types";

export default function StatusBar() {
  const status = useStore((s) => s.status);
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSettings);
  const docs = useStore((s) => s.docs);
  const activeDocId = useStore((s) => s.activeDocId);
  const active = docs.find((d) => d.id === activeDocId);

  const btnCls = (activeState: boolean) =>
    `flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors ${
      activeState
        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
        : "text-[var(--fg-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
    }`;

  return (
    <div className="flex h-full shrink-0 select-none items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-soft)] px-3 text-[11px] text-[var(--fg-faint)]">
      <div className="flex items-center gap-1">
        <button
          title="侧边栏"
          className={btnCls(settings.sidebarVisible)}
          onClick={() => set({ sidebarVisible: !settings.sidebarVisible } as never)}
        >
          <PanelLeft size={16} />
        </button>
        <button
          title="源码模式 (Ctrl+/)：全文档显示 Markdown 源码"
          className={btnCls(settings.sourceMode)}
          onClick={() => set({ sourceMode: !settings.sourceMode })}
        >
          <Code2 size={16} />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center">
        第 {status.line} 行，第 {status.col} 列
      </div>
      <div className="flex items-center gap-3">
        <span>{status.words} 词</span>
        <span>{status.chars} 字符</span>
        <span className="h-3 w-px bg-[var(--border)]" />
        <span title={active?.path ?? "未保存草稿"} className="max-w-40 truncate">
          {active ? (active.path ? active.name : "草稿") : "-"}
        </span>
        <span className="h-3 w-px bg-[var(--border)]" />
        <span>{THEME_PALETTES.find((p) => p.id === settings.palette)?.label ?? ""}</span>
        <span>v{APP_VERSION}</span>
      </div>
    </div>
  );
}
