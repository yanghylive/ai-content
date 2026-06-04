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

function Parse-Semver($text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $match = [regex]::Match($text, "(\d+)\.(\d+)(?:\.(\d+))?")
    if ($match.Success) {
        return "$($match.Groups[1].Value).$($match.Groups[2].Value)$(if ($match.Groups[3].Value) { ".$($match.Groups[3].Value)" })"
    }
    return $null
}

function Test-Python {
    $python = $null
    $version = $null

    $registryPaths = @(
        "HKLM:\SOFTWARE\Python\PythonCore\3.12\InstallPath",
        "HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore\3.12\InstallPath",
        "HKCU:\SOFTWARE\Python\PythonCore\3.12\InstallPath"
    )
    foreach ($regPath in $registryPaths) {
        $installPath = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue)."(default)"
        if (-not $installPath) {
            $installPath = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).InstallPath
        }
        if ($installPath) {
            $candidate = Join-Path $installPath "python.exe"
            if (Test-Path $candidate) {
                $python = $candidate
                $version = Read-VersionFromExe $candidate
                break
            }
        }
    }

    if (-not $python) {
        $fallbackPaths = @(
            "$env:ProgramFiles\Python312\python.exe",
            "${env:ProgramFiles(x86)}\Python312\python.exe",
            "$env:LocalAppData\Programs\Python\Python312\python.exe",
            "$env:LocalAppData\Programs\Python\Python313\python.exe",
            "C:\Python312\python.exe"
        )
        foreach ($p in $fallbackPaths) {
            if (Test-Path $p) {
                $python = $p
                $version = Read-VersionFromExe $p
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

    $registryPaths = @(
        "HKLM:\SOFTWARE\PostgreSQL\Installations\postgresql-x64-16",
        "HKLM:\SOFTWARE\PostgreSQL\Installations\postgresql-x64-15",
        "HKLM:\SOFTWARE\PostgreSQL\Installations\postgresql-x64-14"
    )
    foreach ($regPath in $registryPaths) {
        $baseDir = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue)."Base Directory"
        if ($baseDir) {
            $candidate = Join-Path $baseDir "bin\psql.exe"
            if (Test-Path $candidate) {
                $psql = $candidate
                $version = Read-VersionFromExe $candidate
                break
            }
        }
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

function Invoke-DetectAll {
    Test-Python
    Test-Postgres
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
