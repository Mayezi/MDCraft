// 文件类型判定：哪些扩展名能由编辑器按纯文本打开，哪些要交系统处理。
// 目录树、最近打开、文件选择器共用同一份口径，避免各处各判一套。

/** 可作为纯文本在编辑器内打开的文件扩展名（其余文件用系统默认程序打开） */
const TEXT_EDITABLE_EXT = [
  "md", "markdown", "mdx", "txt", "text", "log",
  "json", "yaml", "yml", "toml", "ini", "conf", "config",
  "js", "jsx", "ts", "tsx", "css", "scss", "less", "html", "htm", "xml",
  "py", "rs", "go", "java", "c", "h", "cpp", "hpp", "cs", "rb", "php",
  "sh", "bash", "ps1", "bat", "cmd",
];

/** 判断文件是否应用编辑器打开（是 → 纯文本编辑；否 → 交系统处理） */
export function isTextEditable(name: string): boolean {
  const dot = name.lastIndexOf(".");
  // 无扩展名：格式无法识别（LICENSE / Makefile 之类），不由编辑器接管
  if (dot <= 0) return false;
  return TEXT_EDITABLE_EXT.includes(name.slice(dot + 1).toLowerCase());
}

/** 从路径取文件名（兼容 Windows / POSIX 分隔符） */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
