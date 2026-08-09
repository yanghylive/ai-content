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
  Spinner,
  Textarea,
  addToast,
} from "@heroui/react";
import { BriefcaseBusiness, MessageCircle, RefreshCw, Upload, UserRound } from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
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

export function BossRecruitCenter() {
  const [state, setState] = useState<BossRecruitState | null>(null);
  const [tasks, setTasks] = useState<BossTask[]>([]);
  const [candidates, setCandidates] = useState<BossCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  const [storageJson, setStorageJson] = useState("");
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
    if (!candidateName.trim()) {
      addToast({ title: "请填写候选人名称", color: "warning" });
      return;
    }
    try {
      setBusy(`hello-${accountId}`);
      const res = await bossRecruitApi.sendHello(
        accountId,
        candidateName.trim(),
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

  return (
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
          <span className="font-medium">上传 Boss 登录态（storageState）</span>
        </CardHeader>
        <Divider />
        <CardBody className="flex flex-col gap-3">
          <Textarea
            label="storageState JSON"
            placeholder='从已登录 Boss 直聘的浏览器导出（DevTools → Application → 导出 storageState）'
            value={storageJson}
            onValueChange={setStorageJson}
            minRows={4}
          />
          <div>
            <Button color="primary" startContent={<Upload className="h-4 w-4" />} isLoading={busy === "upload"} onPress={handleUpload}>
              上传并绑定
            </Button>
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                label="候选人名称"
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
}
