// 编辑器加载动画：收敛在编辑区域内，替代全屏启动遮罩的 loader。
// 骨架（工具栏/侧栏等）先就绪淡出遮罩，此组件承载唯一加载指示，
// 编辑器及周边组件就绪后由父级淡出移除。
// 品牌视觉（图标 + 渐变标题 + 副标题 + 光束进度条）与启动加载页保持一致，
// 复用 index.html 中定义的 boot-* 全局样式类。

export default function EditorLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[var(--bg)]">
      <div className="boot-card">
        <div className="boot-brand">
          <img className="boot-logo" src="/app-icon.png" alt="MDCraft" draggable={false} />
          <div className="boot-title-group">
            <div className="boot-title">MDCraft</div>
            <div className="boot-subtitle">开源 · 所见即所得</div>
          </div>
        </div>
        <div className="loading-core" aria-hidden="true">
          <div className="loading-beam"></div>
        </div>
        <div className="boot-hint">正在加载编辑器…</div>
      </div>
    </div>
  );
}