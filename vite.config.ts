import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import pkg from "./package.json" with { type: "json" };

// Tauri 集成：固定端口 + 环境感知（TAURI_ENV_PLATFORM 时启用 Tauri 特定配置）
// 端口策略：本地开发环境恢复默认 5173（与 package.json 的版本号来源一致）；云端构建环境感知 DEFAULT_APP_PORT (3000)
const isCloudEnv = Boolean(process.env.DEFAULT_APP_PORT);
const port = isCloudEnv ? Number(process.env.DEFAULT_APP_PORT) : 5173;
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // 构建时注入应用版本号（来源 package.json），供 UI 显示；不再手工维护多处写死的版本串
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  // 编辑器/导出依赖靠动态 import 拆包，不再手工 manualChunks：
  // 手工分包会把 Vite 的 preload helper 塞进 codemirror chunk，反而被入口静态导入。
  build: {
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port,
    strictPort: true,
    host: host || (isCloudEnv ? "0.0.0.0" : false),
    allowedHosts: true,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/crates/**"] },
  },
});
