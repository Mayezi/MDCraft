// 打开方式对话框：编辑器打不开的文件（exe / pdf / zip 等）交由用户选打开方式。
//
// 提供四条路径：
//   · 用默认程序打开 —— 走系统关联的程序（cmd start / open / xdg-open）
//   · 选择其它应用… —— 拉起系统原生的「选择应用」框（Windows: OpenAs_RunDLL）
//   · 在文件夹中显示 —— 系统文件管理器定位
//   · 复制路径
// 仅桌面模式有效（浏览器模式无法调起系统程序）。

import { useEffect, useRef, useState } from "react";
import { AppWindow, Check, Copy, FolderOpen, Play, X } from "lucide-react";
import * as backend from "../lib/backend";
import { fileIcon } from "./fileIcons";

export default function OpenWithDialog({
  path,
  name,
  onClose,
}: {
  path: string;
  name: string;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 聚焦对话框本身（避免鼠标打开时按钮出现焦点环）
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  // Esc 关闭（捕获阶段优先，避免冒泡到编辑器）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const openDefault = async () => {
    setError(null);
    try {
      await backend.openPath(path);
      onClose();
    } catch (e) {
      setError(`用默认程序打开失败：${String(e)}。可改用「选择其它应用…」。`);
    }
  };

  const chooseApp = async () => {
    setError(null);
    try {
      await backend.openWith(path);
    } catch (e) {
      setError(`系统「选择应用」框启动失败：${String(e)}`);
    }
  };

  const reveal = async () => {
    setError(null);
    try {
      await backend.showInFolder(path);
      onClose();
    } catch (e) {
      setError(`在文件夹中显示失败：${String(e)}`);
    }
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("复制路径失败");
    }
  };

  const Icon = fileIcon(name);
  const items = [
    {
      icon: Play,
      label: "用默认程序打开",
      hint: "按系统关联的程序打开",
      onClick: () => void openDefault(),
    },
    {
      icon: AppWindow,
      label: "选择其它应用…",
      hint: "打开系统「选择应用」对话框",
      onClick: () => void chooseApp(),
    },
    {
      icon: FolderOpen,
      label: "在文件夹中显示",
      hint: "在系统文件管理器中定位",
      onClick: () => void reveal(),
    },
    {
      icon: copied ? Check : Copy,
      label: copied ? "路径已复制" : "复制路径",
      hint: path,
      onClick: () => void copyPath(),
    },
  ];

  return (
    <div
      className="modal-overlay fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="打开方式"
        className="modal-card w-[380px] max-w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-[0_16px_48px_rgba(0,0,0,0.25)] outline-none"
      >
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-3.5">
          <Icon size={22} className="mt-0.5 shrink-0 text-[var(--fg-soft)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium text-[var(--fg-strong)]">{name}</div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--fg-faint)]" title={path}>
              {path}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--fg-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-2">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <item.icon size={15} className="shrink-0 text-[var(--fg-faint)]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-[var(--fg)]">{item.label}</span>
                <span className="block truncate text-[11px] text-[var(--fg-faint)]">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>

        {error && (
          <div className="border-t border-[var(--border)] px-4 py-2.5 text-[11.5px] leading-5 text-[var(--danger)]">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end border-t border-[var(--border)] px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-[var(--border)] px-3 py-1 text-[12px] text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
