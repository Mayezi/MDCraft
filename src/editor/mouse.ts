// 三击（含四击、五击……疯狂连点）选当前行：
// CM6 默认三击会把换行符一并选入（rangeForClick 中 to++），
// 选中含换行符时高亮会覆盖到下一整行 —— 视觉上即"当前行+下一行"。
// 此处覆盖为 VSCode/记事本习惯：只选当前行；三击后拖动按整行扩展。

import { EditorView } from "@codemirror/view";

/** 按整行扩展选区：anchor/head 分别对齐到 from/to */
function selectLineRange(view: EditorView, pos: number, origin: number) {
  const a = view.state.doc.lineAt(Math.min(pos, origin));
  const b = view.state.doc.lineAt(Math.max(pos, origin));
  view.dispatch({
    selection: { anchor: a.from, head: b.to },
    scrollIntoView: false,
  });
}

export const lineClick = EditorView.domEventHandlers({
  // 注意：domEventHandlers 回调签名是 (event, view)——event 在前
  mousedown(event, view) {
    if (event.button !== 0 || event.detail < 3) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    view.focus();
    selectLineRange(view, pos, pos);
    // 三击后拖动 → 整行块选择
    const move = (e: MouseEvent) => {
      const p = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (p != null) selectLineRange(view, p, pos);
    };
    const up = (e: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      // 阻止浏览器在 click 阶段把 DOM selection 收缩为点击处光标
      // （否则 CM6 的 selectionchange 同步会把我们选好的整行覆盖掉；
      //   CM6 官方 MouseSelection.up 对普通点击也是这么做的）
      e.preventDefault();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up, { once: true });
    return true; // 已处理：阻止 CM6 默认三击（连换行符一起选）
  },
});
