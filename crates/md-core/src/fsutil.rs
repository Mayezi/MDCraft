//! 文件读写：UTF-8 读取（含 BOM 处理）与原子写（tmp + fsync + rename）

use std::fs;
use std::io;
use std::path::Path;

/// 读取文本文件，自动去除 UTF-8 BOM，非合法 UTF-8 字节以替换字符呈现
pub fn read_text(path: &Path) -> io::Result<String> {
    let bytes = fs::read(path)?;
    let slice: &[u8] = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        &bytes
    };
    Ok(String::from_utf8_lossy(slice).into_owned())
}

/// 文本原子写（`atomic_write_bytes` 的 UTF-8 便捷包装）
pub fn atomic_write(path: &Path, content: &str) -> io::Result<()> {
    atomic_write_bytes(path, content.as_bytes())
}

/// 原子写：先写同目录临时文件并 fsync，再 rename 覆盖目标（二进制安全，图片等资源走这里）。
/// Windows 下 rename 到已存在目标会失败，此时退化为 remove + rename
/// （存在极小的非原子窗口，V1 可接受；后续可接 MoveFileEx REPLACE_EXISTING）。
pub fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(dir)?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled.md");
    let tmp = dir.join(format!(".{}.{}.tmp", file_name, std::process::id()));

    {
        use std::io::Write;
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }

    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(path);
            fs::rename(&tmp, path).map_err(|e2| e2).or(Err(e))
        }
    }
}
