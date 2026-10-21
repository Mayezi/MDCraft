// 首屏启动画面：index.html 里的静态占位（单窗口无缝启动）。
// 主窗口首帧即显示，画面为 index.html 内全屏启动遮罩（与主界面同尺寸、同位置），
// 加载完成即进入（无人为延时）：遮罩淡出与主界面内容淡入交叉进行 ——
// 启动画面渐隐、编辑区浮现，全程无窗口切换、无大小跳变。
// 浏览器与桌面（Tauri）走同一逻辑：只需淡出移除页面内启动层。

let splashFading = false;

/** 交叉淡化：遮罩渐隐 + 主界面内容淡入，随后移除遮罩节点（幂等，供多处调用兜底） */
function fadeOutSplash(splash: HTMLElement) {
  if (splashFading) return;
  splashFading = true;
  // 主界面内容淡入（与遮罩淡出同时进行：启动画面渐隐，编辑区浮现）
  const app = document.getElementById("root")?.firstElementChild;
  if (app instanceof HTMLElement) app.classList.add("app-enter");
  splash.classList.add("is-done");
  window.setTimeout(() => splash.remove(), 300);
}

export function dismissBootSplash() {
  const splash = document.getElementById("boot-splash");
  if (splash) fadeOutSplash(splash);
}