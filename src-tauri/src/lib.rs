mod commands;

use std::time::Duration;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(commands::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            commands::read_settings,
            commands::write_settings,
            commands::settings_path,
            commands::open_file,
            commands::write_file,
            commands::save_asset,
            commands::list_dir,
            commands::watch_dir,
            commands::create_file,
            commands::create_dir,
            commands::rename_path,
            commands::trash_path,
            commands::show_in_folder,
            commands::open_path,
            commands::open_url,
            commands::open_with,
            commands::path_kind,
            commands::initial_file,
        ])
        .setup(|app| {
            // 单窗口无缝启动：主窗口首帧即显示，画面为 index.html 内全屏启动遮罩
            //（与主界面同尺寸同位置，加载完成由前端淡出，全程无窗口切换、无跳变）。
            // 兜底：前端异常/加载失败时，最多 20 秒后也强制显示主窗口，避免黑窗。
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(20));
                if let Some(main) = handle.get_webview_window("main") {
                    if !main.is_visible().unwrap_or(false) {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MDCraft");
}
