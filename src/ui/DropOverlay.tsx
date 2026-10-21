// 拖放导入的视觉反馈：文件/文件夹拖入窗口时显示全屏提示，松开即打开。
import { FileDown } from "lucide-react";

export default function DropOverlay() {
  return (
    <div className="drop-overlay" role="status" aria-label="拖放导入">
      <div className="drop-card">
        <div className="drop-icon">
          <FileDown size={30} strokeWidth={1.8} />
        </div>
        <div className="drop-title">松开以打开</div>
        <div className="drop-hint">支持 Markdown 文件与文件夹（拖入即可打开）</div>
      </div>
    </div>
  );
}