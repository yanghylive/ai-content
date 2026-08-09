$ErrorActionPreference = "Continue"
$paths = @(
  "C:\Users\signer\AppData\Local\Programs",
  "C:\Users\signer\AppData\Local",
  "C:\Users\signer\AppData\Roaming",
  "C:\Program Files",
  "C:\Program Files (x86)",
  "C:\Windows\System32\config\systemprofile\AppData\Local\Programs",
  "C:\Windows\System32\config\systemprofile\AppData\Local",
  "C:\Windows\System32\config\systemprofile\AppData\Roaming"
)

$items = @()
foreach ($p in $paths) {
  if (Test-Path $p) {
    $items += Get-ChildItem -Path $p -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -like "*Kaypal*" -or
        $_.Name -like "*ai-content*" -or
        $_.FullName -like "*Kaypal*" -or
        $_.FullName -like "*ai-content*"
      } |
      Select-Object FullName, Length, LastWriteTime, Mode
  }
}

$items |
  Sort-Object FullName |
  ConvertTo-Json -Depth 4 |
  Out-File -Encoding utf8 "C:\Users\Public\kaypal-install-search-1.1.34.json"
