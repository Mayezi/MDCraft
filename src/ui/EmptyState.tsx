// 无文档时的欢迎页。独立成组件，避免为了显示空状态而加载整个 CodeMirror 编辑器。
// 全部使用主题变量适配（--accent / --bg / --fg 等）；
// 视觉参考设计稿 mdcraft_markdown.html：点阵背景 + 顶部环境光晕 + 三张带角标与迷你示意图的核心卡片。

import { useEffect } from "react";
import { FilePlus2, Zap, Table2, FolderOpen } from "lucide-react";
import { useStore } from "../store";
import * as backend from "../lib/backend";
import { openEditableFile } from "../lib/docActions";
import { dismissBootSplash } from "../lib/boot-splash";
import { APP_VERSION } from "../lib/version";

export default function EmptyState() {
  useEffect(() => {
    dismissBootSplash();
  }, []);

  const openDoc = async () => {
    const picked = await backend.pickOpenFile();
    if (picked) await openEditableFile(picked.path, picked.name);
  };

  return (
    <div className="relative flex flex-1 items-center justify-center bg-[var(--editor-bg)] px-6 text-[var(--fg-soft)]">
      {/* 顶部柔和环境光晕（参考设计稿 Ambient Glow） */}
      <div className="ambient-glow pointer-events-none absolute inset-x-0 top-0 h-80" />
      <div className="relative z-10 w-full max-w-4xl">
        {/* 欢迎标题区 */}
        <div className="mb-8 text-center">
          {/* 品牌徽章：版本号 + 产品定位，样式参考设计稿（版本号随 package.json 手动更新） */}
          <a
            href="https://github.com/Mayezi/MDCraft"
            target="_blank"
            rel="noreferrer"
            title="访问 GitHub 开源仓库"
            onClick={(e) => {
              e.preventDefault();
              void backend.openUrl("https://github.com/Mayezi/MDCraft");
            }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] transition-all hover:border-[var(--accent)]/50 hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <span className="inline-flex items-center justify-center rounded-full bg-[var(--accent)]/10 px-2 py-0.5 font-mono text-[10px] font-semibold leading-none text-[var(--accent)]">
              v{APP_VERSION}
            </span>
            <span className="inline-flex items-center text-[11px] font-medium leading-none text-[var(--fg-faint)]">
              开源块级 Markdown 引擎
            </span>
          </a>
          <p className="text-[26px] font-semibold tracking-tight text-[var(--fg-strong)]">
            开始使用{" "}
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">
              MDCraft
            </span>
          </p>
          <p className="mt-2 text-sm text-[var(--fg-faint)]">
            新建文档，或打开已有 Markdown 文件
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            {/* 主按钮用品牌渐变（与上方 MDCraft 字标同源）：洁白配色的主色是近黑色，
                纯色块在浅色页面上过于生硬，这里固定用品牌蓝紫渐变。 */}
            <button
              onClick={() => useStore.getState().newDoc()}
              className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgba(59,130,246,0.55)] ring-1 ring-inset ring-white/20 transition-[filter,box-shadow] duration-200 hover:brightness-110 hover:shadow-[0_12px_28px_-10px_rgba(79,70,229,0.6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 active:brightness-95 dark:from-blue-500 dark:to-indigo-500"
            >
              <FilePlus2 size={16} />
              新建文档
              <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-white/90 ring-1 ring-inset ring-white/20">
                Ctrl+N
              </kbd>
            </button>
            <button
              onClick={() => void openDoc()}
              className="inline-flex items-center gap-2.5 rounded-xl bg-[var(--bg)] px-6 py-2.5 text-sm font-semibold text-[var(--fg)] ring-1 ring-inset ring-[var(--border)] shadow-[0_8px_20px_-14px_rgba(0,0,0,0.3)] transition-colors duration-200 hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] dark:shadow-[0_8px_20px_-14px_rgba(0,0,0,0.6)]"
            >
              <FolderOpen size={16} />
              打开文档
              <kbd className="rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-[var(--fg-faint)] ring-1 ring-inset ring-[var(--border)]">
                Ctrl+O
              </kbd>
            </button>
          </div>
        </div>

        {/* 三张核心卡片：图标色块 + 右上角角标 + 卡片底部微缩示意图 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* 卡片 1：快速插入（Slash Menu） */}
          <div className="flex flex-col justify-between rounded-2xl bg-[var(--bg)] p-5 shadow-[0_10px_26px_-16px_rgba(0,0,0,0.28)] dark:shadow-[0_10px_26px_-16px_rgba(0,0,0,0.6)] transition-all duration-200 border border-transparent hover:border-[var(--accent)]/40">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200/60 bg-blue-50 font-mono text-sm font-bold text-blue-600 dark:border-blue-800/60 dark:bg-blue-950/60 dark:text-blue-400">
                    /
                  </span>
                  <span className="text-sm font-semibold text-[var(--fg-strong)]">快速插入</span>
                </div>
                <span className="rounded bg-[var(--bg-hover)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">
                  Slash Menu
                </span>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-[var(--fg-faint)]">
                输入{" "}
                <kbd className="kbd-key bg-[var(--bg-hover)] text-[var(--accent)] border border-[var(--border)]">
                  /
                </kbd>{" "}
                唤起智能命令面板，快速插入标题、列表、表格和公式。
              </p>
            </div>
            {/* 微缩斜杠菜单示意图 */}
            <div className="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-2.5 text-[11px]">
              <div className="flex items-center justify-between rounded-md bg-[var(--accent)]/10 px-2 py-1 font-medium text-[var(--accent)]">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] opacity-75">/table</span>
                  <span>插入数据表格</span>
                </span>
                <span className="font-mono text-[10px]">↵</span>
              </div>
              <div className="flex items-center justify-between rounded-md px-2 py-1 text-[var(--fg-faint)]">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] opacity-75">/math</span>
                  <span>LaTeX 数学公式块</span>
                </span>
                <span className="font-mono text-[10px]">$$</span>
              </div>
            </div>
          </div>

          {/* 卡片 2：常用操作（拟物键帽列表） */}
          <div className="flex flex-col justify-between rounded-2xl bg-[var(--bg)] p-5 shadow-[0_10px_26px_-16px_rgba(0,0,0,0.28)] dark:shadow-[0_10px_26px_-16px_rgba(0,0,0,0.6)] transition-all duration-200 border border-transparent hover:border-[var(--accent)]/40">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-200/60 bg-purple-50 text-purple-600 transition-transform group-hover:scale-105 dark:border-purple-800/60 dark:bg-purple-950/60 dark:text-purple-400">
                    <Zap size={15} />
                  </span>
                  <span className="text-sm font-semibold text-[var(--fg-strong)]">常用操作</span>
                </span>
                <span className="rounded bg-[var(--bg-hover)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">
                  Shortcuts
                </span>
              </div>
              {/* 精致拟物键帽列表 */}
              <div className="mt-3">
                {[
                  ["加粗选中文本", "B"],
                  ["斜体强调样式", "I"],
                  ["全文查找与替换", "F"],
                ].map(([label, key]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/60 py-1.5 last:border-b-0"
                  >
                    <span className="text-xs text-[var(--fg-soft)]">{label}</span>
                    <span className="flex items-center gap-1">
                      <kbd className="kbd-key bg-[var(--bg-hover)] text-[var(--fg-soft)] border border-[var(--border)]">Ctrl</kbd>
                      <span className="text-[10px] text-[var(--fg-faint)]">+</span>
                      <kbd className="kbd-key bg-[var(--bg-hover)] text-[var(--fg-soft)] border border-[var(--border)]">{key}</kbd>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 卡片 3：块级内容（KaTeX 微缩渲染预览） */}
          <div className="flex flex-col justify-between rounded-2xl bg-[var(--bg)] p-5 shadow-[0_10px_26px_-16px_rgba(0,0,0,0.28)] dark:shadow-[0_10px_26px_-16px_rgba(0,0,0,0.6)] transition-all duration-200 border border-transparent hover:border-[var(--accent)]/40">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200/60 bg-amber-50 text-amber-600 transition-transform group-hover:scale-105 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-400">
                    <Table2 size={15} />
                  </span>
                  <span className="text-sm font-semibold text-[var(--fg-strong)]">块级内容</span>
                </span>
                <span className="rounded bg-[var(--bg-hover)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">
                  WYSIWYG
                </span>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-[var(--fg-faint)]">
                表格、图片、公式和代码块会直接实时渲染，点击内容即可无缝进入源码编辑。
              </p>
            </div>
            {/* 微缩块级渲染预览示意图 */}
            <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-2.5 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600 dark:text-amber-400">
                  KaTeX
                </span>
                <span className="font-serif italic text-[var(--fg)]">f(x) = ∫ e⁻ˣ² dx</span>
              </div>
              <span className="font-mono text-[10px] text-[var(--fg-faint)]">$$</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
