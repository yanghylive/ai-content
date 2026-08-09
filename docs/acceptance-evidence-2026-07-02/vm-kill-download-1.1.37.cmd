@echo off
set OUT=C:\Users\Public\kaypal-install-test-1.1.37
mkdir "%OUT%" >nul 2>&1
taskkill /F /IM powershell.exe > "%OUT%\kill-download.txt" 2>&1
