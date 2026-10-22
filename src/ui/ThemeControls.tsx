// 外观控件：主题模式（浅色/深色）与配色主题（每项前带色块）。
// 两个维度相互独立，与 dbx 的「颜色主题」一致。

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useStore } from "../store";
import { THEME_MODES, THEME_PALETTES } from "../lib/types";

/** 配色色块：名称前的小圆点 */
export function PaletteDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-3 w-3 shrink-0 rounded-full border border-[var(--border)] shadow-xs"
      style={{ background: color }}
    />
  );
}

/** 主题模式分段按钮 */
export function ThemeModeSwitch() {
  const themeMode = useStore((s) => s.settings.themeMode);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="inline-flex rounded-md border border-[var(--border)] p-0.5">
      {THEME_MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          onClick={() => setSettings({ themeMode: mode.id })}
          className={`rounded px-2.5 py-1 text-[11.5px] transition-colors ${
            themeMode === mode.id
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : "text-[var(--fg-soft)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

/** 配色主题下拉：选中项显示色块 + 名称 */
export function ThemePaletteSelect() {
  const palette = useStore((s) => s.settings.palette);
  const setSettings = useStore((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = THEME_PALETTES.find((item) => item.id === palette) ?? THEME_PALETTES[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative w-52">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] px-2 text-[12.5px] text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        <PaletteDot color={current.color} />
        <span className="flex-1 truncate text-left">{current.label}</span>
        <ChevronDown size={14} className="shrink-0 text-[var(--fg-faint)]" />
      </button>
      {open && (
        <div
          role="listbox"
          className="ui-pop absolute right-0 top-full z-50 mt-1 max-h-[260px] w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
        >
          {THEME_PALETTES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === palette}
              onClick={() => {
                setSettings({ palette: item.id });
                setOpen(false);
              }}
              className="flex min-h-[28px] w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              <PaletteDot color={item.color} />
              <span className="flex-1 truncate">{item.label}</span>
              {item.id === palette && <Check size={13} className="shrink-0 text-[var(--accent)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
