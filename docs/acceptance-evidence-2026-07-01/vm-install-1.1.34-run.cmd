@echo off
setlocal
set OUT=C:\Users\Public\kaypal-install-1.1.34
mkdir "%OUT%" >nul 2>&1
echo started %DATE% %TIME% > "%OUT%\install.log"
whoami >> "%OUT%\install.log" 2>&1
taskkill /F /IM "ai-content-desktop.exe" >> "%OUT%\install.log" 2>&1
echo running_installer >> "%OUT%\install.log"
start "" /wait "C:\Users\Public\KaypalAI-Setup-1.1.34.exe" /S /NCRC
echo installer_exit %ERRORLEVEL% >> "%OUT%\install.log"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$out='C:\Users\Public\kaypal-install-1.1.34'; Start-Sleep -Seconds 8; $programRoots=@($env:LOCALAPPDATA + '\Programs', $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ -and (Test-Path $_) }; $hits=@(); foreach($root in $programRoots){ $hits += Get-ChildItem -Path $root -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Kaypal*' -or $_.FullName -like '*ai-content*' } | Select-Object FullName,Length,LastWriteTime }; $hits | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 ($out + '\installed-exes.json'); Get-ChildItem -Path $programRoots -Recurse -Directory -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like '*Kaypal*' -or $_.FullName -like '*ai-content*' } | Select-Object FullName,LastWriteTime | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 ($out + '\installed-dirs.json')"
echo finished %DATE% %TIME% >> "%OUT%\install.log"
echo done > "%OUT%\done.txt"
