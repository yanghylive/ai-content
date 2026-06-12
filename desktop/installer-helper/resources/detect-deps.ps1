<#
.SYNOPSIS
  KaypalAI one-click desktop dependency detector.
.DESCRIPTION
  The desktop package bundles its runtime: Node, SQLite, Playwright Chromium,
  Prisma engine, and Node Agent runtime. It must not ask end users to install
  Python, Node, Postgres, Redis, Chrome, or any other local runtime.
#>

$ErrorActionPreference = "Stop"

$Global:DetectedDeps = @{}

function Invoke-DetectAll {
    return $Global:DetectedDeps
}

if ($MyInvocation.InvocationName -ne "&") {
    @{} | ConvertTo-Json -Depth 3 -Compress
}
