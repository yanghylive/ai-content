; NSIS 自定义安装/卸载脚本
; 安装流程: 拷主程序文件 → 安装后初始化和自检
; 卸载流程: 调 PowerShell 反向清理

; 整个装器要 admin (5 个 dep 都要写 C:\Program Files / 注册服务)
RequestExecutionLevel admin

!macro customInstall
  ; 外层 KaypalAI 安装助手负责依赖检测/安装；这里仅做主程序安装后的初始化和自检。
  ; $INSTDIR = 选定的安装目录（默认 C:\Program Files\KaypalAI）
  DetailPrint "正在初始化 KaypalAI 主程序..."
  ExecWait '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\bootstrap-installer.ps1" -Mode PostInstall -InstallDir "$INSTDIR" -AppSourceDir "$INSTDIR" -ManifestPath "$INSTDIR\resources\installer\deps-manifest.json"' $0
  ${If} $0 != 0
    DetailPrint "安装后初始化有警告，主程序文件已安装。请查看 C:\ProgramData\KaypalAI\logs\install-bootstrap.log"
  ${EndIf}
!macroend

!macro customUnInstall
  ; 调 PowerShell 反向清理
  ExecWait '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\uninstall.ps1" -InstallDir "$INSTDIR"' $0
!macroend
