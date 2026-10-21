<#
  打包 Windows NSIS 安装包，可选静默安装（全机所有用户）。

  用法：
    powershell -ExecutionPolicy Bypass -File scripts\package-win.ps1            只打包
    powershell -ExecutionPolicy Bypass -File scripts\package-win.ps1 -Install   打包并静默安装

  本脚本用 --config 覆盖 src-tauri/tauri.nsis-permachine.conf.json，原因是本地打包有两点与 CI 不同：
    1. createUpdaterArtifacts 必须关掉 —— updater 签名私钥只存在于 GitHub Secrets，
       本地没有该私钥，保持 true 会在出包阶段直接失败。
    2. installMode 设为 perMachine —— 装到 Program Files，全机所有用户共享；
       Tauri 默认是 currentUser（装到 %LOCALAPPDATA%，免提权）。

  另外，NSIS 会把上次选择的语言记在 HKCU，静默安装不会弹选择框；
  使用 -Install 时会先把安装语言固定为简体中文（2052），避免升级后一直是英文界面。

  配置用文件而不是命令行内联 JSON，是因为 PowerShell 5.1 会把参数里内嵌的双引号吃掉
  （PS 7.3 才修复），内联 JSON 传到 CLI 时可能已不是合法 JSON。
#>
[CmdletBinding()]
param(
  [switch]$Install
)

$ErrorActionPreference = 'Stop'

$root       = Split-Path -Parent $PSScriptRoot
# 注意：根 Cargo.toml 是 workspace，cargo 的 target 目录在仓库根而不是 src-tauri
$outDir     = Join-Path $root 'target\release\bundle\nsis'
$installDir = Join-Path $env:ProgramFiles 'MDCraft'

Write-Host '==> 打包 perMachine NSIS 安装包…' -ForegroundColor Cyan
Push-Location $root
try {
  & pnpm tauri build --bundles nsis --config 'src-tauri/tauri.nsis-permachine.conf.json'
  if ($LASTEXITCODE -ne 0) { throw "打包失败（退出码 $LASTEXITCODE）" }
} finally {
  Pop-Location
}

$setup = Get-ChildItem -Path $outDir -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "未找到安装包，请检查 $outDir" }
Write-Host ('==> 安装包：{0}（{1:N1} MB）' -f $setup.FullName, ($setup.Length / 1MB)) -ForegroundColor Green

if (-not $Install) {
  Write-Host '加 -Install 参数可直接静默安装（会申请管理员权限）。'
  return
}

# NSIS 会记住上次选择的安装语言（HKCU\Software\mdcraft\MDCraft\Installer Language）；
# 静默安装（/S）不会弹语言选择框，历史值为 1033 时会一直使用英文。
# 这里固定为简体中文（2052），保证静默安装/升级的界面与卸载器都是中文。
$langKey = 'HKCU:\Software\mdcraft\MDCraft'
New-Item -Path $langKey -Force | Out-Null
Set-ItemProperty -Path $langKey -Name 'Installer Language' -Value '2052' -Type String

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host '==> 静默安装/升级…' -ForegroundColor Cyan
if ($isAdmin) {
  & $setup.FullName /S
} else {
  Write-Host '   非管理员 shell，将弹出 UAC，请点“是”。'
  Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Verb RunAs -Wait
}

$exe = Join-Path $installDir 'mdcraft.exe'
if (Test-Path $exe) {
  Write-Host "==> 安装成功：$exe" -ForegroundColor Green
} else {
  throw "安装后未找到 $exe（若 UAC 被取消，安装不会发生）"
}
