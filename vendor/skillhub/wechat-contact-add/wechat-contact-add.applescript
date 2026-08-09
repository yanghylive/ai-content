#!/usr/bin/env osascript

on envValue(envName, fallbackValue)
  return do shell script "printf %s \"${" & envName & ":-" & fallbackValue & "}\""
end envValue

on clickPoint(envX, fallbackX, envY, fallbackY)
  set pointX to envValue(envX, fallbackX)
  set pointY to envValue(envY, fallbackY)
  set clickTool to envValue("AI_CONTENT_CLICLICK_PATH", "cliclick")
  do shell script (quoted form of clickTool) & " c:" & pointX & "," & pointY
end clickPoint

on focusWechatMainWindow()
  tell application "System Events"
    tell process "WeChat"
      set frontmost to true
      try
        perform action "AXRaise" of window "微信"
        set position of window "微信" to {90, 45}
        set size of window "微信" to {1180, 860}
        return true
      end try
      try
        perform action "AXRaise" of window "微信 (窗口)"
        set position of window "微信 (窗口)" to {90, 45}
        set size of window "微信 (窗口)" to {1180, 860}
        return true
      end try
    end tell
  end tell
  return false
end focusWechatMainWindow

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

on currentWechatText()
  set collectedText to ""
  tell application "System Events"
    tell process "WeChat"
      try
        set uiElements to entire contents of window 1
        repeat with uiElement in uiElements
          try
            set itemName to name of uiElement
            if itemName is not missing value then set collectedText to collectedText & " " & (itemName as text)
          end try
          try
            set itemValue to value of uiElement
            if itemValue is not missing value then set collectedText to collectedText & " " & (itemValue as text)
          end try
          try
            set itemDescription to description of uiElement
            if itemDescription is not missing value then set collectedText to collectedText & " " & (itemDescription as text)
          end try
        end repeat
      end try
    end tell
  end tell
  return collectedText
end currentWechatText

on hasAddFriendUi(pageText)
  repeat with addWord in {"添加到通讯录", "发送好友申请", "验证申请", "申请添加朋友", "备注名", "朋友权限"}
    if pageText contains (addWord as text) then return true
  end repeat
  return false
end hasAddFriendUi

on failureJson(messageText, screenshotPath)
  return "{\"ok\":false,\"status\":\"failed\",\"message\":\"" & my jsonEscape(messageText) & "\",\"screenshotPath\":\"" & my jsonEscape(screenshotPath) & "\"}"
end failureJson

on detectWechatRisk()
  set pageText to my currentWechatText()
  repeat with riskWord in {"验证码", "频繁", "风险", "账号异常", "账号限制", "操作过快", "安全验证", "稍后再试", "无法发送", "发送失败", "被限制", "登录过期"}
    if pageText contains (riskWord as text) then
      return "微信出现" & (riskWord as text) & "提示，已停止。"
    end if
  end repeat
  return ""
end detectWechatRisk

on riskJson(messageText, screenshotPath)
  return "{\"ok\":false,\"status\":\"risk_blocked\",\"message\":\"" & my jsonEscape(messageText) & "\",\"screenshotPath\":\"" & my jsonEscape(screenshotPath) & "\"}"
end riskJson

on run argv
  if (count of argv) < 3 then
    error "用法: wechat-contact-add \"微信号或手机号\" \"验证消息\" [auto-send|approval] [remark-strategy] [remark-content]"
  end if

  set targetText to item 1 of argv
  set verifyMessage to item 2 of argv
  set actionMode to item 3 of argv
  set remarkStrategy to "none"
  set remarkContent to ""
  if (count of argv) >= 4 then set remarkStrategy to item 4 of argv
  if (count of argv) >= 5 then set remarkContent to item 5 of argv

  if targetText is "" then error "缺少加好友目标。"
  if verifyMessage is "" then error "缺少好友验证消息。"

  do shell script "open -b com.tencent.xinWeChat"
  delay 1

  if not my focusWechatMainWindow() then error "没有找到微信主窗口，不能加好友。"
  delay 0.4

  tell application "System Events" to keystroke "f" using {command down}
  delay 0.2
  set the clipboard to targetText
  tell application "System Events" to keystroke "v" using {command down}
  delay 0.8

  set searchResultX to envValue("AI_CONTENT_WECHAT_CONTACT_RESULT_X", "280")
  set searchResultY to envValue("AI_CONTENT_WECHAT_CONTACT_RESULT_Y", "166")
  set clickTool to envValue("AI_CONTENT_CLICLICK_PATH", "cliclick")
  do shell script (quoted form of clickTool) & " c:" & searchResultX & "," & searchResultY
  delay 0.8

  my clickPoint("AI_CONTENT_WECHAT_CONTACT_ADD_X", "520", "AI_CONTENT_WECHAT_CONTACT_ADD_Y", "414")
  delay 0.8

  set screenshotPath to "/tmp/ai-content-wechat-contact-add-" & (do shell script "date +%s") & ".png"
  set pageTextBeforeVerify to my currentWechatText()
  if not my hasAddFriendUi(pageTextBeforeVerify) then
    do shell script "screencapture -x " & quoted form of screenshotPath
    return my failureJson("未进入好友申请页面，可能没有找到可添加对象或目标已是联系人。", screenshotPath)
  end if

  set the clipboard to verifyMessage
  my clickPoint("AI_CONTENT_WECHAT_CONTACT_VERIFY_X", "471", "AI_CONTENT_WECHAT_CONTACT_VERIFY_Y", "362")
  delay 0.2
  tell application "System Events" to keystroke "a" using {command down}
  tell application "System Events" to keystroke "v" using {command down}
  delay 0.4

  if remarkStrategy is not "none" and remarkContent is not "" then
    set the clipboard to remarkContent
    my clickPoint("AI_CONTENT_WECHAT_CONTACT_REMARK_X", "471", "AI_CONTENT_WECHAT_CONTACT_REMARK_Y", "414")
    delay 0.2
    tell application "System Events" to keystroke "a" using {command down}
    tell application "System Events" to keystroke "v" using {command down}
    delay 0.3
  end if

  if actionMode is "auto-send" then
    my clickPoint("AI_CONTENT_WECHAT_CONTACT_SEND_X", "703", "AI_CONTENT_WECHAT_CONTACT_SEND_Y", "505")
    delay 1.2
    do shell script "screencapture -x " & quoted form of screenshotPath
    set riskMessage to my detectWechatRisk()
    if riskMessage is not "" then return my riskJson(riskMessage, screenshotPath)
    return "{\"ok\":true,\"status\":\"sent\",\"mode\":\"auto-send\",\"target\":\"" & my jsonEscape(targetText) & "\",\"reply\":\"" & my jsonEscape(verifyMessage) & "\",\"remarkStrategy\":\"" & my jsonEscape(remarkStrategy) & "\",\"remarkContent\":\"" & my jsonEscape(remarkContent) & "\",\"readText\":\"好友申请已发送：" & my jsonEscape(targetText) & "\",\"message\":\"好友申请已发送并截图留证。\",\"screenshotPath\":\"" & my jsonEscape(screenshotPath) & "\"}"
  end if

  do shell script "screencapture -x " & quoted form of screenshotPath
  set riskMessage to my detectWechatRisk()
  if riskMessage is not "" then return my riskJson(riskMessage, screenshotPath)
  return "{\"ok\":true,\"status\":\"drafted\",\"mode\":\"approval\",\"target\":\"" & my jsonEscape(targetText) & "\",\"reply\":\"" & my jsonEscape(verifyMessage) & "\",\"remarkStrategy\":\"" & my jsonEscape(remarkStrategy) & "\",\"remarkContent\":\"" & my jsonEscape(remarkContent) & "\",\"readText\":\"好友申请已写入：" & my jsonEscape(targetText) & "\",\"message\":\"好友申请已写入并等待确认。\",\"screenshotPath\":\"" & my jsonEscape(screenshotPath) & "\"}"
end run
