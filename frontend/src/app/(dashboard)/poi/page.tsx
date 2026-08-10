"use client";

/**
 * 门店 POI 管理（对标炼刀 /poi，P1 前端接入 2026-08-10）
 * 列表 / 新增 / 删除 / 城市分类报表；移动端卡片 + 桌面表格式。
 */
import React, { useCallback, useEffect, useState } from "react";
import { Button, Input, addToast } from "@heroui/react";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { poiApi, type PoiStore, type PoiReport } from "@/lib/api/poi";
import { toPublicError } from "@/lib/public-error";

export default function PoiPage() {
  const isMobile = useIsMobile();
  const [stores, setStores] = useState<PoiStore[]>([]);
  const [report, setReport] = useState<PoiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", city: "", category: "", tags: "" });
  const [busy, setBusy] = useState(false);

  const toast = (title: string, color: "success" | "danger" = "success") => addToast({ title, color });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, rep] = await Promise.all([poiApi.list(), poiApi.report().catch(() => null)]);
      setStores(list.rows);
      setReport(rep);
    } catch (e) {
      setError(toPublicError(e, "门店数据加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast("请填写门店名称", "danger");
      return;
    }
    setBusy(true);
    try {
      await poiApi.create({ ...form, name: form.name.trim() });
      toast("✅ 门店已添加");
      setForm({ name: "", address: "", city: "", category: "", tags: "" });
      setShowForm(false);
      await load();
    } catch (e) {
      toast(toPublicError(e, "添加失败"), "danger");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (s: PoiStore) => {
    if (!window.confirm(`确定删除门店「${s.name}」？此操作不可撤销`)) return;
    try {
      await poiApi.remove(s.id);
      toast("已删除");
      await load();
    } catch (e) {
      toast(toPublicError(e, "删除失败"), "danger");
    }
  };

  const formView = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 520 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
        <Input label="门店名称 *" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        <Input label="城市" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
      </div>
      <Input label="地址" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
        <Input label="分类（餐饮/零售/服务…）" value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} />
        <Input label="标签（逗号分隔，可选）" value={form.tags} onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button color="primary" isLoading={busy} onPress={handleCreate}>保存</Button>
        <Button variant="flat" onPress={() => setShowForm(false)}>取消</Button>
      </div>
    </div>
  );

  const listView = stores.length === 0 ? (
    <div style={{ padding: 24, textAlign: "center", fontSize: 13, opacity: 0.7 }}>还没有门店数据，点「添加门店」录入</div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 520 }}>
      {stores.map((s) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: "rgba(120,148,179,.1)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</div>
            <div style={{ fontSize: 11.5, opacity: 0.7, marginTop: 2 }}>
              {[s.city, s.category, s.address].filter(Boolean).join(" · ") || "未填写地址"}
              {s.visitCount ? ` · 探访 ${s.visitCount}` : ""}
            </div>
          </div>
          <button type="button" onClick={() => void handleDelete(s)} style={{ color: "#dc2626", fontSize: 11.5, background: "none", border: "none", cursor: "pointer", flexShrink: 0 }}>删除</button>
        </div>
      ))}
    </div>
  );

  const reportView = report ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 520 }}>
      <div style={{ fontSize: 12.5 }}>
        共 <b>{report.total}</b> 家门店 · 累计探访 <b>{report.totalVisits}</b> 次
      </div>
      {report.byCity?.length ? (
        <div style={{ fontSize: 12, opacity: 0.8 }}>城市：{report.byCity.map((c) => `${c.city}×${c.count}`).join("、")}</div>
      ) : null}
      {report.byCategory?.length ? (
        <div style={{ fontSize: 12, opacity: 0.8 }}>分类：{report.byCategory.map((c) => `${c.category || "未分类"}×${c.count}`).join("、")}</div>
      ) : null}
    </div>
  ) : null;

  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">门店管理</h1>
              <p className="mx-page-sub">门店 POI 数据与探访统计</p>
            </div>
            <button type="button" className="mx-btn-gold" style={{ fontSize: 12, padding: "8px 14px" }} onClick={() => setShowForm((v) => !v)}>
              {showForm ? "收起" : "添加门店"}
            </button>
          </div>
        </header>
        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {error ? <p style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>⚠️ {error}</p> : null}
          {showForm ? <div className="mx-card" style={{ padding: 16, marginBottom: 12 }}>{formView}</div> : null}
          {reportView ? <div className="mx-card" style={{ padding: 14, marginBottom: 12 }}>{reportView}</div> : null}
          {loading ? (
            <div className="mx-card" style={{ padding: 16 }}>
              <div className="mx-skeleton-row"><div className="mx-skeleton-line" style={{ width: "70%" }} /></div>
              <div className="mx-skeleton-row"><div className="mx-skeleton-line" style={{ width: "50%" }} /></div>
            </div>
          ) : (
            <div className="mx-card mx-list-card">{listView}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>门店 POI 管理</h2>
          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>门店数据 + 城市/分类统计（对标炼刀 /poi）</p>
        </div>
        <Button color="primary" onPress={() => setShowForm((v) => !v)}>{showForm ? "收起" : "添加门店"}</Button>
      </header>
      {error ? <p style={{ fontSize: 13, color: "#dc2626" }}>⚠️ {error}</p> : null}
      {showForm ? formView : null}
      {reportView}
      {loading ? <p style={{ fontSize: 13, opacity: 0.6 }}>加载中…</p> : listView}
    </div>
  );
}
