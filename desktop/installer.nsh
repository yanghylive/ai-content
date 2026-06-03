; NSIS 自定义安装/卸载脚本
; 安装流程: 拷文件 → 调 PowerShell 引导(装 deps + 自启 + 快捷方式)
; 卸载流程: 调 PowerShell 反向清理

!macro customInstall
  ; 确保有 PowerShell（Win7+ 内置）
  ; 调引导脚本（同步等待，UI 全在 PS 那边的 WPF）
  ; $INSTDIR = 选定的安装目录（默认 C:\Program Files\KaypalAI）
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\installer\bootstrap-installer.ps1" -InstallDir "$INSTDIR" -AppSourceDir "$INSTDIR" -ManifestPath "$INSTDIR\installer\deps-manifest.json"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "依赖安装未完全成功,但主程序已装好。$\n$\n你可以稍后从开始菜单重新运行「AI 内容创作平台」里的修复安装。" IDOK
  ${EndIf}
!macroend

!macro customUnInstall
  ; 调 PowerShell 反向清理
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\installer\uninstall.ps1" -InstallDir "$INSTDIR"'
  Pop $0
!macroend
