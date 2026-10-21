// 应用版本号：构建时由 vite 从 package.json 注入（vite.config.ts 的 __APP_VERSION__ define）
// UI 各处显示版本统一引用这里，避免多处写死漂移。
declare const __APP_VERSION__: string;

/** 当前应用版本号（无前缀，如 "0.15.11"） */
export const APP_VERSION: string = __APP_VERSION__;