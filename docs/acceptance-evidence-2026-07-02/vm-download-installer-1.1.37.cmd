@echo off
set OUT=C:\Users\Public\kaypal-install-test-1.1.37
mkdir "%OUT%" >nul 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Windows\Temp\vm-download-installer-1.1.37.ps1 > "%OUT%\download-run.out" 2> "%OUT%\download-run.err"
echo download_exit %ERRORLEVEL% > "%OUT%\download-exit.txt"
