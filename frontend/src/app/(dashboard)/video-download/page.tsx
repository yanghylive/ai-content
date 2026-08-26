"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { redfoxApi } from "@/lib/api/redfox";
import { toActionableError } from "@/lib/public-error";

type PlatformOption = { key: string; label: string };

/** 从分享文本里提取第一个 http(s) URL（兼容抖音口令/小红书等嵌入短链） */
function extractFirstUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s，,。；;]+/i);
  return match ? match[0] : "";
}

export default function VideoDownloadPage() {
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState("auto");
  const [platforms, setPlatforms] = useState<PlatformOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  // 拉取后端支持的平台列表
  useEffect(() => {
    void redfoxApi
      .listDownloadPlatforms()
      .then((r) => setPlatforms(r.items || []))
      .catch(() => setPlatforms([]));
  }, []);

  const handleCollect = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    const target = extractFirstUrl(trimmed);
    if (!target) {
      setMsg({ kind: "err", text: "未识别到作品链接，请粘贴包含 http(s) 链接的分享内容" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (platform === "auto") {
        const result = await redfoxApi.collectFromLink({ url: target });
        const sizeMb = (result.sizeBytes / 1048576).toFixed(1);
        setMsg({
          kind: "ok",
          text: `✅ 已采集：${result.filename}（${sizeMb}MB）· 已存入发布素材库，可去「发布」选用`,
        });
      } else {
        const result = await redfoxApi.platformDownload({
          platform,
          url: target,
        });
        const data = result.data as Record<string, unknown> | undefined;
        const filename =
          (data?.filename as string) ||
          (data?.fileName as string) ||
          (data?.title as string) ||
          "素材";
        const size = Number(data?.size ?? data?.sizeBytes ?? 0);
        setMsg({
          kind: "ok",
          text: `✅ ${result.platformLabel}已解析：${filename}${
            size ? `（${(size / 1048576).toFixed(1)}MB）` : ""
          }· 已存入发布素材库`,
        });
      }
      setUrl("");
    } catch (e) {
      setMsg({
        kind: "err",
        text: `❌ ${toActionableError(e, "采集失败")}`,
      });
    } finally {
      setBusy(false);
    }
  }, [url, platform, busy]);

  return (
    <div>
      <V2BackButton />

      {/* 桌面端顶部栏：返回 + 标题 */}
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">视频去水印</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">粘贴分享链接，自动去水印保存到素材库</p>
        </div>
      </div>

      <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
        <div
          className="mx-card"
          style={{
            padding: 18,
            background: "var(--kaypal-v3-paper)",
            border: "1px solid var(--kaypal-v3-border)",
            borderRadius: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <Link2
              width={16}
              height={16}
              style={{ color: "var(--kaypal-v3-accent-ink)" }}
              aria-hidden="true"
            />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--kaypal-v3-ink)",
              }}
            >
              粘贴作品分享链接
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--kaypal-v3-muted)",
              lineHeight: 1.6,
              marginBottom: 14,
            }}
          >
            支持抖音 / 快手 / 小红书 / 视频号 / B站 / TikTok / YouTube / X /
            Instagram 等多平台；自动识别平台或手动指定。
          </div>

          {/* 平台选择芯片 */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 12,
            }}
          >
            <button
              type="button"
              onClick={() => setPlatform("auto")}
              className="v3-platform-chip"
              data-active={platform === "auto"}
            >
              自动识别
            </button>
            {platforms.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPlatform(p.key)}
                className="v3-platform-chip"
                data-active={platform === p.key}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* 链接输入 */}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="粘贴作品链接或抖音/小红书分享口令，如：https://www.douyin.com/video/xxx"
            className="v3-link-input"
          />

          {/* 格式提示（参考 redfox 官方：支持纯净链接 或 整段分享口令） */}
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--kaypal-v3-paper-soft)",
              border: "1px solid var(--kaypal-v3-border)",
              fontSize: 12,
              color: "var(--kaypal-v3-muted)",
              lineHeight: 1.7,
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--kaypal-v3-soft-ink)", marginBottom: 4 }}>
              📋 支持两种粘贴格式
            </div>
            <div>① 纯净作品链接，例如：</div>
            <div className="v3-format-example">https://www.douyin.com/video/7649615187284833210</div>
            <div style={{ marginTop: 6 }}>② 抖音 / 小红书分享口令（整段复制粘贴即可，自动提取链接）：</div>
            <div className="v3-format-example">
              4.38 Oxs:/ 复制打开抖音，看看这条作品～ https://v.douyin.com/pjE9uqFMK68/ 复制此链接，打开Dou音搜索，直接观看视频！
            </div>
          </div>

          {/* 主操作按钮（亮/暗主题都有颜色） */}
          <button
            type="button"
            disabled={!url.trim() || busy}
            onClick={() => void handleCollect()}
            className="v3-primary-btn"
            data-busy={busy}
            style={{ marginTop: 12, width: "100%" }}
          >
            {busy ? (
              <>
                <Loader2
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                采集中…
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4" aria-hidden="true" />
                开始采集
              </>
            )}
          </button>

          {/* 状态消息 */}
          {msg ? (
            <div
              className={
                msg.kind === "ok"
                  ? "v3-status-ok"
                  : "v3-status-err"
              }
              style={{ marginTop: 12 }}
            >
              {msg.text}
            </div>
          ) : null}
        </div>

        {/* 提示：采集后去哪找 */}
        <div
          style={{
            marginTop: 12,
            fontSize: 12,
            color: "var(--kaypal-v3-muted)",
            lineHeight: 1.7,
            padding: "0 4px",
          }}
        >
          采集后的素材会自动存入「
          <Link
            href="/materials"
            style={{
              color: "var(--kaypal-v3-accent-ink)",
              textDecoration: "underline",
            }}
          >
            素材库
          </Link>
          」，可去「发布」直接选用，或继续「AI 生图 / AI 生视频 / AI 配音」二次创作。
        </div>
      </section>
    </div>
  );
}
