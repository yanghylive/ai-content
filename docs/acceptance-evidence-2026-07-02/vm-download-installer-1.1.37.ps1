$ErrorActionPreference = "Stop"
$out = "C:\Users\Public\kaypal-install-test-1.1.37"
$url = "https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/KaypalAI%E5%86%85%E5%AE%B9%E5%88%9B%E4%BD%9C%E5%B9%B3%E5%8F%B0%20Setup%201.1.37.exe"
$target = "C:\Users\Public\KaypalAI-Setup-1.1.37-oss.exe"
$expectedSha256 = "2f011739d1a1d909efca92b24a29e3d054683f1881ea066a6d404ec1bd3d39ad"
New-Item -ItemType Directory -Force -Path $out | Out-Null
"download-start $(Get-Date -Format o)" | Out-File -Encoding utf8 "$out\download.log"
if (Test-Path $target) {
  Remove-Item -Force $target
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
$item = Get-Item $target
$hash = (Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant()
[ordered]@{
  url = $url
  target = $target
  length = $item.Length
  sha256 = $hash
  expectedSha256 = $expectedSha256
  ok = ($hash -eq $expectedSha256)
  completedAt = (Get-Date -Format o)
} | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 "$out\download-result.json"
if ($hash -ne $expectedSha256) {
  throw "sha256 mismatch: $hash"
}
"download-finished $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 "$out\download.log"
