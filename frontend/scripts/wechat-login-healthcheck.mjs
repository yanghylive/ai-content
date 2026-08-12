#!/usr/bin/env node
/**
 * 微信登录全链路健康检查（2026-08-12 新增，防复发机制 #1）
 *
 * 背景：微信登录反复坏（404 / cookie 域不一致 / kaypal 生产未部署修复），
 * 根因是链路每一跳都"没人验证"。本脚本把整条链路固化成可重复执行的检查，
 * 任何改动后（前端 build / 后端重启 / kaypal 部署）跑一遍即可确认链路健康。
 *
 * 检查项：
 *  A. 本地后端 3011：/api/auth/wechat/start?origin=... 302 到 kaypal
 *  B. 前端产物：login 页微信按钮拼接含 endsWith("/api") 防御 + origin 参数
 *  C. kaypal 生产：/api/auth/wechat/url 接受 127.0.0.1:3010 returnUrl（白名单）
 *  D. kaypal 生产：returnUrl 内存暂存召回（不带 cookie 仅 state，模拟 cookie 丢失）
 *  E. kaypal 生产：恶意 origin 被拒绝回落默认（防注入）
 *
 * 用法：
 *  node scripts/wechat-login-healthcheck.mjs            # 全量（默认）
 *  node scripts/wechat-login-healthcheck.mjs --local    # 仅本地 A/B
 *  node scripts/wechat-login-healthcheck.mjs --prod     # 仅生产 C/D/E
 *  node scripts/wechat-login-healthcheck.mjs --prod-no-http  # 生产但跳过需要发 HTTP 的 C
 *
 * 退出码：0 全绿；1 有失败项（适合接入 CI/guard）。
 */

const LOCAL_BACKEND = "http://127.0.0.1:3011";
const KAYPAL = "https://kaypal.cn";
const LOOPBACK_RETURN = encodeURIComponent(
  "http://127.0.0.1:3010/api/auth/wechat/callback?next=%2Fagent",
);
import { fileURLToPath } from "node:url";
const FRONTEND_OUT = fileURLToPath(new URL("../out", import.meta.url));

const failures = [];
let passCount = 0;

function ok(name, detail = "") {
  passCount++;
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  failures.push(name);
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
}

async function check(cond, name, detail = "") {
  cond ? ok(name, detail) : fail(name, detail);
}

async function main() {
  const args = process.argv.slice(2);
  const doLocal = !args.includes("--prod") && !args.includes("--prod-no-http");
  const doProd = !args.includes("--local");

  console.log("=== 微信登录链路健康检查 ===");
  console.log(`模式: ${doLocal && doProd ? "全量" : doLocal ? "仅本地" : "仅生产"}\n`);

  // ---------- 本地 ----------
  if (doLocal) {
    console.log("【A. 本地后端 3011】");
    try {
      const res = await fetch(
        `${LOCAL_BACKEND}/api/auth/wechat/start?next=%2Fagent&origin=${encodeURIComponent("http://127.0.0.1:3010")}`,
        { redirect: "manual" },
      );
      const loc = res.headers.get("location") || "";
      await check(
        res.status === 302 && loc.startsWith(`${KAYPAL}/api/auth/wechat/url?returnUrl=`),
        "start 302 到 kaypal",
        `${res.status} ${loc.slice(0, 60)}...`,
      );
      await check(
        decodeURIComponent(loc).includes("127.0.0.1:3010/api/auth/wechat/callback"),
        "returnUrl 含 127.0.0.1:3010 前端回调",
      );
    } catch (e) {
      fail("本地后端可达", e.message);
    }

    console.log("\n【B. 前端产物】");
    try {
      const { readdirSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const chunksDir = join(FRONTEND_OUT, "_next", "static", "chunks");
      let all = "";
      try {
        for (const f of readdirSync(chunksDir)) {
          if (f.endsWith(".js")) all += readFileSync(join(chunksDir, f), "utf-8");
        }
      } catch {
        all = "";
      }
      await check(
        all.includes("encodeURIComponent(window.location.origin)"),
        "产物含 window.location.origin 参数（登录按钮带 origin）",
      );
      await check(
        all.includes('endsWith("/api")') && all.includes("auth/wechat/start"),
        "产物含 endsWith('/api') 拼接防御",
      );
    } catch (e) {
      fail("产物检查", e.message);
    }
  }

  // ---------- 生产 ----------
  if (doProd) {
    console.log("【C. kaypal 白名单（127.0.0.1:3010）】");
    try {
      const res = await fetch(`${KAYPAL}/api/auth/wechat/url?returnUrl=${LOOPBACK_RETURN}`, {
        redirect: "manual",
      });
      const setCookie = res.headers.get("set-cookie") || "";
      await check(
        res.status === 302 &&
          (res.headers.get("location") || "").startsWith("https://open.weixin.qq.com"),
        "wechat/url 302 到微信扫码",
      );
      await check(
        /wechat_login_return=[^;]*localhost%3A3010|wechat_login_return=[^;]*127\.0\.0\.1%3A3010/.test(
          setCookie,
        ),
        "returnUrl 被接受并写入 cookie",
      );
    } catch (e) {
      fail("白名单检查", e.message);
    }

    console.log("\n【D. returnUrl 内存暂存召回（不带 cookie）】");
    try {
      // 1) 拿 state
      const res1 = await fetch(`${KAYPAL}/api/auth/wechat/url?returnUrl=${LOOPBACK_RETURN}`, {
        redirect: "manual",
      });
      const setCookie1 = res1.headers.get("set-cookie") || "";
      const stateMatch = setCookie1.match(/wechat_login_state=([a-f0-9]{32})/);
      await check(Boolean(stateMatch), "拿到 state", stateMatch?.[1]?.slice(0, 8) + "...");

      // 2) 不带 cookie 模拟回调（关键：仅 state 也能召回 = 内存暂存生效）
      if (stateMatch) {
        const res2 = await fetch(
          `${KAYPAL}/api/auth/wechat/callback?code=fake&state=${stateMatch[1]}`,
          { redirect: "manual" },
        );
        const loc2 = res2.headers.get("location") || "";
        const loc2Decoded = decodeURIComponent(loc2);
        // 修前：returnUrl 落默认 /zh-CN/dashboard/entry（自动跳 apps）→ 用户被丢在 kaypal 站内
        // 修后：returnUrl 被召回为 127.0.0.1:3010 前端回调
        await check(
          loc2Decoded.includes("localhost:3010") || loc2Decoded.includes("127.0.0.1:3010"),
          "不带 cookie 仅 state 召回 returnUrl",
          loc2Decoded.includes("dashboard/entry") ? "⚠️ 落默认页(未召回!)" : "✓ 正确召回",
        );
      }
    } catch (e) {
      fail("内存暂存检查", e.message);
    }

    console.log("\n【E. 恶意 origin 拒绝】");
    try {
      const evilReturn = encodeURIComponent("https://evil.com/callback");
      const res = await fetch(`${KAYPAL}/api/auth/wechat/url?returnUrl=${evilReturn}`, {
        redirect: "manual",
      });
      const setCookie = res.headers.get("set-cookie") || "";
      await check(
        !decodeURIComponent(setCookie).includes("evil.com"),
        "恶意 origin 被拒绝",
      );
    } catch (e) {
      fail("恶意 origin 检查", e.message);
    }
  }

  // ---------- 汇总 ----------
  console.log(`\n=== 结果: ${failures.length === 0 ? "✅ 全绿" : `❌ ${failures.length} 项失败`} (${passCount} 通过) ===`);
  if (failures.length) {
    console.log("失败项:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(2);
});
