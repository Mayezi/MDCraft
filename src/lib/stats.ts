// 字数统计：CJK 字符按字计，英文按词计（主流编辑器通用口径）

export function countStats(text: string): { words: number; chars: number } {
  const cjkRe = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
  const cjk = (text.match(cjkRe) || []).length;
  const latin = (
    text.replace(cjkRe, " ").match(/[A-Za-z0-9'’_-]+/g) || []
  ).length;
  return { words: cjk + latin, chars: text.replace(/\s/g, "").length };
}
