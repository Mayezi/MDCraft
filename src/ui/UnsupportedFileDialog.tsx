// 「此文件不支持直接打开」弹窗：图片 / 程序 / 无扩展名等文件无法在编辑器里按文本查看，
// 这里给出明确说明，并提供「选择打开方式…」入口（拉起系统原生的「打开方式」框）。

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
      title="此文件不支持直接打开"
      description={
        <>
          「{name}」不是可编辑的文本文件（图片、程序、无扩展名等），
          无法在编辑器中按文本查看。可以选择用其它程序打开。
        </>
      }
      detail={path}
      confirmText="选择打开方式…"
      onCancel={closeUnsupportedFile}
      onConfirm={() => {
        const target = path;
        closeUnsupportedFile();
        void backend.openWith(target).catch((e: unknown) => notifyError(`打开失败：${e}`));
      }}
    />
  );
}
