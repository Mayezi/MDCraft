// 右侧 minimap（@batchfy/codemirror-minimap）的装配与主题同步。
// 扩展自身只在 .cm-editor 的 class 变化时重测字体/颜色，而 MDCraft 的主题、
// 字号、行高走 html 上的 data-theme / CSS 变量，因此需要主动触发一次重绘。

import { EditorView, ViewPlugin } from "@codemirror/view";
import { showMinimap } from "@batchfy/codemirror-minimap";

/** 主题或排版变化后强制扩展重新测量（它用 editor 根节点的 class 集合判断主题变化） */
const refreshOnThemeChange = ViewPlugin.fromClass(
  class {
    private observer: MutationObserver;
    private tick = 0;
    private destroyed = false;

    public constructor(private view: EditorView) {
      this.observer = new MutationObserver(() => this.refresh());
      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "style"],
      });
    }

    private refresh() {
      if (this.destroyed) return;
      const prev = this.tick % 2;
      const next = (this.tick + 1) % 2;
      this.view.dom.classList.remove(`cm-minimap-refresh-${prev}`);
      this.view.dom.classList.add(`cm-minimap-refresh-${next}`);
      this.tick += 1;
      this.view.dispatch({});
    }

    public destroy() {
      this.destroyed = true;
      this.observer.disconnect();
    }
  },
);

/**
 * 视窗框的固定高度（px）。
 *
 * 扩展按「屏幕上实际有多少文档行 × 行高」算框高；Markdown 软换行让同一屏
 * 里的文档行数随滚动位置上下浮动，框就忽高忽低。这里直接锁定成一个绝对值，
 * 与文档长短、换行、窗口高度都无关。
 *
 * 高度由 editor.css 里的 CSS 变量（!important）兜底，扩展每次重写内联样式
 * 都覆盖不掉。
 */
const OVERLAY_HEIGHT = 120;

/**
 * 视窗框的定位与拖动（按滚动像素比例，不用扩展的行号映射）。
 *
 * 扩展的几何计算假设「每行等高」：它先把屏幕上的文档行数换算成行号，再用
 * 行号反推滚动位置。源码模式下这个假设成立；预览模式里表格、代码块、公式
 * 块是整块 widget，加上正文软换行，一屏能容纳的文档行数远少于「视口高度 /
 * 行高」，于是：
 *   - 滚到后段时行号进度提前饱和，框提前贴底，最后一段滚动框不动（看起来卡住）；
 *   - 拖动框时行号映射到不了文档末尾，拖到底也滚不到底。
 *
 * 这里统一改成和浏览器滚动条一样的像素比例：框高固定，框顶 = 滚动进度 ×
 * 可移动距离；拖动时直接按指针位移换算 scrollTop。与文档行数、是否预览无关。
 */
const fixedOverlayHeight = ViewPlugin.fromClass(
  class {
    private overlay: HTMLElement | null = null;
    private container: HTMLElement | null = null;
    private observer: MutationObserver | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private frame: number | null = null;
    private dragging = false;
    private dragStartY = 0;
    private dragStartScroll = 0;
    private dragRatio = 0;
    private destroyed = false;
    private retries = 0;

    private readonly onScroll = () => this.schedule();

    /** 只接管「按在框上」的拖动；点在缩略图其他位置仍交给扩展跳转 */
    private readonly onMouseDown = (event: MouseEvent) => {
      const overlay = this.overlay;
      if (event.button !== 0 || !overlay || event.target !== overlay) return;

      const scroller = this.view.scrollDOM;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const track = this.container?.clientHeight ?? 0;
      const travel = track - Math.min(OVERLAY_HEIGHT, track);
      if (max <= 0 || travel <= 0) return;

      event.preventDefault();
      // 阻断扩展自己的行号拖动（它挂在同一个容器的冒泡阶段）
      event.stopPropagation();

      this.dragging = true;
      this.dragStartY = event.clientY;
      this.dragStartScroll = scroller.scrollTop;
      this.dragRatio = max / travel;

      this.container?.classList.add("cm-minimap-overlay-active");
      document.body.style.cursor = "grabbing";
      window.addEventListener("mousemove", this.onMouseMove);
      window.addEventListener("mouseup", this.onMouseUp);
    };

    private readonly onMouseMove = (event: MouseEvent) => {
      if (!this.dragging) return;
      event.preventDefault();

      const scroller = this.view.scrollDOM;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const next =
        this.dragStartScroll + (event.clientY - this.dragStartY) * this.dragRatio;
      scroller.scrollTop = Math.min(max, Math.max(0, next));
    };

    private readonly onMouseUp = () => this.endDrag();

    public constructor(private view: EditorView) {
      // CSS 变量作为单一样式来源；editor.css 里另有同名兜底值
      this.view.dom.style.setProperty(
        "--mdcraft-minimap-overlay-height",
        `${OVERLAY_HEIGHT}px`,
      );
      this.attach();
    }

    private attach() {
      if (this.destroyed) return;

      this.overlay = this.view.dom.querySelector<HTMLElement>(
        ".cm-minimap-overlay",
      );
      if (!this.overlay) {
        // Overlay 插件通常先于本插件创建；顺序若变，下一帧再找一次
        if (this.retries < 3) {
          this.retries += 1;
          requestAnimationFrame(() => this.attach());
        }
        return;
      }
      this.container = this.overlay.parentElement;

      // 扩展每次更新或滚动都会重写 top，写完跟着校正；高度已被 CSS 锁死
      this.observer = new MutationObserver(() => this.sync());
      this.observer.observe(this.overlay, {
        attributes: true,
        attributeFilter: ["style"],
      });

      // 滚动本身不一定让扩展写样式（同一行内 top 不变），自己也要跟
      this.view.scrollDOM.addEventListener("scroll", this.onScroll, {
        passive: true,
      });
      // 窗口尺寸变化不一定触发扩展重写样式
      this.resizeObserver = new ResizeObserver(() => this.sync());
      this.resizeObserver.observe(this.view.scrollDOM);
      this.container?.addEventListener("mousedown", this.onMouseDown, true);

      this.sync();
    }

    /** 编辑器更新后滚动高度可能变化，下一帧重新定位 */
    public update() {
      this.schedule();
    }

    private schedule() {
      if (this.frame !== null || this.destroyed) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.sync();
      });
    }

    private sync() {
      const overlay = this.overlay;
      const track = this.container?.clientHeight ?? 0;
      if (!overlay || !track) return;

      const scroller = this.view.scrollDOM;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const travel = Math.max(0, track - Math.min(OVERLAY_HEIGHT, track));
      const progress =
        max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 0;
      const topPx = `${Math.round(progress * travel * 100) / 100}px`;

      // 库每次滚动/更新都会用「行号映射」重写内联 top；预览模式遇到高块
      // （表格/代码块/长徽章行）时，行号 top 与像素 top 偏差极大，未及覆盖
      // 的那一帧会让框瞬时往下跳出很长一截。这里用 !important 压过库写入，
      // 让定位只认像素比例（与文档行数、是否预览无关），消除这个竞态。
      this.observer?.disconnect();
      overlay.style.setProperty("top", topPx, "important");
      // 断开期间正好抑制自身写入再触发 observer 的死循环；重挂后由库后续
      // 写入（或滚动/缩放）再次触发本方法校正。
      this.observer?.observe(overlay, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }

    private endDrag() {
      if (!this.dragging) return;
      this.dragging = false;
      this.container?.classList.remove("cm-minimap-overlay-active");
      document.body.style.removeProperty("cursor");
      window.removeEventListener("mousemove", this.onMouseMove);
      window.removeEventListener("mouseup", this.onMouseUp);
    }

    public destroy() {
      this.destroyed = true;
      this.endDrag();
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.observer?.disconnect();
      this.resizeObserver?.disconnect();
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      this.container?.removeEventListener("mousedown", this.onMouseDown, true);
      this.overlay = null;
      this.container = null;
    }
  },
);

export const minimap = [
  showMinimap.compute(["doc"], () => ({
    create: () => ({ dom: document.createElement("div") }),
    // 保留编辑器原生滚动条，不随 minimap 一起隐藏
    hideScrollbar: false,
  })),
  refreshOnThemeChange,
  fixedOverlayHeight,
];
