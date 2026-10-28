// 图片存储与图床配置面板：支持本地存储 vs 中国境内常用云端图床（阿里云 OSS、腾讯云 COS、七牛云 Kodo、Gitee 码云、兰空/PicGo/自定义 API）

import { useState } from "react";
import {
  AlertCircle,
  Check,
  Cloud,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useStore } from "../store";
import { openUrl } from "../lib/backend";
import { testImageHost } from "../lib/imageHost";
import type { ImageHostConfig, ImageHostType } from "../lib/types";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]";

const HOST_TYPES: { id: ImageHostType; label: string; desc: string }[] = [
  { id: "aliyun", label: "阿里云 OSS", desc: "国内高速稳定对象存储，支持绑定自定义 CDN 域名" },
  { id: "tencent", label: "腾讯云 COS", desc: "腾讯云对象存储，支持全国边缘节点加速" },
  { id: "qiniu", label: "七牛云 Kodo", desc: "提供每月免费存储额度，个人博客与笔记常用图床" },
  { id: "gitee", label: "Gitee 码云", desc: "国内代码托管仓库直传，无需代理即可稳定访问" },
  { id: "custom", label: "自定义", desc: "支持任意兼容 HTTP POST 表单上传的自定义图床接口" },
];

const QINIU_ZONES = [
  { label: "华东-浙江 (upload.qiniup.com)", value: "https://upload.qiniup.com" },
  { label: "华东-浙江2 (upload-cn-east-2.qiniup.com)", value: "https://upload-cn-east-2.qiniup.com" },
  { label: "华北-河北 (upload-z1.qiniup.com)", value: "https://upload-z1.qiniup.com" },
  { label: "华南-广东 (upload-z2.qiniup.com)", value: "https://upload-z2.qiniup.com" },
];

export function ImageHostSettingsPanel() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const config = settings.imageHost;

  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    url?: string;
    durationMs: number;
    error?: string;
  } | null>(null);

  const updateConfig = (patch: Partial<ImageHostConfig>) => {
    setSettings({
      imageHost: {
        ...config,
        ...patch,
      },
    });
  };

  const updateAliyun = (patch: Partial<ImageHostConfig["aliyun"]>) => {
    updateConfig({ aliyun: { ...config.aliyun, ...patch } });
  };

  const updateTencent = (patch: Partial<ImageHostConfig["tencent"]>) => {
    updateConfig({ tencent: { ...config.tencent, ...patch } });
  };

  const updateQiniu = (patch: Partial<ImageHostConfig["qiniu"]>) => {
    updateConfig({ qiniu: { ...config.qiniu, ...patch } });
  };

  const updateGitee = (patch: Partial<ImageHostConfig["gitee"]>) => {
    updateConfig({ gitee: { ...config.gitee, ...patch } });
  };

  const updateCustom = (patch: Partial<ImageHostConfig["custom"]>) => {
    updateConfig({ custom: { ...config.custom, ...patch } });
  };

  const handleTestUpload = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testImageHost(config);
      setTestResult(res);
    } catch (e) {
      setTestResult({
        success: false,
        durationMs: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 text-[13px] text-[var(--fg)]">
      {/* 存储目标选择卡片 */}
      <div>
        <label className="mb-2 block text-[12px] font-semibold text-[var(--fg-soft)]">
          图片存储位置
        </label>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {/* 本地存储选项 */}
          <button
            type="button"
            onClick={() => updateConfig({ target: "local" })}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-left transition-all ${FOCUS_RING} ${
              config.target === "local"
                ? "border-[var(--accent)] bg-[var(--accent-soft)]/25 ring-1 ring-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                config.target === "local"
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--bg-soft)] text-[var(--fg-soft)]"
              }`}
            >
              <HardDrive size={15} />
            </span>
            <div className="min-w-0">
              <div className="font-medium text-[var(--fg)]">本地存储 (assets 目录)</div>
              <div className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--fg-faint)]">
                图片保存在文档同级的 assets/ 目录中，使用相对路径引用，离线可用且保障隐私
              </div>
            </div>
          </button>

          {/* 云端图床选项 */}
          <button
            type="button"
            onClick={() => updateConfig({ target: "imageHost" })}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-left transition-all ${FOCUS_RING} ${
              config.target === "imageHost"
                ? "border-[var(--accent)] bg-[var(--accent-soft)]/25 ring-1 ring-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                config.target === "imageHost"
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--bg-soft)] text-[var(--fg-soft)]"
              }`}
            >
              <Cloud size={15} />
            </span>
            <div className="min-w-0">
              <div className="font-medium text-[var(--fg)]">云端图床</div>
              <div className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--fg-faint)]">
                粘贴或拖入图片时自动上传至国内图床并插入在线 URL，轻量便捷，适合跨端分享
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* 云端图床详细配置 */}
      {config.target === "imageHost" && (
        <div className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)]/50 p-4 sm:p-5">
          {/* 提供商选择 Tabs */}
          <div>
            <label className="mb-2 block text-[12px] font-semibold text-[var(--fg-soft)]">
              图床服务提供商
            </label>
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1">
              {HOST_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    updateConfig({ type: t.id });
                    setTestResult(null);
                  }}
                  className={`flex-1 min-w-[82px] cursor-pointer rounded-md px-2.5 py-1.5 text-center text-[12px] font-medium transition-colors ${FOCUS_RING} ${
                    config.type === t.id
                      ? "bg-[var(--accent)] text-white shadow-xs"
                      : "text-[var(--fg-soft)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] text-[var(--fg-faint)]">
              {HOST_TYPES.find((t) => t.id === config.type)?.desc}
            </p>
          </div>

          {/* 1. 阿里云 OSS 配置 */}
          {config.type === "aliyun" && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    Bucket 名称 <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如: my-blog-images"
                    value={config.aliyun.bucket}
                    onChange={(e) => updateAliyun({ bucket: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    地域节点 (Region) <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如: oss-cn-hangzhou"
                    value={config.aliyun.region}
                    onChange={(e) => updateAliyun({ region: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    AccessKey ID <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="LTAI5txxxxxxxxxxxxxx"
                    value={config.aliyun.accessKeyId}
                    onChange={(e) => updateAliyun({ accessKeyId: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] font-mono outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    AccessKey Secret <span className="text-[var(--danger)]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSecret ? "text" : "password"}
                      placeholder="输入 AccessKey Secret"
                      value={config.aliyun.accessKeySecret}
                      onChange={(e) => updateAliyun({ accessKeySecret: e.target.value })}
                      className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 pr-9 text-[12.5px] font-mono outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      aria-label={showSecret ? "隐藏密钥" : "显示密钥"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] hover:text-[var(--fg)]"
                    >
                      {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    存储目录路径
                  </label>
                  <input
                    type="text"
                    placeholder="例如: images/ 或留空"
                    value={config.aliyun.dir}
                    onChange={(e) => updateAliyun({ dir: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    自定义域名 / CDN 域名 (选填)
                  </label>
                  <input
                    type="text"
                    placeholder="例如: https://img.example.com"
                    value={config.aliyun.customUrl}
                    onChange={(e) => updateAliyun({ customUrl: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
              </div>
              <div className="text-[11px] text-[var(--fg-faint)]">
                提示：请确保阿里云 OSS Bucket 读写权限为「公共读」，并在跨域设置 (CORS) 中允许 POST 请求。
              </div>
            </div>
          )}

          {/* 2. 腾讯云 COS 配置 */}
          {config.type === "tencent" && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    存储桶名称 (Bucket-AppId) <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如: mybucket-1250000000"
                    value={config.tencent.bucket}
                    onChange={(e) => updateTencent({ bucket: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    所属地域 (Region) <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如: ap-shanghai / ap-guangzhou"
                    value={config.tencent.region}
                    onChange={(e) => updateTencent({ region: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    SecretId <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="AKIDxxxxxxxxxxxxxxxxxxxx"
                    value={config.tencent.secretId}
                    onChange={(e) => updateTencent({ secretId: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] font-mono outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    SecretKey <span className="text-[var(--danger)]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSecret ? "text" : "password"}
                      placeholder="输入 SecretKey"
                      value={config.tencent.secretKey}
                      onChange={(e) => updateTencent({ secretKey: e.target.value })}
                      className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 pr-9 text-[12.5px] font-mono outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      aria-label={showSecret ? "隐藏密钥" : "显示密钥"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] hover:text-[var(--fg)]"
                    >
                      {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    存储目录路径
                  </label>
                  <input
                    type="text"
                    placeholder="例如: images/ 或留空"
                    value={config.tencent.dir}
                    onChange={(e) => updateTencent({ dir: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    自定义加速域名 (选填)
                  </label>
                  <input
                    type="text"
                    placeholder="例如: https://cos.example.com"
                    value={config.tencent.customUrl}
                    onChange={(e) => updateTencent({ customUrl: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 3. 七牛云 Kodo 配置 */}
          {config.type === "qiniu" && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    空间名称 (Bucket) <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如: mdcraft-pics"
                    value={config.qiniu.bucket}
                    onChange={(e) => updateQiniu({ bucket: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    存储区域上传地址 <span className="text-[var(--danger)]">*</span>
                  </label>
                  <select
                    value={config.qiniu.uploadUrl}
                    onChange={(e) => updateQiniu({ uploadUrl: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  >
                    {QINIU_ZONES.map((z) => (
                      <option key={z.value} value={z.value}>
                        {z.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    AccessKey (AK) <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="输入七牛云 AccessKey"
                    value={config.qiniu.accessKey}
                    onChange={(e) => updateQiniu({ accessKey: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] font-mono outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    SecretKey (SK) <span className="text-[var(--danger)]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSecret ? "text" : "password"}
                      placeholder="输入七牛云 SecretKey"
                      value={config.qiniu.secretKey}
                      onChange={(e) => updateQiniu({ secretKey: e.target.value })}
                      className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 pr-9 text-[12.5px] font-mono outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      aria-label={showSecret ? "隐藏密钥" : "显示密钥"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] hover:text-[var(--fg)]"
                    >
                      {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    绑定外链域名 <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如: https://img.example.com"
                    value={config.qiniu.domain}
                    onChange={(e) => updateQiniu({ domain: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    存储目录路径
                  </label>
                  <input
                    type="text"
                    placeholder="例如: images/ 或留空"
                    value={config.qiniu.dir}
                    onChange={(e) => updateQiniu({ dir: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 4. Gitee 码云图床配置 */}
          {config.type === "gitee" && (
            <div className="space-y-3.5">
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                  Gitee 仓库名称 <span className="text-[var(--danger)]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如: username/repo"
                  value={config.gitee.repo}
                  onChange={(e) => updateGitee({ repo: e.target.value })}
                  className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    分支名称
                  </label>
                  <input
                    type="text"
                    placeholder="默认: master"
                    value={config.gitee.branch}
                    onChange={(e) => updateGitee({ branch: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    保存目录路径
                  </label>
                  <input
                    type="text"
                    placeholder="例如: images/ 或留空"
                    value={config.gitee.dir}
                    onChange={(e) => updateGitee({ dir: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[11.5px] font-medium text-[var(--fg-soft)]">
                    私人令牌 (Personal Access Token) <span className="text-[var(--danger)]">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      void openUrl("https://gitee.com/profile/personal_access_tokens")
                    }
                    className={`inline-flex cursor-pointer items-center gap-1 text-[11px] text-[var(--accent)] hover:underline ${FOCUS_RING}`}
                  >
                    前往 Gitee 生成私人令牌 (需勾选 projects 权限)
                    <ExternalLink size={10} />
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showSecret ? "text" : "password"}
                    placeholder="输入 Gitee 私人令牌"
                    value={config.gitee.token}
                    onChange={(e) => updateGitee({ token: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 pr-9 text-[12.5px] font-mono outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    aria-label={showSecret ? "隐藏令牌" : "显示令牌"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] hover:text-[var(--fg)]"
                  >
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                  自定义访问域名 / 前缀 (选填)
                </label>
                <input
                  type="text"
                  placeholder="留空默认使用 Gitee 公开仓库直链"
                  value={config.gitee.customUrl}
                  onChange={(e) => updateGitee({ customUrl: e.target.value })}
                  className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                />
              </div>
            </div>
          )}

          {/* 5. 自定义 API 配置 */}
          {config.type === "custom" && (
            <div className="space-y-3.5">
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                  上传接口 URL (POST) <span className="text-[var(--danger)]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="https://example.com/api/upload"
                  value={config.custom.uploadUrl}
                  onChange={(e) => updateCustom({ uploadUrl: e.target.value })}
                  className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    表单文件字段名
                  </label>
                  <input
                    type="text"
                    placeholder="默认: file"
                    value={config.custom.paramName}
                    onChange={(e) => updateCustom({ paramName: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                    响应 URL 提取路径 (JSON Path)
                  </label>
                  <input
                    type="text"
                    placeholder="默认: url (支持嵌套如 data.url)"
                    value={config.custom.jsonPath}
                    onChange={(e) => updateCustom({ jsonPath: e.target.value })}
                    className={`w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[var(--fg-soft)]">
                  自定义请求头 Headers (选填)
                </label>
                <textarea
                  rows={2}
                  placeholder="每行一个 Header，例如:&#10;Authorization: Bearer your-token"
                  value={config.custom.headers}
                  onChange={(e) => updateCustom({ headers: e.target.value })}
                  className={`w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12px] font-mono outline-none transition-colors focus:border-[var(--accent)] ${FOCUS_RING}`}
                />
              </div>
            </div>
          )}

          {/* 测试连接与上传按钮 */}
          <div className="pt-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={testing}
                onClick={() => void handleTestUpload()}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-[12px] font-medium text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50 ${FOCUS_RING}`}
              >
                {testing ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    测试上传中…
                  </>
                ) : (
                  <>
                    <RefreshCw size={13} />
                    测试图床配置
                  </>
                )}
              </button>
            </div>

            {/* 测试结果提示 */}
            {testResult && (
              <div
                className={`mt-3 flex items-start gap-2.5 rounded-lg border p-3 text-[12px] ${
                  testResult.success
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400"
                }`}
              >
                {testResult.success ? (
                  <Check size={16} className="shrink-0 mt-0.5 text-emerald-500" />
                ) : (
                  <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-500" />
                )}
                <div className="min-w-0 flex-1">
                  {testResult.success ? (
                    <div>
                      <div className="font-semibold">
                        测试上传成功！耗时 {testResult.durationMs} ms
                      </div>
                      {testResult.url && (
                        <div className="mt-1 truncate font-mono text-[11px] opacity-80 select-all">
                          {testResult.url}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="font-semibold">上传测试失败</div>
                      <div className="mt-1 font-mono text-[11px] break-all opacity-90">
                        {testResult.error}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 失败自动降级选项 */}
          <div className="border-t border-[var(--border)] pt-3.5">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <div>
                <div className="text-[12.5px] font-medium text-[var(--fg)]">
                  图床上传失败时自动降级到本地
                </div>
                <div className="text-[11px] text-[var(--fg-faint)]">
                  遇到网络异常或图床配置错误时，自动将图片保存至本地 assets 目录，防止内容丢失
                </div>
              </div>
              <input
                type="checkbox"
                checked={config.fallbackToLocal}
                onChange={(e) => updateConfig({ fallbackToLocal: e.target.checked })}
                className="h-4 w-4 rounded accent-[var(--accent)]"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
