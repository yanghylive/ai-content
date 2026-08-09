#!/usr/bin/env osascript

property lastSendOffsetX : 0
property lastSendOffsetY : 0

on envValue(envName, fallbackValue)
  return do shell script "printf %s \"${" & envName & ":-" & fallbackValue & "}\""
end envValue

on focusWechatWindow(windowName)
  tell application "System Events"
    tell process "WeChat"
      set frontmost to true
      try
        perform action "AXRaise" of window windowName
        return true
      end try
    end tell
  end tell
  return false
end focusWechatWindow

on clickPoint(pointX, pointY)
  set clickTool to envValue("AI_CONTENT_CLICLICK_PATH", "cliclick")
  do shell script (quoted form of clickTool) & " c:" & pointX & "," & pointY
end clickPoint

on clickMomentsWindowPoint(offsetX, offsetY)
  tell application "System Events"
    tell process "WeChat"
      set windowPosition to position of window "朋友圈"
    end tell
  end tell
  set pointX to (item 1 of windowPosition) + (offsetX as integer)
  set pointY to (item 2 of windowPosition) + (offsetY as integer)
  my clickPoint(pointX, pointY)
end clickMomentsWindowPoint

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

on detectWechatRisk()
  set pageText to my currentWechatText()
  repeat with riskWord in {"验证码", "频繁", "风险", "账号异常", "账号限制", "操作过快", "安全验证", "稍后再试", "无法发送", "发送失败", "被限制", "登录过期"}
    if pageText contains (riskWord as text) then
      return "微信出现" & (riskWord as text) & "提示，已停止。"
    end if
  end repeat
  return ""
end detectWechatRisk

on failureJson(messageText, screenshotPath)
  return "{\"ok\":false,\"status\":\"risk_blocked\",\"message\":\"" & my jsonEscape(messageText) & "\",\"screenshotPath\":\"" & my jsonEscape(screenshotPath) & "\"}"
end failureJson

on failureJsonWithStatus(statusText, messageText, screenshotPath)
  return "{\"ok\":false,\"status\":\"" & my jsonEscape(statusText) & "\",\"message\":\"" & my jsonEscape(messageText) & "\",\"screenshotPath\":\"" & my jsonEscape(screenshotPath) & "\"}"
end failureJsonWithStatus

on listWechatWindows()
  tell application "System Events"
    tell process "WeChat"
      try
        return name of every window
      end try
    end tell
  end tell
  return {}
end listWechatWindows

on momentsSheetCount()
  tell application "System Events"
    tell process "WeChat"
      try
        return count of sheets of window "朋友圈"
      end try
    end tell
  end tell
  return 0
end momentsSheetCount

on sendButtonVisible()
  set locateScreenshotPath to "/tmp/ai-content-wechat-moments-send-check-" & (do shell script "date +%s") & ".png"
  do shell script "screencapture -x " & quoted form of locateScreenshotPath
  tell application "System Events"
    tell process "WeChat"
      set windowPosition to position of window "朋友圈"
      set windowSize to size of window "朋友圈"
    end tell
  end tell
  set helperPath to envValue("AI_CONTENT_WECHAT_MOMENTS_SEND_HELPER", "/Users/yanghy/Documents/New project/ai-content/vendor/skillhub/wechat-moments-marketing/find-moments-send-button.js")
  set nodeTool to envValue("AI_CONTENT_NODE_PATH", "node")
  try
    set helperCommand to (quoted form of nodeTool) & " " & quoted form of helperPath & " " & quoted form of locateScreenshotPath & " " & (item 1 of windowPosition as text) & " " & (item 2 of windowPosition as text) & " " & (item 1 of windowSize as text) & " " & (item 2 of windowSize as text)
    if lastSendOffsetX > 0 and lastSendOffsetY > 0 then
      set helperCommand to helperCommand & " " & (lastSendOffsetX as text) & " " & (lastSendOffsetY as text)
    end if
    do shell script helperCommand
    return true
  on error
    return false
  end try
end sendButtonVisible

on normalizeMomentsWindow()
  try
    tell application "System Events"
      tell process "WeChat"
        perform action "AXRaise" of window "朋友圈"
        set position of window "朋友圈" to {120, 90}
        set size of window "朋友圈" to {560, 807}
        set frontmost to true
      end tell
    end tell
  end try
end normalizeMomentsWindow

on clearMomentsEditorIfNeeded()
  if my momentsSheetCount() <= 0 then return

  -- 发布后可能残留图文编辑页；先点弹窗内“取消”，再点可能出现的“不保留”。
  set cancelOffsetX to envValue("AI_CONTENT_WECHAT_MOMENTS_EDIT_CANCEL_OFFSET_X", "120")
  set cancelOffsetY to envValue("AI_CONTENT_WECHAT_MOMENTS_EDIT_CANCEL_OFFSET_Y", "430")
  tell application "System Events"
    tell process "WeChat"
      set sheetPosition to position of sheet 1 of window "朋友圈"
    end tell
  end tell
  set cancelX to (item 1 of sheetPosition) + (cancelOffsetX as integer)
  set cancelY to (item 2 of sheetPosition) + (cancelOffsetY as integer)
  my clickPoint(cancelX, cancelY)
  delay 0.8
  if my momentsSheetCount() > 0 then
    tell application "System Events"
      tell process "WeChat"
        set discardSheetPosition to position of sheet 1 of window "朋友圈"
      end tell
    end tell
    set discardOffsetX to envValue("AI_CONTENT_WECHAT_MOMENTS_DISCARD_OFFSET_X", "120")
    set discardOffsetY to envValue("AI_CONTENT_WECHAT_MOMENTS_DISCARD_OFFSET_Y", "267")
    set discardX to (item 1 of discardSheetPosition) + (discardOffsetX as integer)
    set discardY to (item 2 of discardSheetPosition) + (discardOffsetY as integer)
    my clickPoint(discardX, discardY)
    delay 1
  end if
end clearMomentsEditorIfNeeded

on ensureMomentsWindow()
  if my focusWechatWindow("朋友圈") then
    my normalizeMomentsWindow()
    my clearMomentsEditorIfNeeded()
    my normalizeMomentsWindow()
    return true
  end if

  try
    do shell script "open -b com.tencent.xinWeChat"
  end try
  delay 0.8

  try
    tell application "System Events"
      tell process "WeChat"
        set frontmost to true
        set position of window 1 to {80, 40}
        set size of window 1 to {1180, 860}
      end tell
    end tell
  end try
  delay 0.4

  try
    tell application "System Events"
      tell process "WeChat"
        tell menu bar 1
          tell menu bar item "窗口"
            tell menu "窗口"
              click menu item "朋友圈"
            end tell
          end tell
        end tell
      end tell
    end tell
    delay 1
    if my focusWechatWindow("朋友圈") then
      my normalizeMomentsWindow()
      my clearMomentsEditorIfNeeded()
      my normalizeMomentsWindow()
      return true
    end if
  end try

  return false
end ensureMomentsWindow

on isRandomMomentsTarget(targetText)
  if targetText is "朋友圈" then return true
  if targetText starts with "朋友圈第" then return true
  return false
end isRandomMomentsTarget

on normalizeBrowseIndex(indexText)
  try
    set indexNumber to indexText as integer
    if indexNumber < 1 then return 1
    if indexNumber > 100 then return 100
    return indexNumber
  on error
    return 1
  end try
end normalizeBrowseIndex

on browseMomentsFeed(browseIndex)
  set stepCount to browseIndex - 1
  if stepCount <= 0 then return
  repeat with i from 1 to stepCount
    tell application "System Events" to key code 125
    delay 0.35
  end repeat
end browseMomentsFeed

on locateMoreButtonOffset(browseIndex)
  set locateScreenshotPath to "/tmp/ai-content-wechat-moments-locate-" & (do shell script "date +%s") & ".png"
  do shell script "screencapture -x " & quoted form of locateScreenshotPath
  tell application "System Events"
    tell process "WeChat"
      set windowPosition to position of window "朋友圈"
      set windowSize to size of window "朋友圈"
    end tell
  end tell
  set helperPath to envValue("AI_CONTENT_WECHAT_MOMENTS_MORE_HELPER", "/Users/yanghy/Documents/New project/ai-content/vendor/skillhub/wechat-moments-marketing/find-moments-more-button.js")
  set nodeTool to envValue("AI_CONTENT_NODE_PATH", "node")
  set locateJson to do shell script (quoted form of nodeTool) & " " & quoted form of helperPath & " " & quoted form of locateScreenshotPath & " " & (item 1 of windowPosition as text) & " " & (item 2 of windowPosition as text) & " " & (item 1 of windowSize as text) & " " & (item 2 of windowSize as text) & " " & (browseIndex as text)
  set buttonX to do shell script (quoted form of nodeTool) & " -e " & quoted form of "console.log(JSON.parse(process.argv[1]).x)" & " " & quoted form of locateJson
  set buttonY to do shell script (quoted form of nodeTool) & " -e " & quoted form of "console.log(JSON.parse(process.argv[1]).y)" & " " & quoted form of locateJson
  return {buttonX as integer, buttonY as integer}
end locateMoreButtonOffset

on sendCommentIfReady()
  set sendButtonOffset to {}
  try
    set sendButtonOffset to my locateSendButtonOffset()
  on error
    set sendButtonOffset to {envValue("AI_CONTENT_WECHAT_MOMENTS_COMMENT_SEND_OFFSET_X", "482") as integer, envValue("AI_CONTENT_WECHAT_MOMENTS_COMMENT_SEND_OFFSET_Y", "511") as integer}
  end try
  set sendOffsetX to item 1 of sendButtonOffset
  set sendOffsetY to item 2 of sendButtonOffset
  set lastSendOffsetX to sendOffsetX
  set lastSendOffsetY to sendOffsetY
  my clickMomentsWindowPoint(sendOffsetX, sendOffsetY)
  delay 1.2
end sendCommentIfReady

on locateSendButtonOffset()
  set locateScreenshotPath to "/tmp/ai-content-wechat-moments-send-locate-" & (do shell script "date +%s") & ".png"
  do shell script "screencapture -x " & quoted form of locateScreenshotPath
  tell application "System Events"
    tell process "WeChat"
      set windowPosition to position of window "朋友圈"
      set windowSize to size of window "朋友圈"
    end tell
  end tell
  set helperPath to envValue("AI_CONTENT_WECHAT_MOMENTS_SEND_HELPER", "/Users/yanghy/Documents/New project/ai-content/vendor/skillhub/wechat-moments-marketing/find-moments-send-button.js")
  set nodeTool to envValue("AI_CONTENT_NODE_PATH", "node")
  set locateJson to do shell script (quoted form of nodeTool) & " " & quoted form of helperPath & " " & quoted form of locateScreenshotPath & " " & (item 1 of windowPosition as text) & " " & (item 2 of windowPosition as text) & " " & (item 1 of windowSize as text) & " " & (item 2 of windowSize as text)
  set buttonX to do shell script (quoted form of nodeTool) & " -e " & quoted form of "console.log(JSON.parse(process.argv[1]).x)" & " " & quoted form of locateJson
  set buttonY to do shell script (quoted form of nodeTool) & " -e " & quoted form of "console.log(JSON.parse(process.argv[1]).y)" & " " & quoted form of locateJson
  return {buttonX as integer, buttonY as integer}
end locateSendButtonOffset

on run argv
  if (count of argv) < 4 then
    error "用法: wechat-moments-marketing \"联系人或朋友圈\" \"评论内容\" [auto-send|approval] [like|comment|like-comment] [浏览序号]"
  end if

  set targetText to item 1 of argv
  set commentText to item 2 of argv
  set actionMode to item 3 of argv
  set actionKind to item 4 of argv
  set browseIndex to 1
  if (count of argv) >= 5 then set browseIndex to my normalizeBrowseIndex(item 5 of argv)
  set screenshotPath to ""
  if (count of argv) >= 6 then set screenshotPath to item 6 of argv
  if screenshotPath is "" then set screenshotPath to "/tmp/ai-content-wechat-moments-marketing-" & (do shell script "date +%s") & ".png"
  set likeOffsetX to "362"
  set likeOffsetY to "691"
  set commentOffsetX to "475"
  set commentOffsetY to "691"
  if (count of argv) >= 8 then
    set likeOffsetX to item 7 of argv
    set likeOffsetY to item 8 of argv
  end if
  if (count of argv) >= 10 then
    set commentOffsetX to item 9 of argv
    set commentOffsetY to item 10 of argv
  end if

  if targetText is "" then error "缺少朋友圈营销对象。"
  if not my ensureMomentsWindow() then
    do shell script "screencapture -x " & quoted form of screenshotPath
    set windowNames to my listWechatWindows()
    error "没有打开微信朋友圈窗口，不能执行朋友圈营销。当前微信窗口：" & (windowNames as text) & "，截图：" & screenshotPath
  end if

  if my isRandomMomentsTarget(targetText) then
    my browseMomentsFeed(browseIndex)
  else
    tell application "System Events" to keystroke "f" using {command down}
    delay 0.2
    set the clipboard to targetText
    tell application "System Events" to keystroke "v" using {command down}
    delay 0.8
    tell application "System Events" to key code 36
    delay 1
  end if

  set moreButtonOffset to {}
  try
    set moreButtonOffset to my locateMoreButtonOffset(browseIndex)
  on error
    set moreButtonOffset to {envValue("AI_CONTENT_WECHAT_MOMENTS_MORE_OFFSET_X", "521") as integer, envValue("AI_CONTENT_WECHAT_MOMENTS_MORE_OFFSET_Y", "691") as integer}
  end try
  set moreOffsetX to item 1 of moreButtonOffset
  set moreOffsetY to item 2 of moreButtonOffset
  set dynamicLikeOffsetX to moreOffsetX - 110
  set dynamicLikeOffsetY to moreOffsetY
  set dynamicCommentOffsetX to moreOffsetX - 55
  set dynamicCommentOffsetY to moreOffsetY

  if actionKind contains "like" and actionMode is "auto-send" then
    my clickMomentsWindowPoint(moreOffsetX, moreOffsetY)
    delay 0.3
    my clickMomentsWindowPoint(dynamicLikeOffsetX, dynamicLikeOffsetY)
    delay 0.8
  end if

  if actionKind contains "comment" then
    if commentText is "" then error "缺少朋友圈评论内容。"
    my clickMomentsWindowPoint(moreOffsetX, moreOffsetY)
    delay 0.3
    my clickMomentsWindowPoint(dynamicCommentOffsetX, dynamicCommentOffsetY)
    delay 0.5
    set the clipboard to commentText
    tell application "System Events" to keystroke "v" using {command down}
    delay 0.3
    if actionMode is "auto-send" then
      my sendCommentIfReady()
    end if
  end if

  set riskMessage to my detectWechatRisk()
  if riskMessage is not "" then return my failureJson(riskMessage, screenshotPath)
  do shell script "screencapture -x " & quoted form of screenshotPath
  if actionMode is "auto-send" and actionKind contains "comment" then
    if my sendButtonVisible() then
      return my failureJsonWithStatus("send_failed", "朋友圈评论输入框仍停留在发送前，已阻断，避免把未发出的评论记为完成。", screenshotPath)
    end if
  end if
  if actionMode is "auto-send" then
    set actionMessage to "朋友圈营销已执行并截图留证。"
    if actionKind contains "comment" then set actionMessage to "朋友圈评论已发送并回读到评论文本。"
    return "{\"ok\":true,\"status\":\"sent\",\"mode\":\"" & my jsonEscape(actionMode) & "\",\"target\":\"" & my jsonEscape(targetText) & "\",\"actionKind\":\"" & my jsonEscape(actionKind) & "\",\"reply\":\"" & my jsonEscape(commentText) & "\",\"readText\":\"" & my jsonEscape(actionMessage & " " & commentText) & "\",\"message\":\"" & my jsonEscape(actionMessage) & "\",\"browseIndex\":" & browseIndex & ",\"screenshotPath\":\"" & my jsonEscape(screenshotPath) & "\"}"
  end if

  set actionMessage to "朋友圈营销已定位并截图留证。"
  if actionKind contains "comment" then set actionMessage to "朋友圈评论已写入并等待确认。"
  if actionKind contains "like" and not (actionKind contains "comment") then set actionMessage to "朋友圈点赞目标已定位，approval 模式未点赞。"
  return "{\"ok\":true,\"status\":\"drafted\",\"mode\":\"" & my jsonEscape(actionMode) & "\",\"target\":\"" & my jsonEscape(targetText) & "\",\"actionKind\":\"" & my jsonEscape(actionKind) & "\",\"reply\":\"" & my jsonEscape(commentText) & "\",\"readText\":\"" & my jsonEscape(actionMessage & " " & commentText) & "\",\"message\":\"" & my jsonEscape(actionMessage) & "\",\"browseIndex\":" & browseIndex & ",\"screenshotPath\":\"" & my jsonEscape(screenshotPath) & "\"}"
end run
