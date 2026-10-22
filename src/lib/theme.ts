// 外观应用层：主题模式（浅色/深色）与配色方案是两个独立维度，
// 对齐 dbx 的 useTheme + appTheme：模式决定深浅，配色决定色板。
// 两者最终写到 <html> 的 data-theme-mode / data-palette 上，由 CSS 变量接管。

import { THEME_PALETTES, type ThemeMode, type ThemePalette } from "./types";

/** localStorage 键 */
export const THEME_MODE_KEY = "mdcraft:theme-mode";
export const THEME_PALETTE_KEY = "mdcraft:theme-palette";

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "dark" ? "dark" : "light";
}

export function normalizeThemePalette(value: unknown): ThemePalette {
  return THEME_PALETTES.some((palette) => palette.id === value)
    ? (value as ThemePalette)
    : "pearl";
}

export function prefersDarkScheme(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * 迁移用：旧的「跟随系统」（system）与未设置过的值，统一按当前系统偏好
 * 落成固定的浅色/深色，之后不再随系统变化。
 */
export function resolveLegacyThemeMode(value: unknown): ThemeMode {
  if (value === "light" || value === "dark") return value;
  return prefersDarkScheme() ? "dark" : "light";
}

/** 把模式与配色写到 <html> */
export function applyThemeAttributes(mode: ThemeMode, palette: ThemePalette): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.dataset.palette = palette;
  root.style.colorScheme = mode;
}
