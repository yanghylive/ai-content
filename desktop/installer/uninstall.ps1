<#
.SYNOPSIS
  卸载 AI 内容平台：删程序 + 删自启 + 删快捷方式。**不删** Python/Node/Postgres/Redis（用户可能别的软件用）。
#>

param(
    [string] $InstallDir = "$env:ProgramFiles\KaypalAI"
)

$ErrorActionPreference = "SilentlyContinue"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] $Message"
}

Write-Log "========== AI 内容平台 uninstall =========="
Write-Log "安装目录: $InstallDir"

try {
    $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    Remove-ItemProperty -Path $regPath -Name "KaypalAI" -ErrorAction SilentlyContinue
    Write-Log "  ✓ 删自启注册表"
} catch { Write-Log "  ✗ 删自启失败: $_" }

try {
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath("Desktop")
    Remove-Item -Path (Join-Path $desktop "KaypalAI 内容创作平台.lnk") -ErrorAction SilentlyContinue
    Write-Log "  ✓ 删桌面快捷方式"

    $startMenu = [Environment]::GetFolderPath("StartMenu")
    $folder = Join-Path $startMenu "Programs\KaypalAI"
    if (Test-Path $folder) {
        Remove-Item -Path $folder -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log "  ✓ 删开始菜单文件夹"
    }
} catch { Write-Log "  ✗ 删快捷方式失败: $_" }

try {
    Get-NetFirewallRule -DisplayName "KaypalAI Backend" -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
    Write-Log "  ✓ 删防火墙规则"
} catch {}

if (Test-Path $InstallDir) {
    try {
        Remove-Item -Path $InstallDir -Recurse -Force
        Write-Log "  ✓ 删 $InstallDir"
    } catch {
        Write-Log "  ✗ 删 $InstallDir 失败: $_"
    }
} else {
    Write-Log "  - $InstallDir 不存在,跳过"
}

$userData = "$env:APPDATA\ai-content-desktop"
if (Test-Path $userData) {
    Write-Log "用户数据保留: $userData (如要清空请手动删)"
}

Write-Log "========== 卸载完成 =========="
