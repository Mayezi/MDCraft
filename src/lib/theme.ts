// 外观应用层：主题模式（浅色/深色/跟随系统）与配色方案是两个独立维度，
// 对齐 dbx 的 useTheme + appTheme：模式决定深浅，配色决定色板。
// 两者最终写到 <html> 的 data-theme-mode / data-palette 上，由 CSS 变量接管。

import { THEME_PALETTES, type ThemeMode, type ThemePalette } from "./types";

/** localStorage 键 */
export const THEME_MODE_KEY = "mdcraft:theme-mode";
export const THEME_PALETTE_KEY = "mdcraft:theme-palette";

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function normalizeThemePalette(value: unknown): ThemePalette {
  return THEME_PALETTES.some((palette) => palette.id === value)
    ? (value as ThemePalette)
    : "pearl";
}

/** system 模式解析为实际深浅 */
export function resolveThemeAppearance(
  mode: ThemeMode,
  prefersDark: boolean,
): "light" | "dark" {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

export function prefersDarkScheme(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 把模式与配色写到 <html>（深浅已解析，system 不落到 DOM 上） */
export function applyThemeAttributes(mode: ThemeMode, palette: ThemePalette): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const appearance = resolveThemeAppearance(mode, prefersDarkScheme());
  root.dataset.themeMode = appearance;
  root.dataset.palette = palette;
  root.style.colorScheme = appearance;
}

/** 监听系统深浅变化（跟随系统模式下需要重新应用） */
export function onSystemThemeChange(handler: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => handler();
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
