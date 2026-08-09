@echo off
set OUT=C:\Users\Public\kaypal-install-test-1.1.37\download-query.txt
echo query %DATE% %TIME% > "%OUT%"
tasklist /FI "IMAGENAME eq powershell.exe" /FO CSV >> "%OUT%" 2>&1
echo ---target--- >> "%OUT%"
dir C:\Users\Public\KaypalAI-Setup-1.1.37-oss.exe >> "%OUT%" 2>&1
echo ---logs--- >> "%OUT%"
dir C:\Users\Public\kaypal-install-test-1.1.37 >> "%OUT%" 2>&1
