// 应用内轻提示（toast）：替代原生 window.alert。
//
// 原生 alert 在桌面端（WebView）不可靠 —— 弹窗可能不出现、返回值也不可控，
// 错误信息经常整条丢失。统一走这里的通知栈：右下角堆叠、自动消失、可点掉。

import { useEffect, useState } from "react";

export type NotifyKind = "info" | "success" | "error";

export interface Notification {
  id: number;
  kind: NotifyKind;
  message: string;
}

let items: Notification[] = [];
let seq = 0;
const listeners = new Set<(next: Notification[]) => void>();

function emit() {
  const snapshot = items;
  listeners.forEach((fn) => fn(snapshot));
}

/** 弹出一条提示，返回其 id（可用于提前移除） */
export function notify(message: string, kind: NotifyKind = "info"): number {
  const id = ++seq;
  items = [...items, { id, kind, message }];
  emit();
  return id;
}

/** 错误提示（停留更久，便于看清） */
export function notifyError(message: string): number {
  return notify(message, "error");
}

/** 成功提示 */
export function notifySuccess(message: string): number {
  return notify(message, "success");
}

/** 移除指定提示 */
export function dismissNotification(id: number): void {
  if (!items.some((item) => item.id === id)) return;
  items = items.filter((item) => item.id !== id);
  emit();
}

/** 清空全部提示 */
export function clearNotifications(): void {
  if (!items.length) return;
  items = [];
  emit();
}

/** React hook 订阅提示列表 */
export function useNotifications(): Notification[] {
  const [list, setList] = useState<Notification[]>(items);
  useEffect(() => {
    const fn = (next: Notification[]) => setList(next);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return list;
}
