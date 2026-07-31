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

test("keeps the distribution login stream open in the web-login state", () => {
  const pageSource = readFileSync(
    new URL("../src/app/(dashboard)/distribution/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /data\.startsWith\("LOGIN_URL:"\)/);
  assert.match(pageSource, /parseTrustedWechatChannelLoginUrl\(/);
  assert.match(pageSource, /setLoginStatus\("manual"\)/);
  assert.match(pageSource, /等待登录完成/);
  assert.doesNotMatch(pageSource, /loginExternalUrl/);
});
