//! 本地资源（图片等）落盘：统一重命名到「文档同级 assets/」，避免同名冲突覆盖。
//!
//! 命名用 UUID v4（纯随机，不承载任何时间/排序语义），目标已存在则重试，绝不覆盖已有文件。

use std::path::{Path, PathBuf};

use crate::fsutil;

/// 保存资源到 `<文档目录>/assets/`，返回「相对文档目录」的路径
/// （如 `assets/550e8400e29b41d4a716446655440000.png`，始终用 `/` 分隔，可直接写进 markdown）。
///
/// - `doc_path`：目标文档（.md）路径，资源落在它的同级 `assets/`
/// - `ext`：扩展名（不含点）；非法字符会被剔除，缺省 `png`
/// - `data`：文件字节；空数据拒绝写入
pub fn save_asset(doc_path: &Path, data: &[u8], ext: &str) -> std::io::Result<PathBuf> {
    if data.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "空文件",
        ));
    }
    let dir = doc_path.parent().unwrap_or_else(|| Path::new("."));
    let assets_dir = dir.join("assets");
    let ext = sanitize_ext(ext);

    for _ in 0..64 {
        let name = format!("{}.{ext}", uuid::Uuid::new_v4().simple());
        let path = assets_dir.join(&name);
        if path.exists() {
            continue;
        }
        fsutil::atomic_write_bytes(&path, data)?;
        return Ok(PathBuf::from(format!("assets/{name}")));
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "资源命名冲突：重试 64 次仍未找到空位",
    ))
}

/// 扩展名清洗：仅保留 ASCII 字母数字，转小写，最长 8 字符；清洗后为空则回退 `png`
fn sanitize_ext(ext: &str) -> String {
    let cleaned: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if cleaned.is_empty() {
        "png".to_string()
    } else {
        cleaned
    }
}
