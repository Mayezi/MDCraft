// 按扩展名返回文件图标（文件树与打开方式对话框共用，避免两处不同步）。

import {
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileType,
  FileVideo,
  type LucideIcon,
} from "lucide-react";

export function fileIcon(name: string): LucideIcon {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const inList = (list: string[]) => list.includes(ext);
  if (inList(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"])) return FileImage;
  if (inList(["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "mpg"])) return FileVideo;
  if (inList(["mp3", "wav", "flac", "ogg", "m4a", "aac", "wma", "opus"])) return FileAudio;
  if (inList(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"])) return FileArchive;
  if (inList(["json", "jsonc"])) return FileJson;
  if (
    inList([
      "js", "ts", "jsx", "tsx", "cjs", "mjs", "html", "htm", "xml", "css", "scss", "less",
      "py", "rs", "go", "java", "c", "h", "cpp", "hpp", "cs", "rb", "php", "sh", "bash",
      "ps1", "bat", "cmd", "sql", "vue", "svelte",
    ])
  )
    return FileCode;
  if (inList(["pdf"])) return FileType;
  return FileText;
}
