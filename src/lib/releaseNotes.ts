// 按版本号拉取 GitHub Release 的发布说明（应用内「更新公告」）。
// 更新检查拿到的是「最新版」的说明，这里要的是「当前安装版本」自己的说明，故单独按 tag 查询。

import { useEffect, useState } from "react";

const REPO = "Mayezi/MDCraft";

export type ReleaseNotesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; notes: string; date?: string }
  /** 该版本还没有对应的 Release（如尚未发布的开发版） */
  | { status: "missing" }
  | { status: "error"; message: string };

/**
 * 拉取指定版本的发布说明。enabled 为 false 时不发起请求（按需加载，避免每次打开设置都打网络）。
 */
export function useReleaseNotes(version: string, enabled: boolean): ReleaseNotesState {
  const [state, setState] = useState<ReleaseNotesState>({ status: "idle" });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState({ status: "loading" });
    fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`, {
      headers: { Accept: "application/vnd.github.v3+json" },
    })
      .then(async (resp) => {
        if (resp.status === 404) return null;
        if (!resp.ok) throw new Error(`GitHub API HTTP ${resp.status}`);
        const data = (await resp.json()) as { body?: string; published_at?: string };
        return { notes: data.body?.trim() ?? "", date: data.published_at };
      })
      .then((data) => {
        if (!alive) return;
        setState(
          data === null
            ? { status: "missing" }
            : { status: "loaded", notes: data.notes, date: data.date },
        );
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      alive = false;
    };
  }, [version, enabled]);

  return state;
}
