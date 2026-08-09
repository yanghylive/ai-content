@echo off
setlocal
set OUT=C:\Users\Public\kaypal-installed-test-1.1.34
rmdir /s /q "%OUT%" >nul 2>&1
mkdir "%OUT%" >nul 2>&1
set APP=C:\Users\signer\AppData\Local\Programs\ai-content-desktop
set NODE=%APP%\resources\runtime\node\bin\node.exe
set RUNTIME=%APP%\resources\wechat-native-runtime\kaypal-wechat-native-runtime.js
echo started %DATE% %TIME% > "%OUT%\test.log"
whoami >> "%OUT%\test.log" 2>&1
echo app=%APP% >> "%OUT%\test.log"
if not exist "%NODE%" echo missing_node >> "%OUT%\test.log"
if not exist "%RUNTIME%" echo missing_runtime >> "%OUT%\test.log"
"%NODE%" --version > "%OUT%\node-version.txt" 2> "%OUT%\node-version.err"
echo node_exit %ERRORLEVEL% >> "%OUT%\test.log"
"%NODE%" "%RUNTIME%" diagnose > "%OUT%\diagnose.json" 2> "%OUT%\diagnose.err"
echo diagnose_exit %ERRORLEVEL% >> "%OUT%\test.log"
"%NODE%" "%RUNTIME%" contacts --mode random > "%OUT%\contacts-random.json" 2> "%OUT%\contacts-random.err"
echo random_exit %ERRORLEVEL% >> "%OUT%\test.log"
"%NODE%" "%RUNTIME%" contacts --mode all > "%OUT%\contacts-all.json" 2> "%OUT%\contacts-all.err"
echo all_exit %ERRORLEVEL% >> "%OUT%\test.log"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$out='C:\Users\Public\kaypal-installed-test-1.1.34'; $files=@('diagnose','contacts-random','contacts-all'); $rows=@(); foreach($name in $files){ $file=Join-Path $out ($name + '.json'); $err=Join-Path $out ($name + '.err'); $raw=''; if(Test-Path $file){ $raw=Get-Content -Raw -Encoding UTF8 $file }; $obj=$null; try{ if($raw.Trim()){ $obj=$raw | ConvertFrom-Json } } catch{}; $rows += [ordered]@{ name=$name; ok=$obj.ok; status=$obj.status; errorCode=$obj.errorCode; count=$obj.count; outputCount=$obj.output.count; source=$obj.source; stage=$obj.diagnostics.stage; nextAction=$obj.nextAction; stderr=(if(Test-Path $err){ (Get-Content -Raw -Encoding UTF8 $err).Trim() } else { '' }) } }; }; $rows | ConvertTo-Json -Depth 6 | Out-File -Encoding UTF8 (Join-Path $out 'summary.json')"
echo finished %DATE% %TIME% >> "%OUT%\test.log"
echo done > "%OUT%\done.txt"
