//! 工作区目录树构建（惰性：每次仅列出单层，子目录在展开时由前端按需加载）

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(serde::Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
    pub modified_at: Option<u64>,
    pub created_at: Option<u64>,
}

/// 单层最大条目数（超出即截断，防畸形/超大目录一次拖垮前端）
const MAX_LEVEL_CHILDREN: usize = 2000;

/// 隐藏文件/目录（点开头）一律不显示；隐藏目录另含常见构建产物目录。
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// 列出 root 的直接子项（单层）。目录节点 children 恒为空——前端展开该目录时才调用
/// `list_dir` 加载其子层，避免一次全量递归遍历大型目录树导致的卡顿。
fn list_level(root: &Path) -> Vec<FileNode> {
    let mut dirs: Vec<FileNode> = vec![];
    let mut files: Vec<FileNode> = vec![];

    let Ok(entries) = fs::read_dir(root) else {
        return vec![];
    };

    for entry in entries.flatten() {
        if dirs.len() + files.len() >= MAX_LEVEL_CHILDREN {
            break;
        }
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let path_str = path.to_string_lossy().into_owned();
        // 不支持的文件时间保留为空，由前端排在已知时间之后。
        let modified_at = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|t| t.as_millis() as u64);
        let created_at = meta.created().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|t| t.as_millis() as u64);

        if is_hidden(&name) {
            continue;
        }
        if meta.is_dir() {
            dirs.push(FileNode {
                name,
                path: path_str,
                is_dir: true,
                children: vec![],
                modified_at,
                created_at,
            });
        } else {
            files.push(FileNode {
                name,
                path: path_str,
                is_dir: false,
                children: vec![],
                modified_at,
                created_at,
            });
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);
    dirs
}

/// 列出目录 root 的直接子项（跳过隐藏文件/目录；单层惰性）
pub fn list_dir(root: &Path) -> std::io::Result<Vec<FileNode>> {
    let meta = fs::metadata(root)?;
    if !meta.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "not a directory"));
    }
    Ok(list_level(root))
}