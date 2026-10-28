// 图床上传服务：面向中国境内常用图床（阿里云 OSS、腾讯云 COS、七牛云 Kodo、Gitee 码云、兰空/PicGo/自定义 API）
// 基于 Web Crypto API 纯前端完成 HMAC-SHA1 / SHA-1 签名，零外部 SDK 依赖。

import type { ImageHostConfig } from "./types";

/** 生成带日期与随机后缀的文件名，如 20261027_102030_a1b2c3.png */
function generateFileName(ext: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8);
  const cleanExt = ext.replace(/^\./, "") || "png";
  return `${dateStr}_${rand}.${cleanExt}`;
}

/** 规范化目录前缀（去首斜杠，非空时补尾斜杠） */
function normalizeDir(dir: string): string {
  let clean = dir.trim().replace(/^\/+/, "");
  if (clean && !clean.endsWith("/")) clean += "/";
  return clean;
}

/** Uint8Array 转 Base64 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** UTF-8 字符串转 Base64 */
function utf8ToBase64(str: string): string {
  return bytesToBase64(new TextEncoder().encode(str));
}

/** URL 安全 Base64（七牛云签名规范：+ 转 -，/ 转 _） */
function toUrlSafeBase64(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_");
}

/** 字节数组转十六进制字符串 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Web Crypto HMAC-SHA1 计算，返回原始字节 */
async function hmacSha1Bytes(keyStr: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyStr),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return new Uint8Array(sig);
}

/** Web Crypto SHA-1 摘要（十六进制） */
async function sha1Hex(message: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(buf));
}

/** 拼接最终访问外链 */
function buildPublicUrl(customOrDefaultOrigin: string, objectKey: string): string {
  const base = customOrDefaultOrigin.trim().replace(/\/+$/, "");
  if (base.includes("{path}")) return base.replace("{path}", objectKey);
  const fullBase = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  return `${fullBase}/${objectKey}`;
}

/**
 * 1. 阿里云 OSS 上传（PostObject 表单签名）
 */
async function uploadToAliyunOss(
  fileData: Uint8Array,
  fileName: string,
  mimeType: string,
  config: ImageHostConfig["aliyun"],
): Promise<string> {
  const bucket = config.bucket.trim();
  const region = config.region.trim().replace(/\.aliyuncs\.com$/i, "");
  const ak = config.accessKeyId.trim();
  const sk = config.accessKeySecret.trim();

  if (!bucket || !region || !ak || !sk) {
    throw new Error("阿里云 OSS 未完整配置 Bucket、地域节点、AccessKey ID 或 AccessKey Secret");
  }

  const objectKey = `${normalizeDir(config.dir)}${fileName}`;
  const expiration = new Date(Date.now() + 3600 * 1000).toISOString();
  const policyObj = {
    expiration,
    conditions: [
      { bucket },
      ["content-length-range", 0, 104857600],
      ["eq", "$key", objectKey],
    ],
  };

  const policyBase64 = utf8ToBase64(JSON.stringify(policyObj));
  const sigBytes = await hmacSha1Bytes(sk, policyBase64);
  const signature = bytesToBase64(sigBytes);

  const endpoint = `https://${bucket}.${region}.aliyuncs.com`;
  const formData = new FormData();
  formData.append("key", objectKey);
  formData.append("OSSAccessKeyId", ak);
  formData.append("policy", policyBase64);
  formData.append("Signature", signature);
  formData.append("success_action_status", "200");
  const blob = new Blob([fileData as unknown as BlobPart], { type: mimeType || "image/png" });
  formData.append("file", blob, fileName);

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `阿里云 OSS 上传失败 (HTTP ${response.status})：${errText.slice(0, 180) || response.statusText}`,
    );
  }

  return buildPublicUrl(config.customUrl || endpoint, objectKey);
}

/**
 * 2. 腾讯云 COS 上传（PostObject 表单签名）
 */
async function uploadToTencentCos(
  fileData: Uint8Array,
  fileName: string,
  mimeType: string,
  config: ImageHostConfig["tencent"],
): Promise<string> {
  const bucket = config.bucket.trim();
  const region = config.region.trim();
  const secretId = config.secretId.trim();
  const secretKey = config.secretKey.trim();

  if (!bucket || !region || !secretId || !secretKey) {
    throw new Error("腾讯云 COS 未完整配置存储桶名称(Bucket-AppId)、所属地域、SecretId 或 SecretKey");
  }

  const objectKey = `${normalizeDir(config.dir)}${fileName}`;
  const nowSec = Math.floor(Date.now() / 1000) - 60;
  const expSec = nowSec + 3600;
  const keyTime = `${nowSec};${expSec}`;

  const policyObj = {
    expiration: new Date(expSec * 1000).toISOString(),
    conditions: [
      { bucket },
      ["eq", "$key", objectKey],
      { "q-sign-algorithm": "sha1" },
      { "q-ak": secretId },
      { "q-sign-time": keyTime },
    ],
  };

  const policyStr = JSON.stringify(policyObj);
  const policyBase64 = utf8ToBase64(policyStr);
  const signKey = bytesToHex(await hmacSha1Bytes(secretKey, keyTime));
  const stringToSign = await sha1Hex(policyStr);
  const signature = bytesToHex(await hmacSha1Bytes(signKey, stringToSign));

  const endpoint = `https://${bucket}.cos.${region}.myqcloud.com`;
  const formData = new FormData();
  formData.append("key", objectKey);
  formData.append("success_action_status", "200");
  formData.append("policy", policyBase64);
  formData.append("q-sign-algorithm", "sha1");
  formData.append("q-ak", secretId);
  formData.append("q-key-time", keyTime);
  formData.append("q-signature", signature);
  const blob = new Blob([fileData as unknown as BlobPart], { type: mimeType || "image/png" });
  formData.append("file", blob, fileName);

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `腾讯云 COS 上传失败 (HTTP ${response.status})：${errText.slice(0, 180) || response.statusText}`,
    );
  }

  return buildPublicUrl(config.customUrl || endpoint, objectKey);
}

/**
 * 3. 七牛云 Kodo 上传（客户端生成 uploadToken 直传）
 */
async function uploadToQiniu(
  fileData: Uint8Array,
  fileName: string,
  mimeType: string,
  config: ImageHostConfig["qiniu"],
): Promise<string> {
  const bucket = config.bucket.trim();
  const uploadUrl = config.uploadUrl.trim() || "https://upload.qiniup.com";
  const ak = config.accessKey.trim();
  const sk = config.secretKey.trim();
  const domain = config.domain.trim();

  if (!bucket || !ak || !sk || !domain) {
    throw new Error("七牛云未完整配置空间名称(Bucket)、AccessKey、SecretKey 或外链域名");
  }

  const objectKey = `${normalizeDir(config.dir)}${fileName}`;
  const putPolicy = {
    scope: `${bucket}:${objectKey}`,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };

  const encodedPolicy = toUrlSafeBase64(utf8ToBase64(JSON.stringify(putPolicy)));
  const signBytes = await hmacSha1Bytes(sk, encodedPolicy);
  const encodedSign = toUrlSafeBase64(bytesToBase64(signBytes));
  const uploadToken = `${ak}:${encodedSign}:${encodedPolicy}`;

  const formData = new FormData();
  formData.append("token", uploadToken);
  formData.append("key", objectKey);
  const blob = new Blob([fileData as unknown as BlobPart], { type: mimeType || "image/png" });
  formData.append("file", blob, fileName);

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `七牛云上传失败 (HTTP ${response.status})：${errText.slice(0, 180) || response.statusText}`,
    );
  }

  return buildPublicUrl(domain, objectKey);
}

/**
 * 4. Gitee 码云仓库图床上传
 * API: POST https://gitee.com/api/v5/repos/{owner}/{repo}/contents/{path}
 */
async function uploadToGitee(
  fileData: Uint8Array,
  fileName: string,
  config: ImageHostConfig["gitee"],
): Promise<string> {
  const { repo, branch, dir, token, customUrl } = config;
  if (!repo.trim() || !token.trim()) {
    throw new Error("Gitee 图床未配置仓库名称或私人令牌 (Token)");
  }

  const repoClean = repo
    .trim()
    .replace(/^https?:\/\/gitee\.com\//i, "")
    .replace(/^\/+|\/+$/g, "");
  const [owner, repoName] = repoClean.split("/");
  if (!owner || !repoName) {
    throw new Error("Gitee 仓库格式需为 '用户名/仓库名'，如 'username/images'");
  }

  const branchName = branch.trim() || "master";
  const filePath = `${normalizeDir(dir)}${fileName}`;
  const apiUrl = `https://gitee.com/api/v5/repos/${owner}/${repoName}/contents/${encodeURIComponent(
    filePath,
  ).replace(/%2F/g, "/")}`;

  const payload = {
    access_token: token.trim(),
    content: bytesToBase64(fileData),
    message: `Upload ${fileName} via MDCraft`,
    branch: branchName,
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `HTTP ${response.status}`;
    try {
      const errJson = JSON.parse(errText) as { message?: string };
      if (errJson.message) errMsg = errJson.message;
    } catch {
      if (errText) errMsg = errText.slice(0, 150);
    }
    throw new Error(`Gitee 上传失败：${errMsg}`);
  }

  const json = (await response.json()) as {
    content?: { download_url?: string };
  };

  if (customUrl.trim()) {
    return buildPublicUrl(customUrl, filePath);
  }
  if (json.content?.download_url) {
    return json.content.download_url;
  }
  return `https://gitee.com/${owner}/${repoName}/raw/${branchName}/${filePath}`;
}

/** 从嵌套 JSON 对象中根据点分路径（支持数组下标如 result.0）提取 URL */
function extractJsonPath(obj: unknown, path: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const keys = path.trim().split(".").filter(Boolean);
  let cur: any = obj;
  for (const key of keys) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[key];
  }
  if (typeof cur === "string" && cur.trim()) return cur.trim();
  return null;
}

/** 解析用户填写的自定义 Headers */
function parseCustomHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const trimmed = raw.trim();
  if (!trimmed) return headers;

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" || typeof v === "number") {
          headers[k] = String(v);
        }
      }
      return headers;
    } catch {
      /* 回退到按行解析 */
    }
  }

  for (const line of trimmed.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k && v) headers[k] = v;
    }
  }
  return headers;
}

/**
 * 5. 自定义 API / 兰空图床 Lsky Pro / PicGo Server
 */
async function uploadToCustomApi(
  fileData: Uint8Array,
  fileName: string,
  mimeType: string,
  config: ImageHostConfig["custom"],
): Promise<string> {
  const { uploadUrl, headers: rawHeaders, paramName, jsonPath } = config;
  const urlStr = uploadUrl.trim();
  if (!urlStr) {
    throw new Error("未配置上传接口 URL");
  }

  const formData = new FormData();
  const blob = new Blob([fileData as unknown as BlobPart], { type: mimeType || "image/png" });
  formData.append(paramName.trim() || "file", blob, fileName);

  const customHeaders = parseCustomHeaders(rawHeaders);

  const response = await fetch(urlStr, {
    method: "POST",
    headers: customHeaders,
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`接口上传失败：HTTP ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as any;
  const path = jsonPath.trim() || "data.links.url";
  const extracted =
    extractJsonPath(json, path) ??
    extractJsonPath(json, "data.links.url") ??
    extractJsonPath(json, "data.url") ??
    extractJsonPath(json, "result.0") ??
    extractJsonPath(json, "url");

  if (extracted) return extracted;
  throw new Error(`从接口响应 JSON 中未找到图片链接（查找路径: '${path}'）`);
}

/**
 * 统一图床上传入口
 */
export async function uploadImageToHost(
  file: { data: Uint8Array; name: string; mime: string },
  config: ImageHostConfig,
): Promise<string> {
  const fileName = generateFileName(file.name.split(".").pop() || "png");
  switch (config.type) {
    case "aliyun":
      return uploadToAliyunOss(file.data, fileName, file.mime, config.aliyun);
    case "tencent":
      return uploadToTencentCos(file.data, fileName, file.mime, config.tencent);
    case "qiniu":
      return uploadToQiniu(file.data, fileName, file.mime, config.qiniu);
    case "gitee":
      return uploadToGitee(file.data, fileName, config.gitee);
    case "custom":
      return uploadToCustomApi(file.data, fileName, file.mime, config.custom);
    default:
      throw new Error(`不支持的图床类型：${(config as any).type}`);
  }
}

/** 生成 1x1 像素的测试 PNG 图片数据 */
function createTestPixelPng(): Uint8Array {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/** 测试当前图床配置是否可用 */
export async function testImageHost(
  config: ImageHostConfig,
): Promise<{ success: boolean; url?: string; durationMs: number; error?: string }> {
  const startTime = Date.now();
  try {
    const testData = createTestPixelPng();
    const url = await uploadImageToHost(
      {
        data: testData,
        name: "test.png",
        mime: "image/png",
      },
      config,
    );
    return {
      success: true,
      url,
      durationMs: Date.now() - startTime,
    };
  } catch (e) {
    return {
      success: false,
      durationMs: Date.now() - startTime,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
