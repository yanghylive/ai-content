; NSIS 自定义安装/卸载脚本
; 安装流程: 拷主程序文件 → 安装后初始化和自检
; 卸载流程: 调 PowerShell 反向清理

; 整个安装包使用应用内置运行时，不要求用户单独安装 Python/Node/Postgres/Redis/Chrome。
RequestExecutionLevel admin

!macro customInstall
  ; JIUZHANG AI 安装助手只负责启动主安装包；这里仅做主程序安装后的初始化和自检。
  ; $INSTDIR = 选定的安装目录（默认 C:\Program Files\JIUZHANG AI）
  DetailPrint "正在初始化 JIUZHANG AI 主程序..."
  ExecWait '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\bootstrap-installer.ps1" -Mode PostInstall -InstallDir "$INSTDIR" -AppSourceDir "$INSTDIR" -ManifestPath "$INSTDIR\resources\installer\deps-manifest.json"' $0
  ${If} $0 != 0
    DetailPrint "安装后初始化有警告，主程序文件已安装。请查看 C:\ProgramData\JIUZHANG AI\logs\install-bootstrap.log"
  ${EndIf}
!macroend

!macro customUnInstall
  ; 调 PowerShell 反向清理
  ExecWait '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\uninstall.ps1" -InstallDir "$INSTDIR"' $0
!macroend
