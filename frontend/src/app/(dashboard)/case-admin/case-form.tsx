"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select, SelectItem, Textarea, addToast } from "@heroui/react";
import { Check, Plus, Send, Trash2 } from "lucide-react";
import {
  caseAdminApi,
  type AdminCase,
  type AdminKeyFeature,
  type CaseAdminInput,
} from "@/lib/api/case-admin";
import { OpsFormRow, OpsPanel } from "../components/desktop-ops-ui";

const PROVENANCE_OPTIONS = [
  { key: "delivery", label: "九章交付" },
  { key: "open_source", label: "开源演示" },
  { key: "prototype", label: "概念原型" },
  { key: "template", label: "可定制模板" },
];

const EVIDENCE_OPTIONS = ["E0", "E1", "E2", "E3"];
const MATURITY_OPTIONS = ["concept", "prototype", "mvp", "product", "scale"];
const ENDPOINT_TYPE_OPTIONS = ["h5", "web", "wechat_mini_program", "download", "appointment"];
const FALLBACK_OPTIONS = ["media", "url", "none"];

interface Draft {
  title: string;
  slug: string;
  subtitle: string;
  provenanceType: string;
  clientVisibility: string;
  primaryPlatform: string;
  platformsText: string;
  primaryIndustry: string;
  industriesText: string;
  capabilityTagsText: string;
  businessProblem: string;
  solutionSummary: string;
  resultsSummary: string;
  evidenceLevel: string;
  evidenceScope: string;
  maturity: string;
  techSummary: string;
  coverUrl: string;
  seoTitle: string;
  seoDescription: string;
  keyFeatures: AdminKeyFeature[];
  media: Array<{ mediaType: string; fileUrl: string; title: string; altText: string }>;
  demoEndpoints: Array<{
    endpointType: string;
    targetUrl: string;
    fallbackType: string;
    fallbackTarget: string;
    accessInstruction: string;
  }>;
}

function splitCsv(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toDraft(c: AdminCase): Draft {
  return {
    title: c.title,
    slug: c.slug,
    subtitle: c.subtitle ?? "",
    provenanceType: c.provenanceType ?? "prototype",
    clientVisibility: c.clientVisibility ?? "public",
    primaryPlatform: c.primaryPlatform ?? "",
    platformsText: (c.platforms ?? []).join(", "),
    primaryIndustry: c.primaryIndustry ?? "",
    industriesText: (c.industries ?? []).join(", "),
    capabilityTagsText: (c.capabilityTags ?? []).join(", "),
    businessProblem: c.businessProblem ?? "",
    solutionSummary: c.solutionSummary ?? "",
    resultsSummary: c.resultsSummary ?? "",
    evidenceLevel: c.evidenceLevel ?? "E0",
    evidenceScope: c.evidenceScope ?? "",
    maturity: c.maturity ?? "concept",
    techSummary: c.techSummary ?? "",
    coverUrl: c.coverMedia?.url ?? "",
    seoTitle: c.seoTitle ?? "",
    seoDescription: c.seoDescription ?? "",
    keyFeatures: (c.keyFeatures ?? []).map((f) => ({ title: f.title ?? "", description: f.description ?? "" })),
    media: (c.media ?? []).map((m) => ({
      mediaType: m.mediaType ?? "image",
      fileUrl: m.fileUrl ?? "",
      title: m.title ?? "",
      altText: m.altText ?? "",
    })),
    demoEndpoints: (c.demoEndpoints ?? []).map((d) => ({
      endpointType: d.endpointType ?? "web",
      targetUrl: d.targetUrl ?? "",
      fallbackType: d.fallbackType ?? "media",
      fallbackTarget: d.fallbackTarget ?? "",
      accessInstruction: d.accessInstruction ?? "",
    })),
  };
}

function emptyDraft(): Draft {
  return toDraft({
    id: "",
    slug: "",
    title: "",
    provenanceType: "prototype",
    clientVisibility: "public",
    platforms: [],
    industries: [],
    capabilityTags: [],
    keyFeatures: [],
    evidenceLevel: "E0",
    deliveryModes: [],
    maturity: "concept",
    status: "draft",
    createdAt: "",
    updatedAt: "",
    media: [],
    demoEndpoints: [],
    authorizations: [],
  } as unknown as AdminCase);
}

function toInput(draft: Draft): CaseAdminInput {
  return {
    title: draft.title.trim(),
    slug: draft.slug.trim() || undefined,
    subtitle: draft.subtitle.trim() || undefined,
    provenanceType: draft.provenanceType,
    clientVisibility: draft.clientVisibility,
    primaryPlatform: draft.primaryPlatform.trim() || undefined,
    platforms: splitCsv(draft.platformsText),
    primaryIndustry: draft.primaryIndustry.trim() || undefined,
    industries: splitCsv(draft.industriesText),
    capabilityTags: splitCsv(draft.capabilityTagsText),
    businessProblem: draft.businessProblem || undefined,
    solutionSummary: draft.solutionSummary || undefined,
    resultsSummary: draft.resultsSummary || undefined,
    evidenceLevel: draft.evidenceLevel,
    evidenceScope: draft.evidenceScope || undefined,
    maturity: draft.maturity,
    techSummary: draft.techSummary || undefined,
    coverMedia: draft.coverUrl.trim() ? { url: draft.coverUrl.trim() } : undefined,
    seoTitle: draft.seoTitle.trim() || undefined,
    seoDescription: draft.seoDescription || undefined,
    keyFeatures: draft.keyFeatures,
    media: draft.media.map((m) => ({ ...m, fileUrl: m.fileUrl || undefined })),
    demoEndpoints: draft.demoEndpoints.map((d) => ({
      endpointType: d.endpointType,
      targetUrl: d.targetUrl || undefined,
      fallbackType: d.fallbackType || "media",
      fallbackTarget: d.fallbackTarget || undefined,
      accessInstruction: d.accessInstruction || undefined,
    })),
  };
}

export function CaseForm({ caseId, initial }: { caseId?: string; initial?: AdminCase }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => (initial ? toDraft(initial) : emptyDraft()));
  const [hints, setHints] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initial) setDraft(toDraft(initial));
  }, [initial]);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const refreshHints = useCallback(async (input: CaseAdminInput) => {
    try {
      const result = await caseAdminApi.validate(input);
      setHints(result.hints ?? []);
    } catch {
      setHints([]);
    }
  }, []);

  const save = useCallback(async () => {
    const input = toInput(draft);
    setSaving(true);
    try {
      if (caseId) {
        await caseAdminApi.update(caseId, input);
        addToast({ title: "已保存", color: "success" });
      } else {
        const created = await caseAdminApi.create(input);
        addToast({ title: "已创建草稿", color: "success" });
        router.replace(`/case-admin/${created.id}`);
        return;
      }
    } catch (e) {
      addToast({ title: "保存失败", description: String((e as Error)?.message ?? e), color: "danger" });
    } finally {
      setSaving(false);
    }
  }, [draft, caseId, router]);

  const submitReview = useCallback(async () => {
    if (!caseId) return;
    setSubmitting(true);
    try {
      await caseAdminApi.submit(caseId);
      addToast({ title: "已提交审核", color: "success" });
      router.refresh();
    } catch (e) {
      addToast({ title: "提交失败", description: String((e as Error)?.message ?? e), color: "danger" });
    } finally {
      setSubmitting(false);
    }
  }, [caseId, router]);

  const checkCompleteness = useCallback(() => {
    void refreshHints(toInput(draft));
  }, [draft, refreshHints]);

  const complete = hints.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <OpsPanel title="基础信息">
        <div className="grid gap-4 md:grid-cols-2">
          <OpsFormRow label="标题 *">
            <Input size="sm" value={draft.title} onChange={(e) => update({ title: e.target.value })} placeholder="案例标题" />
          </OpsFormRow>
          <OpsFormRow label="slug">
            <Input size="sm" value={draft.slug} onChange={(e) => update({ slug: e.target.value })} placeholder="小写字母/数字/连字符，留空自动生成" />
          </OpsFormRow>
          <OpsFormRow label="副标题">
            <Input size="sm" value={draft.subtitle} onChange={(e) => update({ subtitle: e.target.value })} placeholder="一句话价值" />
          </OpsFormRow>
          <OpsFormRow label="来源类型 *">
            <Select
              size="sm"
              selectedKeys={[draft.provenanceType]}
              onSelectionChange={(keys) => {
                const value = Array.from(keys as Set<string>)[0];
                if (value) update({ provenanceType: value });
              }}
            >
              {PROVENANCE_OPTIONS.map((o) => (
                <SelectItem key={o.key}>{o.label}</SelectItem>
              ))}
            </Select>
          </OpsFormRow>
        </div>
      </OpsPanel>

      <OpsPanel title="分类标签">
        <div className="grid gap-4 md:grid-cols-2">
          <OpsFormRow label="主平台">
            <Input size="sm" value={draft.primaryPlatform} onChange={(e) => update({ primaryPlatform: e.target.value })} placeholder="平台代码" />
          </OpsFormRow>
          <OpsFormRow label="主行业">
            <Input size="sm" value={draft.primaryIndustry} onChange={(e) => update({ primaryIndustry: e.target.value })} placeholder="行业代码" />
          </OpsFormRow>
          <OpsFormRow label="平台列表（逗号分隔）">
            <Input size="sm" value={draft.platformsText} onChange={(e) => update({ platformsText: e.target.value })} placeholder="web, h5, app" />
          </OpsFormRow>
          <OpsFormRow label="行业列表（逗号分隔）">
            <Input size="sm" value={draft.industriesText} onChange={(e) => update({ industriesText: e.target.value })} placeholder="manufacturing, retail" />
          </OpsFormRow>
          <OpsFormRow label="能力标签（逗号分隔）">
            <Input size="sm" value={draft.capabilityTagsText} onChange={(e) => update({ capabilityTagsText: e.target.value })} placeholder="knowledge-base, ai-assistant" />
          </OpsFormRow>
          <OpsFormRow label="证据等级">
            <Select
              size="sm"
              selectedKeys={[draft.evidenceLevel]}
              onSelectionChange={(keys) => {
                const value = Array.from(keys as Set<string>)[0];
                if (value) update({ evidenceLevel: value });
              }}
            >
              {EVIDENCE_OPTIONS.map((e) => (
                <SelectItem key={e}>{e}</SelectItem>
              ))}
            </Select>
          </OpsFormRow>
          <OpsFormRow label="成熟度">
            <Select
              size="sm"
              selectedKeys={[draft.maturity]}
              onSelectionChange={(keys) => {
                const value = Array.from(keys as Set<string>)[0];
                if (value) update({ maturity: value });
              }}
            >
              {MATURITY_OPTIONS.map((m) => (
                <SelectItem key={m}>{m}</SelectItem>
              ))}
            </Select>
          </OpsFormRow>
        </div>
      </OpsPanel>

      <OpsPanel title="案例内容">
        <div className="flex flex-col gap-4">
          <OpsFormRow label="业务问题">
            <Textarea size="sm" minRows={2} value={draft.businessProblem} onChange={(e) => update({ businessProblem: e.target.value })} placeholder="客户遇到了什么问题" />
          </OpsFormRow>
          <OpsFormRow label="方案摘要">
            <Textarea size="sm" minRows={2} value={draft.solutionSummary} onChange={(e) => update({ solutionSummary: e.target.value })} placeholder="九章提供了什么方案" />
          </OpsFormRow>
          <OpsFormRow label="成果摘要">
            <Textarea size="sm" minRows={2} value={draft.resultsSummary} onChange={(e) => update({ resultsSummary: e.target.value })} placeholder="交付结果与成效" />
          </OpsFormRow>
          <OpsFormRow label="证据范围">
            <Textarea size="sm" minRows={2} value={draft.evidenceScope} onChange={(e) => update({ evidenceScope: e.target.value })} placeholder="证据等级非 E0 时必填" />
          </OpsFormRow>
          <OpsFormRow label="技术概要">
            <Textarea size="sm" minRows={2} value={draft.techSummary} onChange={(e) => update({ techSummary: e.target.value })} placeholder="技术栈与架构概要" />
          </OpsFormRow>
          <OpsFormRow label="封面 URL">
            <Input size="sm" value={draft.coverUrl} onChange={(e) => update({ coverUrl: e.target.value })} placeholder="https://..." />
          </OpsFormRow>
        </div>
      </OpsPanel>

      <OpsPanel title="关键特性（至少 3 项）" extra={
        <Button size="sm" variant="flat" onPress={() => update({ keyFeatures: [...draft.keyFeatures, { title: "", description: "" }] })}>
          <Plus className="h-3.5 w-3.5" /> 添加
        </Button>
      }>
        <div className="flex flex-col gap-2">
          {draft.keyFeatures.map((f, index) => (
            <div key={index} className="flex items-start gap-2">
              <Input
                size="sm"
                className="flex-1"
                value={f.title}
                onChange={(e) => {
                  const next = [...draft.keyFeatures];
                  next[index] = { ...next[index], title: e.target.value };
                  update({ keyFeatures: next });
                }}
                placeholder={`特性 ${index + 1} 标题`}
              />
              <Textarea
                size="sm"
                className="flex-1"
                minRows={1}
                value={f.description}
                onChange={(e) => {
                  const next = [...draft.keyFeatures];
                  next[index] = { ...next[index], description: e.target.value };
                  update({ keyFeatures: next });
                }}
                placeholder={`特性 ${index + 1} 描述`}
              />
              <Button size="sm" variant="light" color="danger" onPress={() => update({ keyFeatures: draft.keyFeatures.filter((_, i) => i !== index) })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </OpsPanel>

      <OpsPanel title="媒体（至少 1 条）" extra={
        <Button size="sm" variant="flat" onPress={() => update({ media: [...draft.media, { mediaType: "image", fileUrl: "", title: "", altText: "" }] })}>
          <Plus className="h-3.5 w-3.5" /> 添加
        </Button>
      }>
        <div className="flex flex-col gap-2">
          {draft.media.map((m, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-[120px_1fr_1fr_1fr_auto]">
              <Select
                size="sm"
                selectedKeys={[m.mediaType]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys as Set<string>)[0];
                  if (!value) return;
                  const next = [...draft.media];
                  next[index] = { ...next[index], mediaType: value };
                  update({ media: next });
                }}
              >
                <SelectItem key="image">图片</SelectItem>
                <SelectItem key="video">视频</SelectItem>
                <SelectItem key="document">文档</SelectItem>
              </Select>
              <Input size="sm" value={m.fileUrl} onChange={(e) => { const next = [...draft.media]; next[index] = { ...next[index], fileUrl: e.target.value }; update({ media: next }); }} placeholder="文件 URL" />
              <Input size="sm" value={m.title} onChange={(e) => { const next = [...draft.media]; next[index] = { ...next[index], title: e.target.value }; update({ media: next }); }} placeholder="标题" />
              <Input size="sm" value={m.altText} onChange={(e) => { const next = [...draft.media]; next[index] = { ...next[index], altText: e.target.value }; update({ media: next }); }} placeholder="无障碍替代文本" />
              <Button size="sm" variant="light" color="danger" onPress={() => update({ media: draft.media.filter((_, i) => i !== index) })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </OpsPanel>

      <OpsPanel title="演示体验入口（至少 1 个，需回退方案）" extra={
        <Button size="sm" variant="flat" onPress={() => update({ demoEndpoints: [...draft.demoEndpoints, { endpointType: "web", targetUrl: "", fallbackType: "media", fallbackTarget: "", accessInstruction: "" }] })}>
          <Plus className="h-3.5 w-3.5" /> 添加
        </Button>
      }>
        <div className="flex flex-col gap-2">
          {draft.demoEndpoints.map((d, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-[130px_1fr_110px_1fr_auto]">
              <Select
                size="sm"
                selectedKeys={[d.endpointType]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys as Set<string>)[0];
                  if (!value) return;
                  const next = [...draft.demoEndpoints];
                  next[index] = { ...next[index], endpointType: value };
                  update({ demoEndpoints: next });
                }}
              >
                {ENDPOINT_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t}>{t}</SelectItem>
                ))}
              </Select>
              <Input size="sm" value={d.targetUrl} onChange={(e) => { const next = [...draft.demoEndpoints]; next[index] = { ...next[index], targetUrl: e.target.value }; update({ demoEndpoints: next }); }} placeholder="目标 URL（内部）" />
              <Select
                size="sm"
                selectedKeys={[d.fallbackType]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys as Set<string>)[0];
                  if (!value) return;
                  const next = [...draft.demoEndpoints];
                  next[index] = { ...next[index], fallbackType: value };
                  update({ demoEndpoints: next });
                }}
              >
                {FALLBACK_OPTIONS.map((f) => (
                  <SelectItem key={f}>{f}</SelectItem>
                ))}
              </Select>
              <Input size="sm" value={d.fallbackTarget} onChange={(e) => { const next = [...draft.demoEndpoints]; next[index] = { ...next[index], fallbackTarget: e.target.value }; update({ demoEndpoints: next }); }} placeholder="回退目标" />
              <Button size="sm" variant="light" color="danger" onPress={() => update({ demoEndpoints: draft.demoEndpoints.filter((_, i) => i !== index) })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </OpsPanel>

      <OpsPanel title="SEO（可选）">
        <div className="grid gap-4 md:grid-cols-2">
          <OpsFormRow label="SEO 标题">
            <Input size="sm" value={draft.seoTitle} onChange={(e) => update({ seoTitle: e.target.value })} />
          </OpsFormRow>
          <OpsFormRow label="SEO 描述">
            <Input size="sm" value={draft.seoDescription} onChange={(e) => update({ seoDescription: e.target.value })} />
          </OpsFormRow>
        </div>
      </OpsPanel>

      {hints.length > 0 ? (
        <div className="rounded-lg border border-[var(--kaypal-v3-amber)] bg-warning-50 px-3 py-2 text-12 text-default-700">
          <div className="mb-1 font-semibold">完整性提示：</div>
          <ul className="list-inside list-disc">
            {hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button color="primary" isLoading={saving} onPress={save}>
          <Check className="h-4 w-4" /> {caseId ? "保存" : "创建草稿"}
        </Button>
        {caseId ? (
          <Button color="success" isLoading={submitting} onPress={submitReview}>
            <Send className="h-4 w-4" /> 提交审核
          </Button>
        ) : null}
        <Button variant="flat" onPress={checkCompleteness}>
          检查完整度
        </Button>
        {complete && hints.length === 0 ? (
          <span className="text-12 text-success">字段已较完整</span>
        ) : null}
      </div>
    </div>
  );
}
