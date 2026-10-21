//! MDCraft 核心库
//!
//! 与 Tauri 壳解耦的纯 Rust 业务核心（参考 dbx 的 dbx-core 分层思路）。

pub mod asset;
pub mod fsutil;
pub mod watcher;
pub mod workspace;

/// 视为 Markdown 文件的扩展名
pub const MARKDOWN_EXT: &[&str] = &["md", "markdown", "mdx"];
/// 目录树中同时展示的资源类扩展名（图片等）
pub const ASSET_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "svg", "webp", "pdf"];
