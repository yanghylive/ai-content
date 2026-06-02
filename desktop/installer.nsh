; NSIS 自定义安装/卸载脚本
; 用于 Windows 安装器的额外清理逻辑

!macro customUnInstall
  ; 询问用户是否删除用户数据
  MessageBox MB_YESNO "是否同时删除用户数据（账号信息、配置文件）？$\n$\n选「是」会删除所有本地数据。$\n选「否」会保留数据，重新安装后可恢复。" IDYES deleteUserData IDNO keepUserData

  deleteUserData:
    ; 删除应用数据目录
    RMDir /r "$APPDATA\${PRODUCT_NAME}"
    RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}"
    
    ; 删除 Python 虚拟环境（如果在用户目录）
    RMDir /r "$APPDATA\ai-content\auto-upload\.venv"
    
    ; 删除浏览器 profile 数据
    RMDir /r "$APPDATA\ai-content\auto-upload\browser-profiles"
    
    ; 删除日志
    RMDir /r "$APPDATA\ai-content\.local-logs"
    
    ; 删除数据库
    Delete "$APPDATA\ai-content\auto-upload\db\database.db"
    
    Goto done

  keepUserData:
    ; 只删除缓存和临时文件
    RMDir /r "$APPDATA\${PRODUCT_NAME}\Cache"
    RMDir /r "$APPDATA\${PRODUCT_NAME}\Code Cache"
    RMDir /r "$APPDATA\${PRODUCT_NAME}\GPUCache"
    RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}\Cache"

  done:
    ; 清理注册表
    DeleteRegKey HKCU "Software\${PRODUCT_NAME}"
    
    ; 删除桌面快捷方式
    Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
    
    ; 删除开始菜单快捷方式
    RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
!macroend

!macro customInstall
  ; 安装完成后创建数据目录
  CreateDirectory "$APPDATA\ai-content\auto-upload\db"
  CreateDirectory "$APPDATA\ai-content\auto-upload\browser-profiles"
  CreateDirectory "$APPDATA\ai-content\auto-upload\logs"
  CreateDirectory "$APPDATA\ai-content\.local-logs"
  
  ; 设置 Python 虚拟环境（如果 Python 可用）
  nsExec::ExecToLog 'python --version'
  Pop $0
  ${If} $0 == 0
    nsExec::ExecToLog 'python -m venv "$APPDATA\ai-content\auto-upload\.venv"'
  ${EndIf}
!macroend
