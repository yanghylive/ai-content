@echo off
mkdir C:\Users\Public\kaypal-install-query-1.1.37 >nul 2>&1
schtasks /end /tn KaypalInstallTest1137 > C:\Users\Public\kaypal-install-query-1.1.37\stop-task.txt 2>&1
schtasks /delete /tn KaypalInstallTest1137 /f >> C:\Users\Public\kaypal-install-query-1.1.37\stop-task.txt 2>&1
