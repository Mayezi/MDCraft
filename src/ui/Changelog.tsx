// 更新公告渲染：Markdown → 富文本，含复制说明与系统浏览器外链拦截。
// 更新弹窗与设置面板「更新」页共用。

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { marked } from "marked";
import { openUrl } from "../lib/backend";

export function MarkdownChangelog({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const html = useMemo(() => {
    if (!content) return "";
    try {
      return marked.parse(content, { async: false, gfm: true, breaks: true }) as string;
    } catch {
      return content;
    }
  }, [content]);

  // 拦截所有的 a 标签点击，通过 openUrl 在默认系统浏览器中打开
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleLinkClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("a");
      if (target && target.href) {
        e.preventDefault();
        void openUrl(target.href);
      }
    };
    el.addEventListener("click", handleLinkClick);
    return () => el.removeEventListener("click", handleLinkClick);
  }, [html]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="relative group/notes">
      <div className="absolute right-3 top-3 z-10 opacity-75 transition-opacity hover:opacity-100 group-hover/notes:opacity-100">
        <button
          type="button"
          onClick={handleCopy}
          title="复制更新日志 Markdown"
          className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--fg-soft)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-500" />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>复制说明</span>
            </>
          )}
        </button>
      </div>

      <div
        ref={containerRef}
        dangerouslySetInnerHTML={{ __html: html }}
        className="changelog-markdown max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-soft)]/50 p-4 text-xs leading-relaxed text-[var(--fg)] selection:bg-[var(--accent)]/20"
      />
    </div>
  );
}
