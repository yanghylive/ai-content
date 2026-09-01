"use client";

/**
 * 商品视频剪辑（炼刀 video_creation 对标 · P0 前端接入 2026-08-10）
 * 流程：商品信息 → 带货文案（钩子/卖点分镜/价格锚点/CTA）→ studio_core promo 成片
 * 引擎离线时降级返回文案（后端已处理），前端始终可交互。
 */
import React, { useState } from "react";
import { Button, Input, Textarea, addToast } from "@heroui/react";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { videoApi, type ProductCopy, type ProductCutResult } from "@/lib/api/video";
import { toPublicError } from "@/lib/public-error";
import { V2BackButton } from "@/components/v2/v2-back-button";

export default function ProductCutPage() {
  const isMobile = useIsMobile();
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [price, setPrice] = useState("");
  const [audience, setAudience] = useState("");
  const [busyCopy, setBusyCopy] = useState(false);
  const [busyCut, setBusyCut] = useState(false);
  const [copy, setCopy] = useState<ProductCopy | null>(null);
  const [result, setResult] = useState<ProductCutResult | null>(null);
  const [err, setErr] = useState("");

  const input = () => ({
    productName: productName.trim(),
    sellingPoints: sellingPoints
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
    price: price.trim() || undefined,
    audience: audience.trim() || undefined,
  });

  const toast = (title: string, color: "success" | "danger" = "success") =>
    addToast({ title, color });

  const handleCopy = async () => {
    if (!input().productName) {
      toast("请填写商品名称", "danger");
      return;
    }
    setErr("");
    setBusyCopy(true);
    try {
      const data = await videoApi.productCopy(input());
      setCopy(data);
      toast("✅ 带货文案已生成");
    } catch (e) {
      setErr(toPublicError(e, "文案生成失败"));
    } finally {
      setBusyCopy(false);
    }
  };

  const handleCut = async () => {
    if (!input().productName) {
      toast("请填写商品名称", "danger");
      return;
    }
    setErr("");
    setBusyCut(true);
    try {
      const data = await videoApi.productCut(input());
      setResult(data);
      if (data.ok && data.videoUrl) {
        toast("🎬 成片已生成");
      } else if (data.copy || data.message) {
        toast("⚠️ 引擎离线，已降级返回文案");
      }
    } catch (e) {
      setErr(toPublicError(e, "成片生成失败"));
    } finally {
      setBusyCut(false);
    }
  };

  const field = (label: string, node: React.ReactNode) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
      {label}
      {node}
    </label>
  );

  const form = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520, width: "100%" }}>
      {field("商品名称 *", <Input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="如：便携榨汁杯" />)}
      {field("卖点（逗号分隔，可选）", <Textarea value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} placeholder="如：无线充电, 300ml 大容量, 一键清洗" rows={2} />)}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        {field("价格（可选）", <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="如：129" />)}
        {field("目标人群（可选）", <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="如：通勤上班族" />)}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button color="primary" isLoading={busyCopy} onPress={handleCopy}>生成带货文案</Button>
        <Button color="success" variant="flat" isLoading={busyCut} onPress={handleCut}>一键成片</Button>
      </div>
    </div>
  );

  const copyView = copy ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520, width: "100%" }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>📝 带货文案</div>
      {copy.title ? <div style={{ fontSize: 13 }}><b>标题：</b>{copy.title}</div> : null}
      {copy.copy ? <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{copy.copy}</div> : null}
      {copy.segments?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {copy.segments.map((s, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.6, padding: "8px 10px", borderRadius: 10, background: "rgba(120,148,179,.1)" }}>
              <b>[{s.seconds}s]</b> {s.visual ? `（${s.visual}）` : ""} {s.subtitle}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  const resultView = result ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520, width: "100%" }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>🎬 成片结果</div>
      {result.videoUrl ? (
        <video controls src={result.videoUrl} style={{ width: "100%", borderRadius: 12, maxHeight: 320 }} />
      ) : (
        <div style={{ fontSize: 12.5, opacity: 0.8 }}>{result.message || result.status || "（引擎离线，已降级为文案）"}</div>
      )}
      {result.copy ? (
        <div style={{ fontSize: 12.5 }}>
          <b>带货文案：</b>{result.copy.title || result.copy.copy?.slice(0, 60) || "已生成"}
        </div>
      ) : null}
    </div>
  ) : null;

  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ marginTop: 8 }}>
          <V2BackButton to="/content" />
        </div>
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">商品视频</h1>
              <p className="mx-page-sub">商品信息 → 带货文案 → 一键成片</p>
            </div>
          </div>
        </header>
        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          <div className="mx-card" style={{ padding: 16 }}>
            {form}
          </div>
          {err ? <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", marginTop: 12 }}>⚠️ {err}</p> : null}
          {copyView ? <div className="mx-card" style={{ padding: 14, marginTop: 12 }}>{copyView}</div> : null}
          {resultView ? <div className="mx-card" style={{ padding: 14, marginTop: 12 }}>{resultView}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">商品视频剪辑</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">
            填商品信息 → 生成带货文案 → studio_core 一键成片
          </p>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {form}
        {err ? <p style={{ fontSize: 13, color: "var(--kaypal-v3-danger)" }}>⚠️ {err}</p> : null}
        {copyView}
        {resultView}
      </div>
    </div>
  );
}
