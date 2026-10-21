//! 文件变更监听（notify），事件经 channel 传递，供上层 Tauri 事件转发

use notify::{recommended_watcher, Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};

pub struct FsEvent {
    pub kind: String,
    pub path: String,
}

pub struct FsWatcher {
    _watcher: RecommendedWatcher,
    pub rx: Receiver<FsEvent>,
}

/// 递归监听目录，事件推送到 channel（上层自行去抖）
pub fn watch(root: &Path) -> Result<FsWatcher, notify::Error> {
    let (tx, rx) = channel::<FsEvent>();
    let mut watcher = recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(ev) = res {
            let kind = format!("{:?}", ev.kind);
            for p in &ev.paths {
                let _ = tx.send(FsEvent {
                    kind: kind.clone(),
                    path: p.to_string_lossy().into_owned(),
                });
            }
        }
    })?;
    watcher.configure(Config::default().with_poll_interval(std::time::Duration::from_millis(500)))?;
    watcher.watch(root, RecursiveMode::Recursive)?;
    Ok(FsWatcher { _watcher: watcher, rx })
}
