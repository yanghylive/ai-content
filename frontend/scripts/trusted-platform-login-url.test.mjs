import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseTrustedWechatChannelLoginUrl,
  WECHAT_CHANNEL_LOGIN_URL,
} from "../src/lib/trusted-platform-login-url.ts";

test("accepts only the fixed WeChat Channel login origin", () => {
  assert.equal(
    parseTrustedWechatChannelLoginUrl("https://channels.weixin.qq.com"),
    WECHAT_CHANNEL_LOGIN_URL,
  );
  assert.equal(
    parseTrustedWechatChannelLoginUrl("https://channels.weixin.qq.com/"),
    WECHAT_CHANNEL_LOGIN_URL,
  );

  for (const value of [
    "http://channels.weixin.qq.com/",
    "https://channels.weixin.qq.com.evil.example/",
    "https://channels.weixin.qq.com@evil.example/",
    "https://channels.weixin.qq.com/login",
    "https://channels.weixin.qq.com/?next=https://evil.example",
    "javascript:alert(1)",
  ]) {
    assert.equal(parseTrustedWechatChannelLoginUrl(value), null, value);
  }
});

// 2026-08-18：移除「distribution 登录流保持打开」断言——原 page-legacy 已删除，
// 登录流重构至 distribution/use-account-operations.ts（仅保留 parseTrustedWechat
// ChannelLoginUrl 调用，其余模式（LOGIN_URL:/等待登录完成/loginExternalUrl）已不存在，
// 原断言语义失效；trusted-platform-login-url 核心解析断言保留在上方测试。
