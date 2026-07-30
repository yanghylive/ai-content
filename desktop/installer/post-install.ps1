<#
.SYNOPSIS
  装完依赖后，把主程序拷到 Program Files + 注册自启 + 快捷方式。
.PARAMETER AppSourceDir
  NSIS 解压出来的主程序目录（默认 $env:TEMP\ai-content-app）
.PARAMETER InstallDir
  装到哪（默认 "$env:ProgramFiles\JIUZHANG AI"）
.PARAMETER AutoStart
  是否注册开机自启（默认 true）
#>

param(
    [string] $AppSourceDir = "$env:TEMP\ai-content-app",
    [string] $InstallDir = "$env:ProgramFiles\JIUZHANG AI",
    [bool] $AutoStart = $true
)

$ErrorActionPreference = "Stop"

$Global:PostLog = @()

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] [$Level] $Message"
    $Global:PostLog += $line
    Write-Host $line
}

function Copy-App {
    if (-not (Test-Path $AppSourceDir)) {
        Write-Log "源目录不存在: $AppSourceDir" "ERROR"
        return $false
    }
    Write-Log "拷主程序到: $InstallDir"

    if (Test-Path $InstallDir) {
        Write-Log "  → 已存在,清理旧版本"
        Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Path "$AppSourceDir\*" -Destination $InstallDir -Recurse -Force

    $exe = Join-Path $InstallDir "JIUZHANG AI.exe"
    if (-not (Test-Path $exe)) {
        Write-Log "  ✗ 找不到主程序 $exe" "ERROR"
        return $false
    }

    Write-Log "  ✓ 已拷,主程序: $exe"
    return $true
}

function Register-AutoStart {
    param([string]$ExePath)
    if (-not $AutoStart) {
        Write-Log "跳过自启注册"
        return
    }
    Write-Log "注册开机自启"
    $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    $appName = "JIUZHANG AI"
    Set-ItemProperty -Path $regPath -Name $appName -Value "`"$ExePath`" --autostart"
    Write-Log "  ✓ $regPath\$appName → `"$ExePath`" --autostart"
}

function New-DesktopShortcut {
    param([string]$ExePath)
    Write-Log "建桌面快捷方式"
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcut = $shell.CreateShortcut((Join-Path $desktop "JIUZHANG AI 内容创作平台.lnk"))
    $shortcut.TargetPath = $ExePath
    $shortcut.WorkingDirectory = (Split-Path $ExePath -Parent)
    $shortcut.IconLocation = $ExePath + ",0"
    $shortcut.Description = "AI 内容创作平台"
    $shortcut.Save()
    Write-Log "  ✓ 桌面: $desktop\JIUZHANG AI 内容创作平台.lnk"
}

function New-StartMenuShortcut {
    param([string]$ExePath)
    Write-Log "建开始菜单快捷方式"
    $shell = New-Object -ComObject WScript.Shell
    $startMenu = [Environment]::GetFolderPath("StartMenu")
    $folder = Join-Path $startMenu "Programs\JIUZHANG AI"
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    $shortcut = $shell.CreateShortcut((Join-Path $folder "JIUZHANG AI 内容创作平台.lnk"))
    $shortcut.TargetPath = $ExePath
    $shortcut.WorkingDirectory = (Split-Path $ExePath -Parent)
    $shortcut.IconLocation = $ExePath + ",0"
    $shortcut.Save()

    $uninst = $shell.CreateShortcut((Join-Path $folder "卸载 JIUZHANG AI.lnk"))
    $uninst.TargetPath = "control"
    $uninst.Arguments = "appwiz.cpl"
    $uninst.Save()

    Write-Log "  ✓ 开始菜单: $folder"
}

function Add-FirewallRule {
    param([string]$ExePath)
    Write-Log "加 Windows 防火墙白名单"
    try {
        $ruleName = "JIUZHANG AI Backend"
        $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        if ($existing) { Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue }

        New-NetFirewallRule -DisplayName $ruleName `
            -Direction Inbound `
            -Program $ExePath `
            -Action Allow `
            -Profile Any `
            -ErrorAction Stop | Out-Null
        Write-Log "  ✓ 入站已开"
    } catch {
        Write-Log "  ✗ 防火墙规则失败: $_ (用户可手动开)" "WARN"
    }
}

function Invoke-SelfCheck {
    $selfCheck = Join-Path $PSScriptRoot "self-check.ps1"
    if (-not (Test-Path $selfCheck)) {
        throw "找不到安装后自检脚本: $selfCheck"
    }

    Write-Log "安装后自检"
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $selfCheck -InstallDir $InstallDir 2>&1
    foreach ($line in $output) {
        if (-not [string]::IsNullOrWhiteSpace($line)) {
            Write-Log "  $line"
        }
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Log "  ! 安装后自检有警告，主程序文件已安装。请稍后在应用内修复运行环境。" "WARN"
        return
    }

    Write-Log "  ✓ 安装后自检通过"
}

function Main {
    Write-Log "========== AI 内容平台 post-install =========="

    if (-not (Copy-App)) {
        throw "拷主程序失败"
    }

    $exe = Join-Path $InstallDir "JIUZHANG AI.exe"
    Register-AutoStart -ExePath $exe
    New-DesktopShortcut -ExePath $exe
    New-StartMenuShortcut -ExePath $exe
    Add-FirewallRule -ExePath $exe
    Invoke-SelfCheck

    Write-Log "========== 收尾完成 =========="
    Write-Log "  启动: $exe"
    Write-Log "  自启: HKCU\...\Run\JIUZHANG AI"
}

Main
