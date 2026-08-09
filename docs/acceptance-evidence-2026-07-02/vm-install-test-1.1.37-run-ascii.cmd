@echo off
setlocal
set OUT=C:\Users\Public\kaypal-install-test-1.1.37b
set INSTALLER=C:\Users\Public\KaypalAI-Setup-1.1.37-host.exe
set APP=C:\Users\signer\AppData\Local\Programs\ai-content-desktop
set NODE=%APP%\resources\runtime\node\bin\node.exe
set RUNTIME=%APP%\resources\wechat-native-runtime\kaypal-wechat-native-runtime.js
set HELPER=%APP%\resources\wechat-db-helper\wechat-db-helper.js
set BACKEND=%APP%\resources\backend\index.js
rmdir /s /q "%OUT%" >nul 2>&1
mkdir "%OUT%" >nul 2>&1
echo started > "%OUT%\test.log"
whoami >> "%OUT%\test.log" 2>&1
echo installer=%INSTALLER% >> "%OUT%\test.log"
echo app=%APP% >> "%OUT%\test.log"
taskkill /F /IM node.exe >> "%OUT%\test.log" 2>&1
echo install-start >> "%OUT%\test.log"
start "" /wait "%INSTALLER%" /S /NCRC
echo installer_exit %ERRORLEVEL% >> "%OUT%\test.log"
timeout /t 10 /nobreak >nul
dir "%APP%" > "%OUT%\appdir.txt" 2>&1
if exist "%NODE%" (
  "%NODE%" --version > "%OUT%\node-version.txt" 2> "%OUT%\node-version.err"
) else (
  echo missing_node > "%OUT%\node-version.err"
)
if exist "%RUNTIME%" (
  "%NODE%" "%RUNTIME%" contract > "%OUT%\runtime-contract.json" 2> "%OUT%\runtime-contract.err"
  "%NODE%" "%RUNTIME%" diagnose > "%OUT%\diagnose.json" 2> "%OUT%\diagnose.err"
  "%NODE%" "%RUNTIME%" contacts --mode random > "%OUT%\contacts-random.json" 2> "%OUT%\contacts-random.err"
  "%NODE%" "%RUNTIME%" contacts --mode all > "%OUT%\contacts-all.json" 2> "%OUT%\contacts-all.err"
) else (
  echo missing_runtime > "%OUT%\runtime-contract.err"
  echo missing_runtime > "%OUT%\diagnose.err"
  echo missing_runtime > "%OUT%\contacts-random.err"
  echo missing_runtime > "%OUT%\contacts-all.err"
)
if exist "%HELPER%" (
  "%NODE%" "%HELPER%" contract > "%OUT%\helper-contract.json" 2> "%OUT%\helper-contract.err"
  "%NODE%" "%HELPER%" diagnose > "%OUT%\helper-diagnose.json" 2> "%OUT%\helper-diagnose.err"
) else (
  echo missing_helper > "%OUT%\helper-contract.err"
  echo missing_helper > "%OUT%\helper-diagnose.err"
)
if exist "%BACKEND%" (
  findstr /C:"AI_CONTENT_WECHAT_CONTACT_DB_ONLY" "%BACKEND%" > "%OUT%\db-only-gate.txt" 2> "%OUT%\db-only-gate.err"
) else (
  echo missing_backend > "%OUT%\db-only-gate.err"
)
tasklist /FI "IMAGENAME eq Weixin.exe" /FO CSV > "%OUT%\tasklist-weixin.txt" 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$out='C:\Users\Public\kaypal-install-test-1.1.37b'; $names=@('runtime-contract','diagnose','contacts-random','contacts-all','helper-contract','helper-diagnose'); $rows=@(); foreach($name in $names){ $file=Join-Path $out ($name + '.json'); $err=Join-Path $out ($name + '.err'); $raw=''; if(Test-Path $file){ $raw=Get-Content -Raw -Encoding UTF8 $file }; $obj=$null; try{ if($raw.Trim()){ $obj=$raw | ConvertFrom-Json } } catch{}; $diag=$obj.diagnostics; $rows += [ordered]@{ name=$name; ok=$obj.ok; status=$obj.status; errorCode=$obj.errorCode; mode=$obj.mode; count=$obj.count; source=$obj.source; diagSource=$diag.source; resultSource=$diag.resultSource; dbStatus=$diag.dbStatus; dbKeyStatus=$diag.dbKeyStatus; decryptionStatus=$diag.decryptionStatus; keyHelperStatus=$diag.keyHelperStatus; failureReason=$diag.failureReason; stderr=(if(Test-Path $err){ (Get-Content -Raw -Encoding UTF8 $err).Trim() } else { '' }) } }; }; $summary=[ordered]@{ generatedAt=(Get-Date).ToString('o'); installer=$env:INSTALLER; app=$env:APP; rows=$rows }; $summary | ConvertTo-Json -Depth 8 | Out-File -Encoding UTF8 (Join-Path $out 'summary.json')"
echo finished >> "%OUT%\test.log"
echo done > "%OUT%\done.txt"
