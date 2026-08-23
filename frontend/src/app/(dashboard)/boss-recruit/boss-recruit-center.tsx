"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Select,
  SelectItem,
  Spinner,
  Textarea,
  addToast,
} from "@heroui/react";
import {
  BriefcaseBusiness,
  MessageCircle,
  RefreshCw,
  Upload,
  UserRound,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import {
  bossRecruitApi,
  type BossCandidate,
  type BossRecruitState,
  type BossTask,
} from "@/lib/api/boss-recruit";
import { toPublicError } from "@/lib/public-error";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "default"> = {
  logged_in: "success",
  unknown: "default",
  not_logged_in: "warning",
  completed: "success",
  running: "warning",
  queued: "default",
  failed: "danger",
  contacted: "success",
  new: "default",
};

/** 绑定引导说明（T2-11：不再展示 F12/EditThisCookie 等开发者级操作，改为合规的开放前说明） */
const STORAGE_GUIDE_STEPS = [
  "BOSS 直聘获客当前处于灰度验证阶段，正式开放前暂不支持自主绑定账号。",
  "正式开放后，将提供合规的扫码登录绑定方式（需桌面客户端配合），无需导出任何数据。",
  "如有体验需求，请联系运营申请灰度名单。",
];

export function BossRecruitCenter() {
  const isMobile = useIsMobile();
  const [state, setState] = useState<BossRecruitState | null>(null);
  const [tasks, setTasks] = useState<BossTask[]>([]);
  const [candidates, setCandidates] = useState<BossCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  const [storageJson, setStorageJson] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [helloMessage, setHelloMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [s, t, c] = await Promise.all([
        bossRecruitApi.state(),
        bossRecruitApi.tasks(),
        bossRecruitApi.candidates(),
      ]);
      setState(s);
      setTasks(t);
      setCandidates(c);
    } catch (error: unknown) {
      addToast({
        title: "加载失败",
        description: toPublicError(error, "加载 Boss 状态失败"),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleUpload = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(storageJson);
    } catch {
      addToast({ title: "storageState 不是合法 JSON", color: "warning" });
      return;
    }
    try {
      setBusy("upload");
      const res = await bossRecruitApi.saveCookie(parsed);
      addToast({ title: "登录态已上传", description: `账号 ${res.accountId}`, color: "success" });
      setStorageJson("");
      void fetchAll();
    } catch (error: unknown) {
      addToast({
        title: "上传失败",
        description: toPublicError(error, "上传失败"),
        color: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleCheckLogin = async (accountId: string) => {
    try {
      setBusy(`check-${accountId}`);
      const res = await bossRecruitApi.checkLogin(accountId);
      addToast({
        title: `登录状态：${res.status}`,
        description: res.url ? res.url.slice(0, 80) : undefined,
        color: res.ok ? "success" : "warning",
      });
      void fetchAll();
    } catch (error: unknown) {
      addToast({
        title: "检测失败",
        description: toPublicError(error, "检测失败"),
        color: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleRefresh = async (accountId: string) => {
    try {
      setBusy(`refresh-${accountId}`);
      const res = await bossRecruitApi.refreshPositions(accountId, 3);
      addToast({ title: `已刷新 ${res.refreshed} 次职位`, color: "success" });
      void fetchAll();
    } catch (error: unknown) {
      addToast({
        title: "刷新失败",
        description: toPublicError(error, "刷新失败"),
        color: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleHello = async (accountId: string) => {
    const targetName = candidateId
      ? candidates.find((c) => c.id === candidateId)?.name ?? candidateName
      : candidateName;
    if (!targetName?.trim()) {
      addToast({ title: "请选择或填写候选人名称", color: "warning" });
      return;
    }
    try {
      setBusy(`hello-${accountId}`);
      const res = await bossRecruitApi.sendHello(
        accountId,
        targetName.trim(),
        helloMessage || undefined,
      );
      addToast({
        title: res.messageSent ? "打招呼已发送" : "打招呼未发出（未找到候选人）",
        color: res.messageSent ? "success" : "warning",
      });
      void fetchAll();
    } catch (error: unknown) {
      addToast({
        title: "打招呼失败",
        description: toPublicError(error, "打招呼失败"),
        color: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="加载中" />
      </div>
    );
  }

  const accounts = state?.accounts ?? [];

  const content = (
    <div className="flex flex-col gap-6">
      <WorkbenchCenter
        title="Boss 直聘获客"
        subtitle="网页自动化：登录态管理、职位刷新、候选人打招呼"
        icon={BriefcaseBusiness}
        stats={[
          { label: "已绑定账号", value: accounts.length, tone: "accent" },
          { label: "候选人", value: state?.candidates ?? 0, tone: "success" },
          { label: "待处理任务", value: state?.pendingTasks ?? 0, tone: "default" },
        ]}
      />

      <Card>
        <CardHeader className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-primary" />
          <span className="font-medium">绑定 Boss 直聘账号</span>
        </CardHeader>
        <Divider />
        <CardBody className="flex flex-col gap-4">
          <div className="rounded-xl border border-default-200 bg-default-50 p-4 dark:border-default-800">
            <p className="mb-2 text-sm font-medium text-default-900">
              如何导出登录态（5 步）
            </p>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-default-600">
              {STORAGE_GUIDE_STEPS.map((step, i) => (
                <li key={i} className="pl-0.5">
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-default-400">
              说明：为避免账号风险，不再支持手动导出浏览器登录态的方式；正式开放将提供官方扫码绑定。
            </p>
          </div>
          <Textarea
            label="登录态 JSON（storageState）"
            placeholder='灰度验证中暂不可用；正式开放后将改用扫码登录绑定'
            value={storageJson}
            onValueChange={setStorageJson}
            minRows={4}
            isDisabled
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button color="primary" startContent={<Upload className="h-4 w-4" />} isLoading={busy === "upload"} onPress={handleUpload}>
              上传并绑定
            </Button>
            <span className="text-xs text-default-400">
              扫码登录自动绑定正在规划中（需桌面客户端配合）
            </span>
          </div>
        </CardBody>
      </Card>

      {accounts.map((acc) => (
        <Card key={acc.id}>
          <CardHeader className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-primary" />
              <span className="font-medium">{acc.name}</span>
              <Chip size="sm" color={STATUS_TONE[acc.loginStatus] ?? "default"} variant="flat">
                {acc.loginStatus}
              </Chip>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="flat"
                startContent={<RefreshCw className="h-4 w-4" />}
                isLoading={busy === `check-${acc.id}`}
                onPress={() => handleCheckLogin(acc.id)}
              >
                检测登录
              </Button>
              <Button
                size="sm"
                variant="flat"
                startContent={<BriefcaseBusiness className="h-4 w-4" />}
                isLoading={busy === `refresh-${acc.id}`}
                onPress={() => handleRefresh(acc.id)}
              >
                刷新职位
              </Button>
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Select
                label="候选人（从已收录列表选择）"
                placeholder={candidates.length > 0 ? "选择候选人" : "暂无候选人，可手填下方名称"}
                selectedKeys={candidateId ? [candidateId] : []}
                onSelectionChange={(keys) => {
                  const first = Array.from(keys)[0] as string | undefined;
                  setCandidateId(first ?? "");
                }}
                isDisabled={candidates.length === 0}
                items={candidates}
              >
                {(candidate) => (
                  <SelectItem key={candidate.id} textValue={candidate.name}>
                    {candidate.name}
                    {candidate.jobTitle ? ` · ${candidate.jobTitle}` : ""}
                  </SelectItem>
                )}
              </Select>
              <Input
                label="候选人名称（手填）"
                placeholder="如：张三 / 前端工程师"
                value={candidateName}
                onValueChange={setCandidateName}
              />
              <Input
                label="打招呼语（可选）"
                placeholder="默认：您好，看到您的简历很匹配..."
                value={helloMessage}
                onValueChange={setHelloMessage}
              />
            </div>
            <div>
              <Button
                variant="flat"
                color="primary"
                startContent={<MessageCircle className="h-4 w-4" />}
                isLoading={busy === `hello-${acc.id}`}
                onPress={() => handleHello(acc.id)}
              >
                打招呼
              </Button>
            </div>
          </CardBody>
        </Card>
      ))}

      {accounts.length === 0 && (
        <p className="text-sm text-default-400">尚未绑定 Boss 账号，先上传登录态。</p>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="font-medium">最近任务（{tasks.length}）</span>
          <Button size="sm" variant="flat" onPress={fetchAll}>刷新</Button>
        </CardHeader>
        <Divider />
        <CardBody className="flex flex-col gap-2">
          {tasks.length === 0 && <p className="text-sm text-default-400">暂无任务。</p>}
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-xl border border-default-200 p-3">
              <div className="flex items-center gap-2">
                <Chip size="sm" color={STATUS_TONE[t.status] ?? "default"} variant="flat">
                  {t.status}
                </Chip>
                <span className="text-sm">{t.taskType}</span>
                <span className="text-xs text-default-400">
                  {new Date(t.createdAt).toLocaleString("zh-CN")}
                </span>
              </div>
              {t.errorMessage && (
                <span className="text-xs text-danger">{t.errorMessage.slice(0, 60)}</span>
              )}
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">Boss 直聘获客</h1>
              <p className="mx-page-sub">网页自动化获客</p>
            </div>
          </div>
        </header>
        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {/* 上传登录态 */}
          <div className="mx-card" style={{ padding: 14 }}>
            <div className="mx-row-title" style={{ marginBottom: 8, fontSize: 13.5, fontWeight: 700 }}>绑定 Boss 直聘账号</div>
            <details className="mx-guide-details" style={{ marginBottom: 10, fontSize: 12, color: "var(--mx-muted, #8ea5be)", lineHeight: 1.7 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "#c87922" }}>如何导出登录态？点开看 5 步</summary>
              <ol style={{ paddingLeft: 18, marginTop: 6 }}>
                {STORAGE_GUIDE_STEPS.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </details>
            <textarea
              value={storageJson}
              onChange={(e) => setStorageJson(e.target.value)}
              placeholder='粘贴 storageState JSON，例如 {"cookies":[...],"origins":[...]}'
              rows={4}
              style={{ width: "100%", minHeight: 72, padding: 8, borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5, resize: "vertical" }}
            />
            <button type="button" className="mx-btn-gold" onClick={() => void handleUpload()} style={{ marginTop: 10 }}>
              {busy === "upload" ? "上传中…" : "上传并绑定"}
            </button>
          </div>

          {/* 账号卡片 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {accounts.length === 0 ? (
              <div className="mx-card mx-empty" style={{ padding: 24, textAlign: "center" }}>
                <p style={{ fontSize: 12.5 }}>还没有绑定 Boss 账号，先上传登录态</p>
              </div>
            ) : (
              accounts.map((acc) => (
                <div key={acc.id} className="mx-card" style={{ padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{acc.name}</span>
                    <span className="mx-badge" style={{ fontSize: 10, padding: "2px 8px", color: acc.loginStatus === "logged_in" ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-amber)" }}>
                      {acc.loginStatus}
                    </span>
                  </div>
                  {candidates.length > 0 && (
                    <select
                      value={candidateId}
                      onChange={(e) => setCandidateId(e.target.value)}
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5, marginBottom: 8 }}
                    >
                      <option value="">选择候选人（可选）</option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.jobTitle ? ` · ${c.jobTitle}` : ""}</option>
                      ))}
                    </select>
                  )}
                  <input
                    value={candidateName}
                    onChange={(e) => setCandidateName(e.target.value)}
                    placeholder="候选人名称（如：张三）"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5, marginBottom: 8 }}
                  />
                  <input
                    value={helloMessage}
                    onChange={(e) => setHelloMessage(e.target.value)}
                    placeholder="打招呼语（可选）"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5, marginBottom: 8 }}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="mx-btn-gold" style={{ fontSize: 11.5, padding: "7px 12px" }} onClick={() => void handleCheckLogin(acc.id)}>
                      {busy === `check-${acc.id}` ? "检测中…" : "检测登录"}
                    </button>
                    <button type="button" style={{ fontSize: 11.5, padding: "7px 12px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)" }} onClick={() => void handleRefresh(acc.id)}>
                      {busy === `refresh-${acc.id}` ? "刷新中…" : "刷新职位"}
                    </button>
                    <button type="button" style={{ fontSize: 11.5, padding: "7px 12px", borderRadius: 10, background: "rgba(246,196,120,.12)", color: "var(--kaypal-v3-amber)", border: "1px solid rgba(222,150,57,.35)" }} onClick={() => void handleHello(acc.id)}>
                      {busy === `hello-${acc.id}` ? "打招呼中…" : "打招呼"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }
  return content;
}
