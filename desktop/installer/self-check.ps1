<#
.SYNOPSIS
  Verify that the installed KaypalAI Windows app is actually runnable.
.DESCRIPTION
  Prints every failed check and exits non-zero on failure. This script is used
  by the installer so a partial install is never presented as a usable app.
#>

param(
    [string] $InstallDir = "$env:ProgramFiles\KaypalAI"
)

$ErrorActionPreference = "Stop"
$Global:Failures = New-Object System.Collections.Generic.List[string]
$Global:PythonCandidate = $null

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

function Parse-Semver {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    $match = [regex]::Match($Text, "(\d+)\.(\d+)(?:\.(\d+))?")
    if (-not $match.Success) { return $null }
    $patch = if ($match.Groups[3].Success) { $match.Groups[3].Value } else { "0" }
    return [version]"$($match.Groups[1].Value).$($match.Groups[2].Value).$patch"
}

function Invoke-Version {
    param(
        [string]$ExePath,
        [string[]]$Args = @("--version")
    )
    try {
        $output = & $ExePath @Args 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { return $null }
        return $output.Trim()
    } catch {
        return $null
    }
}

function Test-Python312 {
    param(
        [string]$ExePath,
        [string[]]$Args = @("--version"),
        [string]$Label
    )

    if ($ExePath -match "^[A-Za-z]:\\" -and -not (Test-Path -LiteralPath $ExePath -PathType Leaf)) { return $false }
    $raw = Invoke-Version -ExePath $ExePath -Args $Args
    $version = Parse-Semver $raw
    if ($version -and $version.Major -eq 3 -and $version.Minor -ge 12) {
        $Global:PythonCandidate = [PSCustomObject]@{
            Command = $ExePath
            BaseArgs = @($Args | Where-Object { $_ -ne "--version" })
            Version = $raw
        }
        $cmdText = "$ExePath $($Global:PythonCandidate.BaseArgs -join ' ')".Trim()
        Write-Check "$Label usable: $cmdText ($raw)"
        return $true
    }

    Write-Check "$Label is not Python 3.12: $ExePath ($raw)" "WARN"
    return $false
}

function Get-SystemPythonCandidates {
    $candidates = New-Object System.Collections.Generic.List[object]
    foreach ($cmd in @("python", "python3")) {
        $command = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($command -and $command.Source -and -not $candidates.Contains($command.Source)) {
            $candidates.Add([PSCustomObject]@{ Command = $command.Source; Args = @("--version"); Label = "system Python" }) | Out-Null
        }
    }
    $py = Get-Command "py" -ErrorAction SilentlyContinue
    if ($py -and $py.Source) {
        $candidates.Add([PSCustomObject]@{ Command = $py.Source; Args = @("-3.12", "--version"); Label = "Python launcher" }) | Out-Null
    }

    foreach ($path in @(
        "$env:ProgramFiles\Python312\python.exe",
        "${env:ProgramFiles(x86)}\Python312\python.exe",
        "$env:ProgramFiles\Python312\python.exe",
        "$env:LocalAppData\Programs\Python\Python312\python.exe",
        "C:\Python312\python.exe"
    )) {
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
            $candidates.Add([PSCustomObject]@{ Command = $path; Args = @("--version"); Label = "system Python" }) | Out-Null
        }
    }

    return $candidates
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

function Find-PostgresBin {
    foreach ($dir in @(
        "$env:ProgramFiles\PostgreSQL\16\bin",
        "$env:ProgramFiles\PostgreSQL\15\bin",
        "$env:ProgramFiles\PostgreSQL\14\bin",
        "${env:ProgramFiles(x86)}\PostgreSQL\16\bin"
    )) {
        if ($dir) {
            $psql = Join-Path $dir "psql.exe"
            if (Test-Path -LiteralPath $psql -PathType Leaf) {
                return $dir
            }
        }
    }

    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return (Split-Path $cmd.Source -Parent)
    }

    return $null
}

function Test-PostgresDatabase {
    $pgBin = Find-PostgresBin
    if (-not $pgBin) {
        Add-Failure "PostgreSQL psql.exe missing or not on PATH"
        return $false
    }

    $psql = Join-Path $pgBin "psql.exe"
    $env:PGPASSWORD = "ai_content_2026"
    $output = & $psql -h 127.0.0.1 -p 5432 -U postgres -d ai_content -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='users';" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Add-Failure "PostgreSQL ai_content database not reachable: $($output | Out-String)"
        return $false
    }
    if (($output | Out-String).Trim() -ne "1") {
        Add-Failure "PostgreSQL ai_content database is missing migrated tables"
        return $false
    }

    Write-Check "PostgreSQL ai_content database reachable and migrated"
    return $true
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

function Test-CanCreateVenv {
    if (-not $Global:PythonCandidate) {
        Add-Failure "Python 3.12 candidate missing, cannot verify venv creation"
        return $false
    }

    $tmpVenv = Join-Path $env:TEMP "kaypalai-venv-check-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
    try {
        $args = @($Global:PythonCandidate.BaseArgs) + @("-m", "venv", $tmpVenv)
        $output = & $Global:PythonCandidate.Command @args 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tmpVenv -PathType Container)) {
            Add-Failure "Python 3.12 cannot create venv: $($output.Trim())"
            return $false
        }
        Write-Check "Python 3.12 venv creation works"
        return $true
    } catch {
        Add-Failure "Python 3.12 venv creation failed: $($_.Exception.Message)"
        return $false
    } finally {
        Remove-Item $tmpVenv -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Main {
    Write-Host "========== KaypalAI install self-check =========="
    Write-Host "InstallDir: $InstallDir"

    $resourcesDir = Join-Path $InstallDir "resources"
    $asarPath = Join-Path $resourcesDir "app.asar"
    $backendDir = Join-Path $resourcesDir "backend"
    $frontendDir = Join-Path $resourcesDir "frontend"
    $autoUploadMain = Join-Path $resourcesDir "auto-upload\main.py"
    $agentSMain = Join-Path $resourcesDir "agent-s-executor\main.py"

    Test-DirectoryRequired -Path $InstallDir -Label "install directory" | Out-Null
    Test-FileRequired -Path (Join-Path $InstallDir "KaypalAI.exe") -Label "KaypalAI.exe" | Out-Null
    Test-DirectoryRequired -Path $resourcesDir -Label "resources directory" | Out-Null
    Test-FileRequired -Path $asarPath -Label "resources/app.asar" | Out-Null
    Test-DirectoryRequired -Path $backendDir -Label "resources/backend" | Out-Null
    Test-DirectoryRequired -Path $frontendDir -Label "resources/frontend" | Out-Null
    Test-FileRequired -Path (Join-Path $frontendDir "index.html") -Label "resources/frontend/index.html" | Out-Null
    Test-DirectoryRequired -Path (Join-Path $frontendDir "_next") -Label "resources/frontend/_next" | Out-Null
    Test-FileRequired -Path $autoUploadMain -Label "resources/auto-upload/main.py" | Out-Null
    Test-FileRequired -Path (Join-Path $resourcesDir "auto-upload\requirements.txt") -Label "resources/auto-upload/requirements.txt" | Out-Null
    Test-FileRequired -Path $agentSMain -Label "resources/agent-s-executor/main.py" | Out-Null
    Test-FileRequired -Path (Join-Path $resourcesDir "agent-s-executor\requirements.txt") -Label "resources/agent-s-executor/requirements.txt" | Out-Null
    Test-FileRequired -Path (Join-Path $backendDir "client\query_engine-windows.dll.node") -Label "Prisma Windows query engine" | Out-Null
    Test-Icon -InstallDir $InstallDir -AsarPath $asarPath | Out-Null
    Test-NodeModuleOrAsarEntry -ModuleName "electron-store" -ResourcesDir $resourcesDir -AsarPath $asarPath | Out-Null
    Test-NodeModuleOrAsarEntry -ModuleName "fix-path" -ResourcesDir $resourcesDir -AsarPath $asarPath | Out-Null
    Test-PostgresDatabase | Out-Null

    $bundledPythonCandidates = @(
        (Join-Path $resourcesDir "runtime\python\python.exe"),
        (Join-Path $resourcesDir "python\python.exe"),
        (Join-Path $resourcesDir "backend\python\python.exe"),
        (Join-Path $InstallDir "python\python.exe")
    )

    $pythonOk = $false
    foreach ($python in $bundledPythonCandidates) {
        if (Test-Path -LiteralPath $python -PathType Leaf) {
            $pythonOk = Test-Python312 -ExePath $python -Label "bundled Python"
            break
        }
    }

    if (-not $pythonOk) {
        foreach ($python in Get-SystemPythonCandidates) {
            if (Test-Python312 -ExePath $python.Command -Args $python.Args -Label $python.Label) {
                $pythonOk = $true
                break
            }
        }
    }

    if (-not $pythonOk) {
        Add-Failure "Python 3.12 missing or unusable; install bundled Python or system Python 3.12"
    } else {
        Test-CanCreateVenv | Out-Null
    }

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
