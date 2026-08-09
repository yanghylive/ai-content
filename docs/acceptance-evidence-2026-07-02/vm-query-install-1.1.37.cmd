@echo off
set OUT=C:\Users\Public\kaypal-install-test-1.1.37\install-query.txt
mkdir C:\Users\Public\kaypal-install-test-1.1.37 >nul 2>&1
echo query %DATE% %TIME% > "%OUT%"
schtasks /query /tn KaypalInstallTest1137 /fo LIST /v >> "%OUT%" 2>&1
echo ---processes--- >> "%OUT%"
tasklist /FI "IMAGENAME eq KaypalAI内容创作平台.exe" /FO CSV >> "%OUT%" 2>&1
tasklist /FI "IMAGENAME eq node.exe" /FO CSV >> "%OUT%" 2>&1
tasklist /FI "IMAGENAME eq powershell.exe" /FO CSV >> "%OUT%" 2>&1
echo ---outdir--- >> "%OUT%"
dir C:\Users\Public\kaypal-install-test-1.1.37 >> "%OUT%" 2>&1
echo ---appdir--- >> "%OUT%"
dir C:\Users\signer\AppData\Local\Programs\ai-content-desktop >> "%OUT%" 2>&1
