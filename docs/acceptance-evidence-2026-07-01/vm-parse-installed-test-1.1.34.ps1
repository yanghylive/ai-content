$ErrorActionPreference = "Continue"
$out = "C:\Users\Public\kaypal-installed-test-1.1.34"
$names = @("diagnose", "contacts-random", "contacts-all")
$lines = @()
foreach ($name in $names) {
  $file = Join-Path $out ($name + ".json")
  if (!(Test-Path $file)) {
    $lines += "$name missing"
    continue
  }
  $raw = Get-Content -Raw -Encoding UTF8 $file
  try {
    $obj = $raw | ConvertFrom-Json
    $count = ""
    if ($null -ne $obj.count) { $count = [string]$obj.count }
    elseif ($null -ne $obj.output -and $null -ne $obj.output.count) { $count = [string]$obj.output.count }
    $stage = ""
    if ($null -ne $obj.diagnostics -and $null -ne $obj.diagnostics.stage) { $stage = [string]$obj.diagnostics.stage }
    $source = ""
    if ($null -ne $obj.source) { $source = [string]$obj.source }
    elseif ($null -ne $obj.output -and $null -ne $obj.output.source) { $source = [string]$obj.output.source }
    $lines += "$name ok=$($obj.ok) status=$($obj.status) errorCode=$($obj.errorCode) count=$count source=$source stage=$stage"
  } catch {
    $lines += "$name parse_error=$($_.Exception.Message)"
  }
}
$lines += "---test.log---"
if (Test-Path (Join-Path $out "test.log")) {
  $lines += Get-Content -Encoding UTF8 (Join-Path $out "test.log")
}
$lines | Out-File -Encoding ascii "C:\Users\Public\kaypal-installed-test-summary-1.1.34.txt"
