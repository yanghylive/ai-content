<#
.SYNOPSIS
  Verify that the installed JIUZHANG AI Windows app is actually runnable.
.DESCRIPTION
  Prints every failed check and exits non-zero on failure. This script is used
  by the installer so a partial install is never presented as a usable app.
#>

param(
    [string] $InstallDir = "$env:ProgramFiles\JIUZHANG AI"
)

$ErrorActionPreference = "Stop"
$Global:Failures = New-Object System.Collections.Generic.List[string]

function Write-Check {
    param([string]$Message, [string]$Level = "INFO")
    $prefix = if ($Level -eq "ERROR") { "[FAIL]" } elseif ($Level -eq "WARN") { "[WARN]" } else { "[ OK ]" }
    Write-Host "$prefix $Message"
}

function Add-Failure {
    param([string]$Reason)
    $Global:Failures.Add($Reason) | Out-Null
    Write-Check $Reason "ERROR"
}

function Test-FileRequired {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Add-Failure "$Label missing: $Path"
        return $false
    }
    Write-Check "$Label found: $Path"
    return $true
}

function Test-DirectoryRequired {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        Add-Failure "$Label missing: $Path"
        return $false
    }
    Write-Check "$Label found: $Path"
    return $true
}

function Test-FileContains {
    param([string]$Path, [string]$Label, [string]$Pattern)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Add-Failure "$Label missing: $Path"
        return $false
    }
    $content = Get-Content -LiteralPath $Path -Raw
    if ($content -notmatch $Pattern) {
        Add-Failure "$Label does not contain expected setting: $Pattern"
        return $false
    }
    Write-Check "$Label contains expected setting"
    return $true
}

function Test-FileNotContains {
    param([string]$Path, [string]$Label, [string]$Pattern)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Add-Failure "$Label missing: $Path"
        return $false
    }
    $content = Get-Content -LiteralPath $Path -Raw
    if ($content -match $Pattern) {
        Add-Failure "$Label contains forbidden pattern: $Pattern"
        return $false
    }
    Write-Check "$Label does not contain forbidden pattern"
    return $true
}

function Test-BundledChromium {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        Add-Failure "bundled Playwright Chromium root missing: $Path"
        return $false
    }
    $chrome = Get-ChildItem -LiteralPath $Path -Recurse -Filter "chrome.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $chrome) {
        Add-Failure "bundled Playwright Chromium executable missing under: $Path"
        return $false
    }
    Write-Check "bundled Playwright Chromium found: $($chrome.FullName)"
    return $true
}

function Test-AsarContains {
    param(
        [string]$AsarPath,
        [string[]]$Names
    )

    if (-not (Test-Path -LiteralPath $AsarPath -PathType Leaf)) { return $false }
    try {
        $stream = [System.IO.File]::OpenRead($AsarPath)
        try {
            $length = [Math]::Min($stream.Length, 1048576)
            $buffer = New-Object byte[] $length
            [void]$stream.Read($buffer, 0, $length)
            $headerText = [System.Text.Encoding]::UTF8.GetString($buffer)
            foreach ($name in $Names) {
                if ($headerText -notmatch [regex]::Escape($name)) { return $false }
            }
            return $true
        } finally {
            $stream.Dispose()
        }
    } catch {
        return $false
    }
}

function Test-NodeModuleOrAsarEntry {
    param(
        [string]$ModuleName,
        [string]$ResourcesDir,
        [string]$AsarPath
    )

    $modulePaths = @(
        (Join-Path $ResourcesDir "app.asar.unpacked\node_modules\$ModuleName"),
        (Join-Path $ResourcesDir "app\node_modules\$ModuleName"),
        (Join-Path $InstallDir "node_modules\$ModuleName")
    )

    foreach ($path in $modulePaths) {
        if (Test-Path -LiteralPath $path -PathType Container) {
            Write-Check "$ModuleName found: $path"
            return $true
        }
    }

    if (Test-AsarContains -AsarPath $AsarPath -Names @($ModuleName)) {
        Write-Check "$ModuleName found inside app.asar"
        return $true
    }

    Add-Failure "$ModuleName missing from node_modules/app.asar"
    return $false
}

function Test-Icon {
    param(
        [string]$InstallDir,
        [string]$AsarPath
    )

    $iconPaths = @(
        (Join-Path $InstallDir "assets\icon.ico"),
        (Join-Path $InstallDir "resources\assets\icon.ico"),
        (Join-Path $InstallDir "resources\app\assets\icon.ico")
    )
    foreach ($path in $iconPaths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Write-Check "icon found: $path"
            return $true
        }
    }

    if (Test-AsarContains -AsarPath $AsarPath -Names @("icon.ico")) {
        Write-Check "icon found inside app.asar"
        return $true
    }

    Add-Failure "assets/icon.ico missing and no icon.ico entry found in app.asar"
    return $false
}

function Main {
    Write-Host "========== JIUZHANG AI install self-check =========="
    Write-Host "InstallDir: $InstallDir"

    $resourcesDir = Join-Path $InstallDir "resources"
    $asarPath = Join-Path $resourcesDir "app.asar"
    $backendDir = Join-Path $resourcesDir "backend"
    $frontendDir = Join-Path $resourcesDir "frontend"

    Test-DirectoryRequired -Path $InstallDir -Label "install directory" | Out-Null
    Test-FileRequired -Path (Join-Path $InstallDir "JIUZHANG AI.exe") -Label "JIUZHANG AI.exe" | Out-Null
    Test-DirectoryRequired -Path $resourcesDir -Label "resources directory" | Out-Null
    Test-FileRequired -Path $asarPath -Label "resources/app.asar" | Out-Null
    Test-DirectoryRequired -Path $backendDir -Label "resources/backend" | Out-Null
    Test-DirectoryRequired -Path $frontendDir -Label "resources/frontend" | Out-Null
    Test-FileRequired -Path (Join-Path $frontendDir "index.html") -Label "resources/frontend/index.html" | Out-Null
    Test-DirectoryRequired -Path (Join-Path $frontendDir "_next") -Label "resources/frontend/_next" | Out-Null
    Test-FileRequired -Path (Join-Path $backendDir "client\query_engine-windows.dll.node") -Label "Prisma Windows query engine" | Out-Null
    Test-FileRequired -Path (Join-Path $resourcesDir "runtime\node\bin\node.exe") -Label "bundled Node runtime" | Out-Null
    Test-FileRequired -Path (Join-Path $backendDir "node_modules\@playwright\mcp\cli.js") -Label "bundled @playwright/mcp CLI" | Out-Null
    Test-FileRequired -Path (Join-Path $backendDir "node_modules\playwright\package.json") -Label "bundled Playwright package" | Out-Null
    Test-FileRequired -Path (Join-Path $backendDir "node_modules\playwright-core\package.json") -Label "bundled Playwright Core package" | Out-Null
    Test-BundledChromium -Path (Join-Path $resourcesDir "playwright-browsers") | Out-Null
    Test-FileRequired -Path (Join-Path $backendDir "prisma\schema.sqlite.prisma") -Label "SQLite Prisma schema" | Out-Null
    Test-FileRequired -Path (Join-Path $backendDir ".env") -Label "backend/.env" | Out-Null
    Test-FileContains -Path (Join-Path $backendDir ".env") -Label "backend SQLite mode" -Pattern "KAYPAL_DESKTOP_DATABASE_MODE=sqlite" | Out-Null
    Test-FileContains -Path (Join-Path $backendDir ".env") -Label "backend SQLite URL" -Pattern "SQLITE_DATABASE_URL=file:" | Out-Null
    Test-FileContains -Path (Join-Path $backendDir ".env") -Label "backend Node Agent Runtime" -Pattern "KAYPAL_NODE_AGENT_RUNTIME=1" | Out-Null
    Test-FileNotContains -Path (Join-Path $backendDir ".env") -Label "backend env external services" -Pattern "postgres|redis" | Out-Null
    Test-FileNotContains -Path (Join-Path $backendDir "index.js") -Label "Agent-S runtime mock guard" -Pattern "runner_mode:\s*['""]mock['""]|browserControl:\s*false|mock-compatible|browserExecution:\s*false" | Out-Null
    Test-Icon -InstallDir $InstallDir -AsarPath $asarPath | Out-Null
    Test-NodeModuleOrAsarEntry -ModuleName "electron-store" -ResourcesDir $resourcesDir -AsarPath $asarPath | Out-Null
    Test-NodeModuleOrAsarEntry -ModuleName "fix-path" -ResourcesDir $resourcesDir -AsarPath $asarPath | Out-Null

    if ($Global:Failures.Count -gt 0) {
        Write-Host ""
        Write-Host "========== Self-check failed =========="
        foreach ($failure in $Global:Failures) {
            Write-Host " - $failure"
        }
        exit 1
    }

    Write-Host "========== Self-check passed =========="
    exit 0
}

Main
