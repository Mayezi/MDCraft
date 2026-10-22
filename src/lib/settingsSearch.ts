// 设置项搜索：把输入切成词元，命中任一词元即算匹配（命中多的排前面）。
// 中文没有空格分词，词元内部再做一次「逐字」降级匹配（如「深色模式」能命中「主题模式 / 浅色 / 深色」）。

export interface SettingsSearchable {
  /** 设置项唯一 id（同时作为 DOM 锚点，搜索结果点击后定位到它） */
  id: string;
  /** 设置项标题 */
  title: string;
  /** 设置项说明 */
  description?: string;
  /** 额外搜索词：标题与说明里没写出来的同义词 */
  keywords?: string[];
}

/** 是否含中日韩字符 */
function hasCjk(text: string): boolean {
  return /[一-鿿㐀-䶿]/.test(text);
}

/**
 * 词元命中判定：
 * 1. 整串包含；
 * 2. 中文词元降级——每个字都在文本里出现过即算命中（不要求相邻，也不要求顺序）。
 *    「深色模式」能命中「主题模式 / 浅色 / 深色」这类标题与说明。
 */
function tokenHits(token: string, haystack: string): boolean {
  if (haystack.includes(token)) return true;
  if (!hasCjk(token)) return false;
  return [...token].every((ch) => haystack.includes(ch));
}

/**
 * 按空白分词匹配：命中任一词元即算匹配，命中词元多的排前面（相同命中数保持原顺序）。
 * 空查询返回空数组。
 */
export function matchSettingsRows<T extends SettingsSearchable>(
  query: string,
  rows: readonly T[],
): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { row: T; hits: number }[] = [];
  for (const row of rows) {
    const haystack = [row.title, row.description ?? "", ...(row.keywords ?? [])]
      .join(" ")
      .toLowerCase();
    const hits = tokens.filter((token) => tokenHits(token, haystack)).length;
    if (hits > 0) scored.push({ row, hits });
  }
  return scored
    .sort((a, b) => b.hits - a.hits)
    .map((entry) => entry.row);
}
