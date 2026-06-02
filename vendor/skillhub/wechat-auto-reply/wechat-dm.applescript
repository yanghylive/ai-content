#!/usr/bin/env osascript

on run argv
  if argv is {} then
    display dialog "请指定联系人名称" buttons {"取消"} default button 1
    return
  end if

  set contactName to item 1 of argv
  set customMessage to ""
  set sendMode to "auto-send"

  if length of argv > 1 then
    set customMessage to item 2 of argv
  end if

  if length of argv > 2 then
    set sendMode to item 3 of argv
  end if

  if customMessage is "" then
    display dialog "请提供要发送的消息内容" buttons {"取消"} default button 1
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

  set the clipboard to customMessage
  set inputX to do shell script "printf %s \"${AI_CONTENT_WECHAT_INPUT_X:-1040}\""
  set inputY to do shell script "printf %s \"${AI_CONTENT_WECHAT_INPUT_Y:-1110}\""
  do shell script "cliclick c:" & inputX & "," & inputY
  delay 0.2

  tell application "System Events" to keystroke "v" using {command down}
  delay 0.2

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
