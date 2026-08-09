@echo off
mkdir C:\Users\Public\kaypal-wechat-account-query-1.1.37 >nul 2>&1
set OUT=C:\Users\Public\kaypal-wechat-account-query-1.1.37\account-query.txt
echo query %DATE% %TIME% > "%OUT%"
echo ---whoami--- >> "%OUT%"
whoami >> "%OUT%" 2>&1
echo ---xwechat-files--- >> "%OUT%"
dir C:\Users\signer\Documents\xwechat_files >> "%OUT%" 2>&1
echo ---account-db-dir--- >> "%OUT%"
dir C:\Users\signer\Documents\xwechat_files\wxid_ehw8ebtx2bf622_ae57 >> "%OUT%" 2>&1
echo ---weixin-process--- >> "%OUT%"
tasklist /FI "IMAGENAME eq Weixin.exe" /FO CSV >> "%OUT%" 2>&1
