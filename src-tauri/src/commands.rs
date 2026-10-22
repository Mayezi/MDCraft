// Tauri 命令层：文件读写 / 目录树 / 文件监听

use mdcraft_core::watcher;
use mdcraft_core::{fsutil, workspace};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize)]
pub struct FileContent {
    pub content: String,
    pub path: String,
}

// ---------- 用户配置文件 ----------

/// 配置文件位置：`<系统配置目录>/MDCraft/mdcraft.json`
///（Windows 为 `%APPDATA%\MDCraft\mdcraft.json`）。
fn resolve_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .config_dir()
        .map_err(|e| format!("无法定位配置目录: {e}"))?;
    Ok(dir.join("MDCraft").join("mdcraft.json"))
}

/// 读取配置文件；不存在返回 None（由前端决定是否写入默认值）。
#[tauri::command]
pub fn read_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = resolve_settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fsutil::read_text(&path)
        .map(Some)
        .map_err(|e| format!("读取配置失败: {e}"))
}

/// 原子写入配置文件（自动创建父目录）。
#[tauri::command]
pub fn write_settings(app: AppHandle, content: String) -> Result<(), String> {
    let path = resolve_settings_path(&app)?;
    fsutil::atomic_write(&path, &content).map_err(|e| format!("写入配置失败: {e}"))
}

/// 配置文件绝对路径（设置面板展示 / 定位用）。
#[tauri::command]
pub fn settings_path(app: AppHandle) -> Result<String, String> {
    resolve_settings_path(&app).map(|path| path.to_string_lossy().into_owned())
}

/// 把目录（递归）加进资源协议 scope，供 WebView 经 `convertFileSrc` 读回本地图片。
/// scope 不持久化，重启后由再次打开文件/文件夹时补上。
fn allow_asset_dir(app: &AppHandle, dir: &Path) {
    let _ = app.asset_protocol_scope().allow_directory(dir, true);
}

#[tauri::command]
pub fn open_file(app: AppHandle, path: String) -> Result<FileContent, String> {
    let p = Path::new(&path);
    if let Some(dir) = p.parent() {
        allow_asset_dir(&app, dir);
    }
    let content = fsutil::read_text(p).map_err(|e| format!("读取失败: {e}"))?;
    Ok(FileContent {
        content,
        path: path.clone(),
    })
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    // 数据安全护栏（最后一道防线，与前端 writeFileText 同款）：
    // 空（纯空白）内容不覆盖磁盘上的非空文件，防「空缓冲文档 + 自动保存」
    // 把原文件写成 0 字节的历史事故
    if content.trim().is_empty() {
        let p = Path::new(&path);
        let non_empty =
            p.exists() && fsutil::read_text(p).map(|s| !s.trim().is_empty()).unwrap_or(false);
        if non_empty {
            return Err("空文档拒绝覆盖非空文件".into());
        }
    }
    fsutil::atomic_write(Path::new(&path), &content).map_err(|e| format!("写入失败: {e}"))
}

/// 保存图片等资源到文档同级 `assets/`（统一重命名防冲突），返回 markdown 可用的相对路径
/// （如 `assets/550e8400e29b41d4a716446655440000.png`）。
#[tauri::command]
pub fn save_asset(
    app: AppHandle,
    path: String,
    data: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    let doc = Path::new(&path);
    if let Some(dir) = doc.parent() {
        allow_asset_dir(&app, dir);
    }
    mdcraft_core::asset::save_asset(doc, &data, &ext)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("保存图片失败: {e}"))
}

#[tauri::command]
pub async fn list_dir(app: AppHandle, root: String) -> Result<Vec<workspace::FileNode>, String> {
    allow_asset_dir(&app, Path::new(&root));
    // 目录枚举是阻塞 IO，放到阻塞线程池，避免占用 IPC 异步线程
    tauri::async_runtime::spawn_blocking(move || {
        workspace::list_dir(Path::new(&root)).map_err(|e| format!("目录读取失败: {e}"))
    })
    .await
    .map_err(|e| format!("目录读取任务异常: {e}"))?
}

// ---------- 文件管理（新建 / 重命名 / 删除） ----------

/// 新建空文件（已存在时报错，避免覆盖）
#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err("同名文件已存在".into());
    }
    fsutil::atomic_write(p, "").map_err(|e| format!("创建失败: {e}"))
}

/// 新建目录（含父级）
#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("创建失败: {e}"))
}

/// 重命名 / 同盘移动：目标已存在时拒绝（防覆盖）
#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    if !Path::new(&from).exists() {
        return Err("源路径不存在".into());
    }
    // 防自身嵌套：禁止把目录移动进自己内部
    if Path::new(&to).starts_with(Path::new(&from)) {
        return Err("目标不能位于源路径内部".into());
    }
    if Path::new(&to).exists() {
        return Err("目标已存在".into());
    }
    std::fs::rename(&from, &to).map_err(|e| format!("重命名失败: {e}"))
}

/// 删除到系统回收站（可恢复，不做永久删除）
#[tauri::command]
pub fn trash_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("删除失败: {e}"))
}

/// 在系统文件管理器中显示：文件 → 资源管理器选中该文件；目录 → 父目录中选中该目录
#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("路径不存在".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.display()))
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R"])
            .arg(p)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let dir = if p.is_dir() { p.to_path_buf() } else { p.parent().unwrap_or(p).to_path_buf() };
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    Ok(())
}

/// 用系统默认程序打开文件/目录（打开导出结果、定位配置等）
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("路径不存在".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    Ok(())
}

/// 用系统默认浏览器打开外部链接（WebView 内 window.open 不会唤起系统浏览器，仅允许 http/https）
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("仅支持 http/https 链接".into());
    }
    #[cfg(target_os = "windows")]
    {
        // 走 URL 处理器而非 cmd start：链接里的 & 等字符不会被 shell 解析
        std::process::Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
    }
    Ok(())
}

/// 让用户选择打开方式（Windows 调系统「打开方式」对话框；其它平台退化为默认程序打开）
#[tauri::command]
pub fn open_with(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("路径不存在".into());
    }
    #[cfg(target_os = "windows")]
    {
        // OpenAs_RunDLL 弹出系统原生「打开方式」选择对话框
        std::process::Command::new("rundll32")
            .args(["shell32.dll,OpenAs_RunDLL", &path])
            .spawn()
            .map_err(|e| format!("打开方式对话框启动失败: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        // 打开「默认程序」偏好设置，让用户选择默认应用
        std::process::Command::new("open")
            .args(["-a", "System Settings"])
            .spawn()
            .map_err(|e| format!("打开方式设置失败: {e}"))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    Ok(())
}

/// 监听状态：代际计数器用于替换旧监听线程（切换工作区时旧线程自动退出）
#[derive(Default)]
pub struct WatchState {
    pub generation: Arc<AtomicU64>,
}

/// 判断路径是文件夹还是文件（拖放导入用）；路径不存在返回 None
#[tauri::command]
pub fn path_kind(path: String) -> Option<String> {
    std::fs::metadata(&path)
        .ok()
        .map(|m| if m.is_dir() { "dir" } else { "file" }.to_string())
}

/// 启动时由系统传入的文件路径（Windows 文件关联：双击 .md 会以 `MDCraft.exe "路径"` 启动）。
/// 取命令行里第一个确实存在的文件；没有则返回 None（普通启动）。
#[tauri::command]
pub fn initial_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && Path::new(arg).is_file())
}

#[tauri::command]
pub fn watch_dir(root: String, app: AppHandle, state: State<'_, WatchState>) -> Result<(), String> {
    let gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let shared = state.generation.clone();

    thread::spawn(move || {
        let Ok(w) = watcher::watch(Path::new(&root)) else {
            return;
        };
        let mut pending: Vec<(String, String)> = Vec::new();
        loop {
            // 已有新的监听（或用户切换工作区）→ 退出
            if shared.load(Ordering::SeqCst) != gen {
                break;
            }
            match w.rx.recv_timeout(Duration::from_millis(150)) {
                Ok(ev) => pending.push((ev.kind, ev.path)),
                Err(_) => {
                    // 窗口到期 → 去重后批量推送
                    if !pending.is_empty() {
                        pending.sort();
                        pending.dedup();
                        let _: bool = app
                            .emit("fs-batch", serde_json::json!({ "events": pending }))
                            .map(|_| true)
                            .unwrap_or(false);
                        pending.clear();
                    }
                }
            }
        }
    });
    Ok(())
}
