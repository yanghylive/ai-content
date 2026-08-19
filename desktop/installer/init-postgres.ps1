<#
.SYNOPSIS
  Legacy PostgreSQL initializer retained only for old package rollback.
.DESCRIPTION
  Current desktop product mode uses SQLite and does not call this script.
#>

param(
    [string] $InstallDir = "$env:ProgramFiles\JIUZHANG AI",
    [string] $DatabaseName = "ai_content",
    [string] $User = "postgres",
    # 不内置明文口令：使用本脚本时必须显式传入 -Password（旧包回滚场景由回滚方提供）
    [string] $Password = "",
    [int] $Port = 5432
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string] $Message)
    Write-Host "[PG] $Message"
}

function Find-PostgresBin {
    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($root in @(
        "$env:ProgramFiles\PostgreSQL\16\bin",
        "$env:ProgramFiles\PostgreSQL\15\bin",
        "$env:ProgramFiles\PostgreSQL\14\bin",
        "${env:ProgramFiles(x86)}\PostgreSQL\16\bin"
    )) {
        if ($root -and -not $candidates.Contains($root)) {
            $candidates.Add($root) | Out-Null
        }
    }

    $psqlCmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($psqlCmd -and $psqlCmd.Source) {
        $candidates.Add((Split-Path $psqlCmd.Source -Parent)) | Out-Null
    }

    foreach ($dir in $candidates) {
        $psql = Join-Path $dir "psql.exe"
        if (Test-Path -LiteralPath $psql -PathType Leaf) {
            return $dir
        }
    }

    throw "找不到 psql.exe，请确认 PostgreSQL 已安装。"
}

function Ensure-PostgresService {
    $service = Get-Service -Name "postgresql-x64-16" -ErrorAction SilentlyContinue
    if (-not $service) {
        $service = Get-Service -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "postgresql*" } |
            Select-Object -First 1
    }

    if ($service -and $service.Status -ne "Running") {
        Write-Step "启动 PostgreSQL 服务: $($service.Name)"
        Start-Service -Name $service.Name
        $service.WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
    }
}

function Invoke-Psql {
    param(
        [string] $Database,
        [string[]] $Args
    )

    $env:PGPASSWORD = $Password
    $psql = Join-Path $Global:PostgresBin "psql.exe"
    $baseArgs = @(
        "-h", "127.0.0.1",
        "-p", "$Port",
        "-U", $User,
        "-d", $Database,
        "-v", "ON_ERROR_STOP=1"
    )
    & $psql @baseArgs @Args
    if ($LASTEXITCODE -ne 0) {
        throw "psql 执行失败，退出码 $LASTEXITCODE"
    }
}

function Get-Scalar {
    param([string] $Database, [string] $Sql)
    $env:PGPASSWORD = $Password
    $psql = Join-Path $Global:PostgresBin "psql.exe"
    $output = & $psql -h 127.0.0.1 -p $Port -U $User -d $Database -tAc $Sql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "psql 查询失败: $output"
    }
    return ($output | Out-String).Trim()
}

function Ensure-Database {
    $exists = Get-Scalar -Database "postgres" -Sql "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName';"
    if ($exists -eq "1") {
        Write-Step "数据库已存在: $DatabaseName"
        return
    }

    Write-Step "创建数据库: $DatabaseName"
    $quotedDb = '"' + ($DatabaseName -replace '"', '""') + '"'
    Invoke-Psql -Database "postgres" -Args @("-c", "CREATE DATABASE $quotedDb;")
}

function Ensure-MigrationTable {
    Invoke-Psql -Database $DatabaseName -Args @(
        "-c",
        "CREATE TABLE IF NOT EXISTS _prisma_migrations (
            id VARCHAR(36) PRIMARY KEY,
            checksum VARCHAR(64) NOT NULL,
            finished_at TIMESTAMPTZ,
            migration_name VARCHAR(255) NOT NULL UNIQUE,
            logs TEXT,
            rolled_back_at TIMESTAMPTZ,
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            applied_steps_count INTEGER NOT NULL DEFAULT 0
        );"
    )
}

function Get-FileChecksum {
    param([string] $Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Apply-Migrations {
    $migrationsDir = Join-Path $InstallDir "resources\backend\prisma\migrations"
    if (-not (Test-Path -LiteralPath $migrationsDir -PathType Container)) {
        throw "找不到 Prisma migrations: $migrationsDir"
    }

    Ensure-MigrationTable

    $migrations = Get-ChildItem -LiteralPath $migrationsDir -Directory |
        Sort-Object Name

    foreach ($migration in $migrations) {
        $migrationName = $migration.Name
        $sqlFile = Join-Path $migration.FullName "migration.sql"
        if (-not (Test-Path -LiteralPath $sqlFile -PathType Leaf)) {
            continue
        }

        $applied = Get-Scalar -Database $DatabaseName -Sql "SELECT 1 FROM _prisma_migrations WHERE migration_name = '$migrationName' AND finished_at IS NOT NULL;"
        if ($applied -eq "1") {
            Write-Step "跳过已应用迁移: $migrationName"
            continue
        }

        Write-Step "应用迁移: $migrationName"
        Invoke-Psql -Database $DatabaseName -Args @("-f", $sqlFile)

        $checksum = Get-FileChecksum -Path $sqlFile
        $id = [Guid]::NewGuid().ToString()
        Invoke-Psql -Database $DatabaseName -Args @(
            "-c",
            "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
             VALUES ('$id', '$checksum', now(), '$migrationName', NULL, NULL, now(), 1)
             ON CONFLICT (migration_name) DO UPDATE
             SET checksum = EXCLUDED.checksum,
                 finished_at = EXCLUDED.finished_at,
                 rolled_back_at = NULL,
                 logs = NULL,
                 applied_steps_count = EXCLUDED.applied_steps_count;"
        )
    }
}

function Main {
    if (-not $Password) {
        throw "缺少 -Password 参数：本脚本不内置 PostgreSQL 明文口令，必须显式传入。"
    }
    Write-Step "开始初始化 PostgreSQL"
    $Global:PostgresBin = Find-PostgresBin
    Write-Step "PostgreSQL bin: $Global:PostgresBin"
    Ensure-PostgresService
    Ensure-Database
    Apply-Migrations
    Write-Step "PostgreSQL 初始化完成"
}

Main
