// 「此文件不支持直接打开」提示的状态仓库。
//
// 背景：图片、程序、无扩展名等文件被按文本读取会在编辑器里显示乱码。
// 这类文件一律不由编辑器接管，改由弹窗提示并把「选择打开方式」交给系统。

import { useEffect, useState } from "react";

let current: string | null = null;
const listeners = new Set<(path: string | null) => void>();

function emit(path: string | null) {
  listeners.forEach((fn) => fn(path));
}

/** 提示：该文件无法在编辑器中直接打开，可由用户自选程序打开 */
export function showUnsupportedFile(path: string): void {
  current = path;
  emit(path);
}

/** 关闭提示 */
export function closeUnsupportedFile(): void {
  if (!current) return;
  current = null;
  emit(null);
}

/** React hook 订阅待提示的文件路径（null = 无） */
export function useUnsupportedFile(): string | null {
  const [path, setPath] = useState<string | null>(current);
  useEffect(() => {
    const fn = (next: string | null) => setPath(next);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return path;
}
