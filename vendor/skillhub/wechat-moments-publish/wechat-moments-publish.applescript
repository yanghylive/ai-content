#!/usr/bin/env osascript

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

on clickPoint(envX, fallbackX, envY, fallbackY)
  set pointX to envValue(envX, fallbackX)
  set pointY to envValue(envY, fallbackY)
  do shell script "cliclick c:" & pointX & "," & pointY
end clickPoint

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

on ensureMomentsWindow()
  if focusWechatWindow("朋友圈") then
    return true
  end if

  tell application id "com.tencent.xinWeChat" to activate
  delay 0.8

  tell application "System Events"
    tell process "WeChat"
      set frontmost to true
      try
        set position of window 1 to {80, 40}
        set size of window 1 to {1180, 860}
      end try
    end tell
  end tell
  delay 0.4

  try
    tell application "System Events" to keystroke "3" using {command down}
    delay 0.8
    if focusWechatWindow("朋友圈") then return true
  end try

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
    if focusWechatWindow("朋友圈") then return true
  end try

  my clickPoint("AI_CONTENT_WECHAT_MOMENTS_X", "105", "AI_CONTENT_WECHAT_MOMENTS_Y", "308")
  delay 1
  if focusWechatWindow("朋友圈") then return true

  my clickPoint("AI_CONTENT_WECHAT_MOMENTS_ALT_X", "129", "AI_CONTENT_WECHAT_MOMENTS_ALT_Y", "373")
  delay 1
  if focusWechatWindow("朋友圈") then return true

  return focusWechatWindow("朋友圈")
end ensureMomentsWindow

on run argv
  if (count of argv) < 3 then
    error "用法: wechat-moments-publish \"朋友圈文案\" [auto-send|approval] /absolute/image-path"
  end if

  set momentsContent to item 1 of argv
  set publishMode to item 2 of argv
  set assetPath to item 3 of argv

  if momentsContent is "" then
    error "缺少朋友圈文案，不能发布。"
  end if
  if assetPath is "" then
    error "Mac 微信朋友圈当前走图文发表入口，缺少真实素材路径，不能发布。"
  end if
  if (do shell script "test -f " & quoted form of assetPath & " && echo yes || echo no") is not "yes" then
    error "朋友圈素材不存在: " & assetPath
  end if

  if not ensureMomentsWindow() then
    set failPath to "/tmp/ai-content-wechat-moments-open-failed-" & (do shell script "date +%s") & ".png"
    do shell script "screencapture -x " & quoted form of failPath
    set windowNames to listWechatWindows()
    error "没有打开微信朋友圈窗口，不能发布。当前微信窗口：" & (windowNames as text) & "，截图：" & failPath
  end if

  tell application "System Events"
    tell process "WeChat"
      try
        perform action "AXRaise" of window "朋友圈"
        set position of window "朋友圈" to {120, 90}
        set size of window "朋友圈" to {560, 807}
      end try
      set frontmost to true
    end tell
  end tell
  delay 0.4

  set composeX to envValue("AI_CONTENT_WECHAT_MOMENTS_COMPOSE_X", "649")
  set composeY to envValue("AI_CONTENT_WECHAT_MOMENTS_COMPOSE_Y", "113")
  do shell script "cliclick c:" & composeX & "," & composeY
  delay 0.8

  set the clipboard to assetPath
  tell application "System Events"
    keystroke "g" using {command down, shift down}
    delay 0.3
    keystroke "v" using {command down}
    delay 0.2
    key code 36
    delay 0.8
    key code 36
  end tell
  delay 1.2

  set inputX to envValue("AI_CONTENT_WECHAT_MOMENTS_INPUT_X", "180")
  set inputY to envValue("AI_CONTENT_WECHAT_MOMENTS_INPUT_Y", "240")
  do shell script "cliclick c:" & inputX & "," & inputY
  delay 0.2
  set the clipboard to momentsContent
  tell application "System Events" to keystroke "v" using {command down}
  delay 0.4

  set screenshotPath to "/tmp/ai-content-wechat-moments-" & (do shell script "date +%s") & ".png"

  if publishMode is not "auto-send" then
    do shell script "screencapture -x " & quoted form of screenshotPath
    return "{\"ok\":true,\"mode\":\"approval\",\"assetPath\":\"" & assetPath & "\",\"screenshotPath\":\"" & screenshotPath & "\"}"
  end if

  set publishX to envValue("AI_CONTENT_WECHAT_MOMENTS_PUBLISH_X", "333")
  set publishY to envValue("AI_CONTENT_WECHAT_MOMENTS_PUBLISH_Y", "686")
  do shell script "cliclick c:" & publishX & "," & publishY
  delay 3

  do shell script "screencapture -x " & quoted form of screenshotPath
  return "{\"ok\":true,\"mode\":\"auto-send\",\"assetPath\":\"" & assetPath & "\",\"screenshotPath\":\"" & screenshotPath & "\"}"
end run
