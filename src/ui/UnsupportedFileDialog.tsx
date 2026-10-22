// 「这个文件打不开」弹窗：图片 / 程序 / 无扩展名等文件不是文本，MDCraft 编辑不了。
// 文案按「用户不关心格式术语」的原则写：先说清是谁打不开、为什么，再给出下一步动作。

import { FileWarning } from "lucide-react";
import * as backend from "../lib/backend";
import { fileNameOf } from "../lib/fileTypes";
import { notifyError } from "../lib/notify";
import { closeUnsupportedFile, useUnsupportedFile } from "../lib/unsupportedFile";
import ConfirmDialog from "./ConfirmDialog";

export default function UnsupportedFileDialog() {
  const path = useUnsupportedFile();
  if (!path) return null;
  const name = fileNameOf(path);
  return (
    <ConfirmDialog
      open
      icon={<FileWarning size={17} />}
      title="无法用 MDCraft 打开"
      description={
        <>
          「{name}」不是文本文件，MDCraft 编辑不了它。可以换一个应用打开。
        </>
      }
      detail={path}
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
