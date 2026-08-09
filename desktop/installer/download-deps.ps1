<#
.SYNOPSIS
  下载并静默安装 AI 内容平台缺失的依赖。
.PARAMETER ManifestPath
  deps-manifest.json 路径（必填）
.PARAMETER OnlyMissing
  只装缺失的（默认 true；false 会强制重装）
.PARAMETER TempDir
  下载到哪（默认 $env:TEMP\ai-content-deps）
#>

param(
    [Parameter(Mandatory=$true)] [string] $ManifestPath,
    [bool] $OnlyMissing = $true,
    [string] $TempDir = "$env:TEMP\ai-content-deps"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ManifestPath)) {
    throw "Manifest not found: $ManifestPath"
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json

$Global:InstallLog = @()
$Global:InstalledDeps = @{}
$Global:FailedDeps = @()

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] [$Level] $Message"
    $Global:InstallLog += $line
    Write-Host $line
}

function Compare-Version {
    param([string]$A, [string]$B)
    if ([string]::IsNullOrWhiteSpace($A) -or [string]::IsNullOrWhiteSpace($B)) { return -1 }
    $a = [version]($A -replace "[^\d\.]", "")
    $b = [version]($B -replace "[^\d\.]", "")
    if ($a -lt $b) { return -1 }
    if ($a -gt $b) { return 1 }
    return 0
}

function Get-DetectedFromMain {
    $detector = Join-Path $PSScriptRoot "detect-deps.ps1"
    if (-not (Test-Path $detector)) { return $null }
    $output = & pwsh -NoProfile -ExecutionPolicy Bypass -File $detector 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    try {
        return ($output -join "`n" | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Start-Download {
    param(
        [string] $Url,
        [string] $Destination
    )
    Write-Log "下载: $Url"
    Write-Log "  → $Destination"

    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add("User-Agent", "AI-Content-Installer/1.0")

    try {
        $wc.DownloadFile($Url, $Destination)
    } catch {
        throw "下载失败: $_"
    } finally {
        $wc.Dispose()
    }

    $size = (Get-Item $Destination).Length
    Write-Log "  ✓ $([math]::Round($size / 1MB, 1)) MB"
}

function Start-SilentInstall {
    param(
        [string] $Installer,
        [string] $SilentArgs,
        [string] $DepName
    )

    $ext = [System.IO.Path]::GetExtension($Installer).ToLower()
    Write-Log "静默安装 $DepName ($ext): $SilentArgs"

    if ($ext -eq ".msi") {
        $args = @("/i", "`"$Installer`"")
        if ($SilentArgs) {
            $args += ($SilentArgs -split "\s+" | Where-Object { $_ -and $_ -ne "/i" })
        }
        $process = Start-Process -FilePath "msiexec.exe" `
            -ArgumentList $args `
            -Wait -PassThru `
            -NoNewWindow
    } else {
        $process = Start-Process -FilePath $Installer `
            -ArgumentList $SilentArgs `
            -Wait -PassThru `
            -NoNewWindow
    }

    $code = $process.ExitCode
    if ($code -ne 0) {
        Write-Log "安装退出码: $code" "WARN"
    }
    return $code
}

function Get-FileSha256 {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-InstallerFile {
    param(
        [string]$Path,
        [object]$DepDef
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }

    $item = Get-Item -LiteralPath $Path
    if ($DepDef.size -and [int64]$DepDef.size -gt 0 -and $item.Length -ne [int64]$DepDef.size) {
        return $false
    }

    if ($DepDef.sha256) {
        $actual = Get-FileSha256 -Path $Path
        if ($actual -ne ([string]$DepDef.sha256).ToLowerInvariant()) {
            return $false
        }
    }

    return $true
}

function Install-OneDep {
    param(
        [string] $DepName,
        [object] $DepDef,
        [object] $Detected
    )

    Write-Log ""
    Write-Log "==== 处理 $DepName ===="

    if ($DepDef.optional -eq $true -and $OnlyMissing) {
        $isInstalled = $false
        if ($Detected -and $Detected.PSObject.Properties.Name -contains $DepName) {
            $isInstalled = [bool]$Detected.$DepName.installed
        }
        if ($isInstalled) {
            Write-Log "  → 跳过 (可选,已装)"
            $Global:InstalledDeps[$DepName] = "skipped-optional-installed"
            return
        }
    }

    $alreadyInstalled = $false
    $currentVersion = $null
    if ($Detected -and $Detected.PSObject.Properties.Name -contains $DepName) {
        $alreadyInstalled = [bool]$Detected.$DepName.installed
        $currentVersion = $Detected.$DepName.version
    }

    if ($alreadyInstalled -and $OnlyMissing) {
        $cmp = Compare-Version $currentVersion $DepDef.minVersion
        if ($cmp -ge 0) {
            Write-Log "  → 跳过 (已装 v$currentVersion ≥ v$DepDef.minVersion)"
            $Global:InstalledDeps[$DepName] = "skipped-already-installed"
            return
        } else {
            Write-Log "  → 版本过低 v$currentVersion < v$DepDef.minVersion,重装"
        }
    }

    $localFile = Join-Path $TempDir $DepDef.filename
    if (-not (Test-Path $TempDir)) {
        New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
    }

    if ((Test-Path -LiteralPath $localFile -PathType Leaf) -and -not (Test-InstallerFile -Path $localFile -DepDef $DepDef)) {
        Write-Log "  → 本地缓存校验失败,重新下载"
        Remove-Item -LiteralPath $localFile -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path -LiteralPath $localFile -PathType Leaf)) {
        try {
            Start-Download -Url $DepDef.url -Destination $localFile
        } catch {
            Write-Log "下载 $DepName 失败: $_" "ERROR"
            $Global:FailedDeps[$DepName] = "download-failed: $_"
            return
        }
    } else {
        Write-Log "  → 复用本地缓存: $localFile"
    }

    if (-not (Test-InstallerFile -Path $localFile -DepDef $DepDef)) {
        Write-Log "文件校验失败: $localFile" "ERROR"
        $Global:FailedDeps[$DepName] = "verify-file-failed"
        return
    }

    try {
        $exitCode = Start-SilentInstall -Installer $localFile -SilentArgs $DepDef.silentArgs -DepName $DepName

        if ($DepDef.verifyCmd) {
            Start-Sleep -Seconds 2
            $path = (Get-Command ($DepDef.verifyCmd.Split(' ')[0]) -ErrorAction SilentlyContinue).Source
            if ($path) {
                $output = & ($DepDef.verifyCmd.Split(' ')[0]) 2>&1 | Out-String
                Write-Log "  ✓ 验证: $($output.Trim())"
                $Global:InstalledDeps[$DepName] = $output.Trim()
            } else {
                Write-Log "  ✗ 验证失败: 命令找不到" "ERROR"
                $Global:FailedDeps[$DepName] = "verify-failed: command not in PATH"
            }
        } else {
            $Global:InstalledDeps[$DepName] = "installed"
        }
    } catch {
        Write-Log "安装 $DepName 失败: $_" "ERROR"
        $Global:FailedDeps[$DepName] = "install-failed: $_"
    }
}

function Main {
    Write-Log "========== AI 内容平台依赖引导 =========="
    Write-Log "Manifest: $ManifestPath"
    Write-Log "Temp:     $TempDir"
    Write-Log ""

    $detected = Get-DetectedFromMain
    if ($detected) {
        Write-Log "检测结果:"
        foreach ($prop in $detected.PSObject.Properties) {
            $installed = if ($prop.Value.installed) { "✓" } else { "✗" }
            $version = if ($prop.Value.version) { " v$($prop.Value.version)" } else { "" }
            Write-Log "  $installed $($prop.Name)$version"
        }
        Write-Log ""
    } else {
        Write-Log "未运行 detect-deps.ps1,直接装所有" "WARN"
    }

    foreach ($prop in $manifest.deps.PSObject.Properties) {
        $name = $prop.Name
        $def = $prop.Value
        Install-OneDep -DepName $name -DepDef $def -Detected $detected
    }

    Write-Log ""
    Write-Log "========== 总结 =========="
    Write-Log "成功: $($Global:InstalledDeps.Count) 个"
    foreach ($k in $Global:InstalledDeps.Keys) {
        Write-Log "  ✓ $k → $($Global:InstalledDeps[$k])"
    }

    if ($Global:FailedDeps.Count -gt 0) {
        Write-Log "失败: $($Global:FailedDeps.Count) 个" "ERROR"
        foreach ($k in $Global:FailedDeps.Keys) {
            Write-Log "  ✗ $k → $($Global:FailedDeps[$k])" "ERROR"
        }
        exit 1
    }

    Write-Log "全部完成"
}

Main
