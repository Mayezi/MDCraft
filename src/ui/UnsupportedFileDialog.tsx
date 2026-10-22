// 「不支持打开此类文件」弹窗：图片 / 程序 / 无扩展名等文件不是文本，MDCraft 编辑不了。
// 文案按「用户不关心格式术语」的原则写：说清限制是什么、给出一个可行动作，不展示完整路径。

import { FileWarning } from "lucide-react";
import * as backend from "../lib/backend";
import { notifyError } from "../lib/notify";
import { closeUnsupportedFile, useUnsupportedFile } from "../lib/unsupportedFile";
import ConfirmDialog from "./ConfirmDialog";

export default function UnsupportedFileDialog() {
  const path = useUnsupportedFile();
  if (!path) return null;
  return (
    <ConfirmDialog
      open
      icon={<FileWarning size={17} />}
      title="不支持打开此类文件"
      description="MDCraft 仅支持打开文本文件（如 .md、.txt、.json），你可以使用其他应用打开它。"
      confirmText="选择打开方式…"
      cancelText="知道了"
      onCancel={closeUnsupportedFile}
      onConfirm={() => {
        const target = path;
        closeUnsupportedFile();
        void backend.openWith(target).catch((e: unknown) => notifyError(`打开失败：${e}`));
      }}
    />
  );
}
