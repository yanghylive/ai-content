@echo off
setlocal
set OUT=C:\Users\Public\kaypal-install-test-1.1.37
set URL=http://192.168.64.1:8765/KaypalAI-Setup-1.1.37.exe
set TARGET=C:\Users\Public\KaypalAI-Setup-1.1.37-host.exe
set EXPECTED=2f011739d1a1d909efca92b24a29e3d054683f1881ea066a6d404ec1bd3d39ad
mkdir "%OUT%" >nul 2>&1
echo host-download-start %DATE% %TIME% > "%OUT%\host-download.log"
if exist "%TARGET%" del /f /q "%TARGET%" >> "%OUT%\host-download.log" 2>&1
curl.exe -L --fail --connect-timeout 10 --retry 2 -o "%TARGET%" "%URL%" > "%OUT%\host-download-curl.out" 2> "%OUT%\host-download-curl.err"
echo curl_exit %ERRORLEVEL% > "%OUT%\host-download-exit.txt"
dir "%TARGET%" > "%OUT%\host-download-dir.txt" 2>&1
certutil -hashfile "%TARGET%" SHA256 > "%OUT%\host-download-sha256.txt" 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$out='C:\Users\Public\kaypal-install-test-1.1.37'; $target='C:\Users\Public\KaypalAI-Setup-1.1.37-host.exe'; $expected='2f011739d1a1d909efca92b24a29e3d054683f1881ea066a6d404ec1bd3d39ad'; $hash=''; $length=0; if(Test-Path $target){ $length=(Get-Item $target).Length; $hash=(Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant() }; [ordered]@{ target=$target; length=$length; sha256=$hash; expectedSha256=$expected; ok=($hash -eq $expected); completedAt=(Get-Date).ToString('o') } | ConvertTo-Json -Depth 4 | Out-File -Encoding UTF8 (Join-Path $out 'host-download-result.json'); if($hash -ne $expected){ exit 2 }"
echo verify_exit %ERRORLEVEL% >> "%OUT%\host-download-exit.txt"
echo host-download-finished %DATE% %TIME% >> "%OUT%\host-download.log"
