// 「无法打开 xxx」弹窗：图片 / 程序 / 无扩展名等文件不是文本，MDCraft 编辑不了。
// 文案按「用户不关心格式术语」的原则写：标题点名文件（带色），正文说清限制与替代动作。

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
      title={
        <>
          无法打开{" "}
          <span className="break-all font-mono text-blue-600 dark:text-blue-400">{name}</span>
        </>
      }
      description={
        <>
          MDCraft 目前专为 Markdown 与纯文本打造（如 .md .txt 等）。
          <br />
          该文件格式暂不支持在此编辑，建议使用系统默认应用打开。
        </>
      }
      confirmText="选择其他应用打开"
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
