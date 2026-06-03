<#
.SYNOPSIS
  检测 Windows 上 AI 内容平台需要的依赖。
.DESCRIPTION
  返回 JSON: { "depName": { installed: bool, version: string|null, path: string|null, action: "skip"|"download"|"optional" } }
#>

$ErrorActionPreference = "SilentlyContinue"

$Global:DetectedDeps = @{}

function Read-VersionFromExe($exePath) {
    if (-not (Test-Path $exePath)) { return $null }
    $file = Get-Item $exePath -ErrorAction SilentlyContinue
    if ($null -eq $file) { return $null }
    return $file.VersionInfo.FileVersionRaw.ToString() 2>$null
}

function Get-CmdVersion($cmd, $args = @("--version")) {
    try {
        $output = & $cmd @args 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) { return $output.Trim() }
    } catch {}
    return $null
}

function Parse-Semver($text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $match = [regex]::Match($text, "(\d+)\.(\d+)(?:\.(\d+))?")
    if ($match.Success) {
        return "$($match.Groups[1].Value).$($match.Groups[2].Value)$(if ($match.Groups[3].Value) { ".$($match.Groups[3].Value)" })"
    }
    return $null
}

function Test-Node {
    $node = $null
    $paths = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        (Get-Command node -ErrorAction SilentlyContinue).Source
    )
    foreach ($p in $paths) { if ($p -and (Test-Path $p)) { $node = $p; break } }

    $version = $null
    if ($node) {
        $raw = Get-CmdVersion "node"
        $version = Parse-Semver $raw
    }

    $Global:DetectedDeps["node"] = @{
        installed = [bool]$node
        version   = $version
        path      = $node
    }
}

function Test-Python {
    $python = $null
    $candidates = @("python", "python3", "py")
    foreach ($cmd in $candidates) {
        $path = (Get-Command $cmd -ErrorAction SilentlyContinue).Source
        if ($path) {
            $raw = Get-CmdVersion $cmd
            $v = Parse-Semver $raw
            if ($v) {
                $major = [int]($v.Split(".")[0])
                if ($major -ge 3) {
                    $python = $path
                    $version = $v
                    break
                }
            }
        }
    }

    if (-not $python) {
        $fallbackPaths = @(
            "$env:LocalAppData\Programs\Python\Python311\python.exe",
            "$env:LocalAppData\Programs\Python\Python312\python.exe",
            "$env:LocalAppData\Programs\Python\Python313\python.exe",
            "C:\Python311\python.exe",
            "C:\Python312\python.exe"
        )
        foreach ($p in $fallbackPaths) {
            if (Test-Path $p) {
                $python = $p
                $version = Read-VersionFromExe $p
                if (-not $version) { $version = "3.x" }
                break
            }
        }
    }

    $Global:DetectedDeps["python"] = @{
        installed = [bool]$python
        version   = $version
        path      = $python
    }
}

function Test-Postgres {
    $psql = $null
    $version = $null
    $psqlPath = (Get-Command psql -ErrorAction SilentlyContinue).Source
    if ($psqlPath) {
        $psql = $psqlPath
        $raw = Get-CmdVersion "psql"
        $version = Parse-Semver $raw
    }

    if (-not $psql) {
        $pgRoot = "C:\Program Files\PostgreSQL"
        if (Test-Path $pgRoot) {
            $latest = Get-ChildItem $pgRoot -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match "^\d+$" } |
                Sort-Object { [int]$_.Name } -Descending |
                Select-Object -First 1
            if ($latest) {
                $candidate = Join-Path $latest.FullName "bin\psql.exe"
                if (Test-Path $candidate) {
                    $psql = $candidate
                    $version = Read-VersionFromExe $candidate
                }
            }
        }
    }

    $Global:DetectedDeps["postgres"] = @{
        installed = [bool]$psql
        version   = $version
        path      = $psql
    }
}

function Test-Redis {
    $redis = $null
    $version = $null
    $redisPath = (Get-Command redis-cli -ErrorAction SilentlyContinue).Source
    if ($redisPath) {
        $redis = $redisPath
        $raw = Get-CmdVersion "redis-cli"
        $version = Parse-Semver $raw
    }

    if (-not $redis) {
        $memuraiSvc = Get-Service Memurai -ErrorAction SilentlyContinue
        if ($memuraiSvc) {
            $redis = "Memurai service"
            $version = "installed"
        }
    }

    $Global:DetectedDeps["redis"] = @{
        installed = [bool]$redis
        version   = $version
        path      = $redis
    }
}

function Test-Chrome {
    $chrome = $null
    $version = $null

    $regPaths = @(
        "HKLM:\SOFTWARE\Google\Chrome\BLBeacon",
        "HKLM:\SOFTWARE\WOW6432Node\Google\Chrome\BLBeacon"
    )
    foreach ($regPath in $regPaths) {
        $v = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).version
        if ($v) {
            $version = $v
            $chrome = "Google Chrome"
            break
        }
    }

    if (-not $chrome) {
        $chromePath = @(
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($chromePath) {
            $chrome = $chromePath
            $version = Read-VersionFromExe $chromePath
        }
    }

    $Global:DetectedDeps["chrome"] = @{
        installed = [bool]$chrome
        version   = $version
        path      = $chrome
    }
}

function Invoke-DetectAll {
    Test-Node
    Test-Python
    Test-Postgres
    Test-Redis
    Test-Chrome
    return $Global:DetectedDeps
}

if ($MyInvocation.InvocationName -ne "&") {
    $result = Invoke-DetectAll
    $output = @{}
    foreach ($key in $result.Keys) {
        $output[$key] = @{
            installed = $result[$key].installed
            version   = $result[$key].version
        }
    }
    $output | ConvertTo-Json -Depth 3 -Compress
}
