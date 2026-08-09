$ErrorActionPreference = "Continue"
$out = "C:\Users\Public\kaypal-installed-test-1.1.34"
$names = @("diagnose", "contacts-random", "contacts-all")
$lines = @()
foreach ($name in $names) {
  $file = Join-Path $out ($name + ".json")
  $lines += "==== $name ===="
  if (!(Test-Path $file)) {
    $lines += "missing"
    continue
  }
  try {
    $obj = (Get-Content -Raw -Encoding UTF8 $file) | ConvertFrom-Json
    $lines += "ok=$($obj.ok) status=$($obj.status) errorCode=$($obj.errorCode) count=$($obj.count)"
    $lines += "nextAction=$($obj.nextAction)"
    if ($null -ne $obj.diagnostics) {
      $d = $obj.diagnostics
      $lines += "stage=$($d.stage) source=$($obj.source)"
      $lines += "failureReason=$($d.failureReason)"
      $lines += "windowStatus=$($d.windowStatus) process=$($d.processName)#$($d.processId) title=$($d.windowTitle)"
      $lines += "uiaStatus=$($d.uiaStatus) uiaContacts=$($d.uiaContacts) uiaScannedPages=$($d.uiaScannedPages) stopReason=$($d.uiaStopReason)"
      if ($null -ne $d.layers) {
        foreach ($prop in $d.layers.PSObject.Properties) {
          $layer = $prop.Value
          $lines += "layer.$($prop.Name).status=$($layer.status) code=$($layer.code) count=$($layer.count) error=$($layer.error)"
          if ($null -ne $layer.windowTitle) { $lines += "layer.$($prop.Name).windowTitle=$($layer.windowTitle)" }
          if ($null -ne $layer.stopReason) { $lines += "layer.$($prop.Name).stopReason=$($layer.stopReason)" }
        }
      }
      if ($null -ne $d.rawPreview) {
        $lines += "rawPreview=$([string]::Join(' | ', @($d.rawPreview | Select-Object -First 20)))"
      }
      if ($null -ne $d.ocrPreview) {
        $lines += "ocrPreview=$([string]::Join(' | ', @($d.ocrPreview | Select-Object -First 20)))"
      }
      if ($null -ne $d.uiaPreview) {
        $lines += "uiaPreview=$([string]::Join(' | ', @($d.uiaPreview | Select-Object -First 20)))"
      }
    }
  } catch {
    $lines += "parse_error=$($_.Exception.Message)"
  }
}
$lines | Out-File -Encoding utf8 "C:\Users\Public\kaypal-installed-test-details-1.1.34.txt"
