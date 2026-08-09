@echo off
mkdir C:\Users\Public\kaypal-install-query-1.1.37 >nul 2>&1
set OUT=C:\Users\Public\kaypal-install-query-1.1.37\install-query.txt
echo query %DATE% %TIME% > "%OUT%"
schtasks /query /tn KaypalInstallTest1137 /fo LIST /v >> "%OUT%" 2>&1
echo ---node--- >> "%OUT%"
tasklist /FI "IMAGENAME eq node.exe" /FO CSV >> "%OUT%" 2>&1
echo ---powershell--- >> "%OUT%"
tasklist /FI "IMAGENAME eq powershell.exe" /FO CSV >> "%OUT%" 2>&1
echo ---outdir--- >> "%OUT%"
dir C:\Users\Public\kaypal-install-test-1.1.37 >> "%OUT%" 2>&1
echo ---programs--- >> "%OUT%"
dir C:\Users\signer\AppData\Local\Programs >> "%OUT%" 2>&1
