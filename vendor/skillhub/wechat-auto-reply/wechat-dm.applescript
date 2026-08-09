#!/usr/bin/env osascript

on run argv
  if argv is {} then
    display dialog "请指定联系人名称" buttons {"取消"} default button 1
    return
  end if

  set contactName to item 1 of argv
  set customMessage to ""
  set sendMode to "auto-send"
  set attachmentPaths to ""

  if length of argv > 1 then
    set customMessage to item 2 of argv
  end if

  if length of argv > 2 then
    set sendMode to item 3 of argv
  end if

  if length of argv > 3 then
    set attachmentPaths to item 4 of argv
  end if

  if customMessage is "" and attachmentPaths is "" then
    display dialog "请提供要发送的消息内容或附件" buttons {"取消"} default button 1
    return
  end if

  do shell script "open -b com.tencent.xinWeChat"
  tell application id "com.tencent.xinWeChat" to activate
  delay 1

  tell application "System Events"
    tell process "WeChat"
      set frontmost to true
      try
        set position of window 1 to {90, 45}
        set size of window 1 to {1620, 1165}
      end try
    end tell
  end tell
  delay 0.3

  tell application "System Events" to keystroke "f" using {command down}
  delay 0.3

  set the clipboard to contactName
  tell application "System Events" to keystroke "v" using {command down}
  delay 0.8

  tell application "System Events" to key code 36
  delay 0.8

  if attachmentPaths is not "" then
    my pasteWechatAttachments(attachmentPaths)
  end if

  if customMessage is not "" then
    set the clipboard to customMessage
    set inputX to do shell script "printf %s \"${AI_CONTENT_WECHAT_INPUT_X:-1040}\""
    set inputY to do shell script "printf %s \"${AI_CONTENT_WECHAT_INPUT_Y:-1110}\""
    do shell script "cliclick c:" & inputX & "," & inputY
    delay 0.2

    tell application "System Events" to keystroke "v" using {command down}
    delay 0.2
  end if

  if sendMode is "auto-send" then
    tell application "System Events" to key code 36
    delay 0.8
    set shotPath to do shell script "printf '/tmp/ai-content-wechat-auto-reply-%s.png' \"$(date +%s)\""
    do shell script "screencapture -x " & quoted form of shotPath
    return "{\"ok\":true,\"mode\":\"auto-send\",\"contact\":\"" & my jsonEscape(contactName) & "\",\"screenshotPath\":\"" & my jsonEscape(shotPath) & "\"}"
  else
    set shotPath to do shell script "printf '/tmp/ai-content-wechat-auto-reply-%s.png' \"$(date +%s)\""
    do shell script "screencapture -x " & quoted form of shotPath
    return "{\"ok\":true,\"mode\":\"approval\",\"contact\":\"" & my jsonEscape(contactName) & "\",\"screenshotPath\":\"" & my jsonEscape(shotPath) & "\"}"
  end if
end run

-- 粘贴附件：通过微信输入框"+"菜单逐个选择文件（attachmentPaths 为换行分隔的绝对路径列表）
on pasteWechatAttachments(attachmentPaths)
  set attachX to do shell script "printf %s \"${AI_CONTENT_WECHAT_ATTACH_BTN_X:-955}\""
  set attachY to do shell script "printf %s \"${AI_CONTENT_WECHAT_ATTACH_BTN_Y:-1112}\""
  set fileList to paragraphs of attachmentPaths
  repeat with onePath in fileList
    if onePath is not "" then
      do shell script "cliclick c:" & attachX & "," & attachY
      delay 0.5
      -- 弹出菜单中选择"文件"
      tell application "System Events" to keystroke "f"
      delay 0.4
      -- 文件选择对话框：跳到目录 → 输入文件名 → 打开
      set the clipboard to onePath
      tell application "System Events" to keystroke "g" using {command down, shift down}
      delay 0.4
      set parentDir to do shell script "dirname " & quoted form of onePath
      set the clipboard to parentDir
      tell application "System Events" to keystroke "v" using {command down}
      delay 0.3
      tell application "System Events" to key code 36
      delay 0.6
      set fileName to do shell script "basename " & quoted form of onePath
      set the clipboard to fileName
      tell application "System Events" to keystroke "v" using {command down}
      delay 0.3
      tell application "System Events" to key code 36
      delay 0.8
      -- 回到输入框，等下一个附件或发送
      tell application "System Events" to key code 36
      delay 0.5
    end if
  end repeat
end pasteWechatAttachments

on jsonEscape(valueText)
  set textValue to valueText as text
  set textValue to my replaceText("\\", "\\\\", textValue)
  set textValue to my replaceText("\"", "\\\"", textValue)
  return textValue
end jsonEscape

on replaceText(searchString, replacementString, sourceText)
  set AppleScript's text item delimiters to searchString
  set textItems to text items of sourceText
  set AppleScript's text item delimiters to replacementString
  set replacedText to textItems as text
  set AppleScript's text item delimiters to ""
  return replacedText
end replaceText
