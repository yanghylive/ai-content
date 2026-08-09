@echo off
"C:\Program Files\nodejs\node.exe" "C:\Users\Public\KaypalAI-1.1.40-vmtest\resources\wechat-db-helper\wechat-db-helper.js" contacts --contract kaypal-wechat-db-helper/v1 --mode all < "C:\Windows\Temp\kaypal-helper-input-1140.json" > "C:\Windows\Temp\kaypal-helper-output-1140.json" 2> "C:\Windows\Temp\kaypal-helper-output-1140.err"
echo exit=%ERRORLEVEL%> "C:\Windows\Temp\kaypal-helper-output-1140.exit"
