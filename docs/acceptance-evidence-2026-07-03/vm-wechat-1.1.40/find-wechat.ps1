$ErrorActionPreference = "SilentlyContinue"
$roots = @("C:\Users", "C:\Program Files", "C:\Program Files (x86)")
$names = @("Weixin.exe", "WeChat.exe", "WeChatAppEx.exe")
$out = @()
foreach ($root in $roots) {
  foreach ($name in $names) {
    $out += Get-ChildItem -Path $root -Filter $name -Recurse -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
  }
}
$out | Sort-Object -Unique | Set-Content -Encoding UTF8 C:\Windows\Temp\kaypal_find_wechat_ps.txt
