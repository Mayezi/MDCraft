// 应用图标：直接用 public/app-icon.png（窗口图标、启动画面同源，保证一模一样）。
// 目录树里的 .md 文件用它代替通用文件图标，一眼认出是 Markdown 文档。
//
// 说明：图标是位图，缩到 16px 时内部的三条文本行会并成浅灰底纹，
// 整体轮廓（圆角方块 + 「M↓」）仍清晰可辨。

export default function AppIcon({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/app-icon.png"
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
