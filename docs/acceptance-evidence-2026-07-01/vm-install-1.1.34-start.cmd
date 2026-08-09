@echo off
set TASK=KaypalInstall1134
schtasks /delete /tn %TASK% /f >nul 2>&1
schtasks /create /tn %TASK% /tr C:\Windows\Temp\kaypal-install-1.1.34-run.cmd /sc once /st 23:59 /f /it /ru WIN-LF040VM3F47\signer
schtasks /run /tn %TASK%
schtasks /query /tn %TASK% /fo LIST /v
