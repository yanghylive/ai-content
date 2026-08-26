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
  Tab,
  Tabs,
  Textarea,
  addToast,
} from "@heroui/react";
import {
  Camera,
  MessagesSquare,
  Plug,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  UsersRound,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { MobilePageShell } from "@/components/mobile-page-shell";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import {
  wecomCrmApi,
  type WecomCorpConfig,
  type WecomGroupMsgTask,
  type WecomMomentTask,
  type WecomMsgType,
} from "@/lib/api/wecom-crm";
import { toPublicError } from "@/lib/public-error";
import { SkeletonList } from "@/components/skeleton";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "default"> = {
  active: "success",
  disabled: "default",
  test_failed: "danger",
  creating: "warning",
  created: "warning",
  sending: "warning",
  sent: "success",
  partial_failed: "danger",
  failed: "danger",
  pending: "default",
};

export function WecomCrmCenter() {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <MobilePageShell title="企业微信 CRM" desc="客户群发 / 朋友圈 / 渠道配置">
        <Tabs aria-label="wecom-crm" variant="solid" color="primary" size="lg" fullWidth>
          <Tab key="config" title={<span>渠道配置</span>}><ConfigPanel /></Tab>
          <Tab key="group" title={<span>客户群发</span>}><GroupMsgPanel /></Tab>
          <Tab key="moments" title={<span>客户朋友圈</span>}><MomentPanel /></Tab>
        </Tabs>
      </MobilePageShell>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <WorkbenchCenter
        title="企业微信客户运营"
        subtitle="官方 API 通道：客户群发、客户朋友圈、外部联系人管理"
        icon={MessagesSquare}
        stats={[]}
      />
      <Tabs aria-label="wecom-crm" variant="solid" color="primary" size="lg">
        <Tab
          key="config"
          title={
            <div className="flex items-center gap-2">
              <Plug aria-hidden="true" size={18} />
              <span>渠道配置</span>
            </div>
          }
        >
          <ConfigPanel />
        </Tab>
        <Tab
          key="group"
          title={
            <div className="flex items-center gap-2">
              <Send aria-hidden="true" size={18} />
              <span>客户群发</span>
            </div>
          }
        >
          <GroupMsgPanel />
        </Tab>
        <Tab
          key="moments"
          title={
            <div className="flex items-center gap-2">
              <Camera aria-hidden="true" size={18} />
              <span>客户朋友圈</span>
            </div>
          }
        >
          <MomentPanel />
        </Tab>
      </Tabs>
    </div>
  );
}

// ============ 渠道配置 ============

function ConfigPanel() {
  const isMobile = useIsMobile();
  const [configs, setConfigs] = useState<WecomCorpConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    corpId: "",
    corpSecret: "",
    agentId: "",
    callbackToken: "",
    callbackEncodingAesKey: "",
  });

  const fetchState = useCallback(async () => {
    try {
      setLoading(true);
      const state = await wecomCrmApi.state();
      setConfigs(state.configs);
    } catch (error: unknown) {
      addToast({
        title: "加载企业微信配置失败",
        description: toPublicError(error, "加载失败"),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const setField = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!form.corpId) {
      addToast({ title: "请填写企业 ID（corpid）", color: "warning" });
      return;
    }
    try {
      await wecomCrmApi.saveConfig({
        name: form.name || undefined,
        corpId: form.corpId,
        corpSecret: form.corpSecret || undefined,
        agentId: form.agentId || undefined,
        callbackToken: form.callbackToken || undefined,
        callbackEncodingAesKey: form.callbackEncodingAesKey || undefined,
      });
      addToast({ title: "配置已保存", color: "success" });
      setForm((f) => ({ ...f, corpSecret: "", callbackToken: "", callbackEncodingAesKey: "" }));
      void fetchState();
    } catch (error: unknown) {
      addToast({
        title: "保存失败",
        description: toPublicError(error, "保存失败"),
        color: "danger",
      });
    }
  };

  const handleTest = async (configId: string) => {
    try {
      setTestingId(configId);
      const res = await wecomCrmApi.testConfig(configId);
      addToast({
        title: "连接成功",
        description: `token: ${res.tokenPrefix ?? ""}`,
        color: "success",
      });
      void fetchState();
    } catch (error: unknown) {
      addToast({
        title: "连接失败",
        description: toPublicError(error, "测试失败"),
        color: "danger",
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (configId: string) => {
    try {
      await wecomCrmApi.deleteConfig(configId);
      addToast({ title: "配置已删除", color: "success" });
      void fetchState();
    } catch (error: unknown) {
      addToast({
        title: "删除失败",
        description: toPublicError(error, "删除失败"),
        color: "danger",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {/* 移动表单：新增/更新企业配置 */}
        <div className="mx-card" style={{ padding: 14 }}>
          <div className="mx-row-title" style={{ marginBottom: 10, fontSize: 13.5, fontWeight: 700 }}>新增 / 更新企业配置</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input value={form.corpId} onChange={(e) => setField("corpId")(e.target.value)} placeholder="企业 ID（corpid）*" style={{ minHeight: 40, padding: "0 10px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13 }} />
            <input value={form.corpSecret} onChange={(e) => setField("corpSecret")(e.target.value)} placeholder="应用 Secret" style={{ minHeight: 40, padding: "0 10px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input value={form.name} onChange={(e) => setField("name")(e.target.value)} placeholder="配置名称" style={{ minHeight: 40, padding: "0 10px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13 }} />
              <input value={form.agentId} onChange={(e) => setField("agentId")(e.target.value)} placeholder="AgentId" style={{ minHeight: 40, padding: "0 10px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13 }} />
            </div>
            <button type="button" className="mx-btn-gold" onClick={() => void handleSave()} style={{ alignSelf: "flex-start" }}>保存配置</button>
          </div>
        </div>

        {/* 移动列表：已配置企业 */}
        <div className="mx-card mx-list-card">
          <div className="mx-row-title" style={{ padding: "12px 4px 6px", fontSize: 13.5, fontWeight: 700 }}>
            已配置企业（{configs.length}）
          </div>
          {configs.length === 0 ? (
            <div style={{ padding: "8px 4px", fontSize: 12, opacity: 0.6 }}>尚未配置企业微信，先填写 corpid 并保存</div>
          ) : (
            configs.map((c) => (
              <div key={c.id} className="mx-row" style={{ alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mx-row-title">{c.name || c.corpId}</div>
                  <div className="mx-row-desc">corpid: {c.corpId}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="mx-badge" style={{ fontSize: 10, padding: "4px 10px", color: "var(--kaypal-v3-success)" }} onClick={() => void handleTest(c.id)}>{testingId === c.id ? "测试中…" : "测试"}</button>
                  <button type="button" className="mx-badge" style={{ fontSize: 10, padding: "4px 10px", color: "var(--kaypal-v3-danger)" }} onClick={() => void handleDelete(c.id)}>删除</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-primary" />
          <span className="font-medium">新增 / 更新企业配置</span>
        </CardHeader>
        <Divider />
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="企业 ID（corpid）"
              placeholder="企业微信后台 → 我的企业 → 企业ID"
              value={form.corpId}
              onValueChange={setField("corpId")}
              isRequired
            />
            <Input
              label="应用 Secret"
              placeholder="应用管理 → 自建应用 → Secret"
              value={form.corpSecret}
              onValueChange={setField("corpSecret")}
              isClearable
            />
            <Input
              label="配置名称（可选）"
              placeholder="如：主企业 / 测试企业"
              value={form.name}
              onValueChange={setField("name")}
            />
            <Input
              label="应用 AgentId（可选）"
              placeholder="自建应用详情页"
              value={form.agentId}
              onValueChange={setField("agentId")}
            />
            <Input
              label="回调 Token（可选）"
              placeholder="接收消息服务器配置用"
              value={form.callbackToken}
              onValueChange={setField("callbackToken")}
            />
            <Input
              label="回调 EncodingAESKey（可选）"
              placeholder="接收消息服务器配置用"
              value={form.callbackEncodingAesKey}
              onValueChange={setField("callbackEncodingAesKey")}
            />
          </div>
          <div>
            <Button color="primary" onPress={handleSave}>
              保存配置
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="font-medium">已配置企业（{configs.length}）</span>
          <Button size="sm" variant="flat" startContent={<RefreshCw className="h-4 w-4" />} onPress={fetchState}>
            刷新
          </Button>
        </CardHeader>
        <Divider />
        <CardBody className="flex flex-col gap-3">
          {configs.length === 0 && (
            <p className="text-default-400 text-sm">
              尚未配置企业微信，先在上方填写 corpid 并保存。
            </p>
          )}
          {configs.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-2 rounded-xl border border-default-200 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <Chip
                    size="sm"
                    color={STATUS_TONE[c.status] ?? "default"}
                    variant="flat"
                  >
                    {c.status}
                  </Chip>
                  <Chip
                    size="sm"
                    color={c.callbackVerified ? "success" : "default"}
                    variant="flat"
                  >
                    回调{c.callbackVerified ? "已验证" : "未配置"}
                  </Chip>
                </div>
                <span className="text-sm text-default-500">
                  corpid: {c.corpId} · secret: {c.maskedSecret}
                  {c.agentId ? ` · agentId: ${c.agentId}` : ""}
                </span>
                {c.callbackUrl && (
                  <span className="text-xs text-default-400">
                    回调地址: {c.callbackUrl}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<Settings className="h-4 w-4" />}
                  isLoading={testingId === c.id}
                  onPress={() => handleTest(c.id)}
                >
                  测试连接
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  color="danger"
                  startContent={<Trash2 className="h-4 w-4" />}
                  onPress={() => handleDelete(c.id)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

// ============ 客户群发 ============

function GroupMsgPanel() {
  const isMobile = useIsMobile();
  const [configs, setConfigs] = useState<WecomCorpConfig[]>([]);
  const [tasks, setTasks] = useState<WecomGroupMsgTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [queryingId, setQueryingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    configId: "",
    msgType: "text" as WecomMsgType,
    text: "",
    mediaId: "",
    title: "",
    url: "",
    picUrl: "",
    desc: "",
    picMediaId: "",
    appid: "",
    page: "",
    externalUserIds: "",
    senderIds: "",
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [state, list] = await Promise.all([
        wecomCrmApi.state(),
        wecomCrmApi.listGroupMsgs(),
      ]);
      setConfigs(state.configs);
      setTasks(list);
      if (!form.configId && state.configs.length > 0) {
        setForm((f) => ({ ...f, configId: state.configs[0].id }));
      }
    } catch (error: unknown) {
      addToast({
        title: "加载失败",
        description: toPublicError(error, "加载失败"),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, [form.configId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const setField = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const buildContent = (): Record<string, unknown> => {
    switch (form.msgType) {
      case "text":
        return { content: form.text };
      case "image":
        return { mediaId: form.mediaId };
      case "link":
        return {
          title: form.title,
          url: form.url,
          picUrl: form.picUrl,
          desc: form.desc,
        };
      case "miniprogram":
        return {
          title: form.title,
          picMediaId: form.picMediaId,
          appid: form.appid,
          page: form.page,
        };
    }
  };

  const splitIds = (raw: string) =>
    raw
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleCreate = async () => {
    const externalUserIds = splitIds(form.externalUserIds);
    const senderIds = splitIds(form.senderIds);
    if (!form.configId) {
      addToast({ title: "请先选择企业配置", color: "warning" });
      return;
    }
    if (externalUserIds.length === 0) {
      addToast({ title: "请填写目标客户 external_userid（逗号分隔）", color: "warning" });
      return;
    }
    if (senderIds.length === 0) {
      addToast({ title: "请填写发送成员 userid（逗号分隔）", color: "warning" });
      return;
    }
    try {
      setCreating(true);
      await wecomCrmApi.createGroupMsg({
        configId: form.configId,
        msgType: form.msgType,
        content: buildContent(),
        externalUserIds,
        senderIds,
      });
      addToast({ title: "群发任务已创建", color: "success" });
      setForm((f) => ({
        ...f,
        text: "",
        mediaId: "",
        title: "",
        url: "",
        picUrl: "",
        desc: "",
        picMediaId: "",
        appid: "",
        page: "",
        externalUserIds: "",
        senderIds: "",
      }));
      void fetchData();
    } catch (error: unknown) {
      addToast({
        title: "创建失败",
        description: toPublicError(error, "创建失败"),
        color: "danger",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleQuery = async (taskId: string) => {
    try {
      setQueryingId(taskId);
      const res = await wecomCrmApi.queryGroupMsgResult(taskId);
      addToast({
        title: `群发状态：${res.status}`,
        description: `发送 ${res.sendCount} 条 / 失败 ${res.failCount} 条`,
        color: res.failCount > 0 ? "warning" : "success",
      });
      void fetchData();
    } catch (error: unknown) {
      addToast({
        title: "查询失败",
        description: toPublicError(error, "查询失败"),
        color: "danger",
      });
    } finally {
      setQueryingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {/* 移动端快捷创建：文本群发 */}
        <div className="mx-card" style={{ padding: 14 }}>
          <div className="mx-row-title" style={{ marginBottom: 8, fontSize: 13.5, fontWeight: 700 }}>快捷群发（文本）</div>
          <textarea
            value={form.text}
            onChange={(e) => setField("text")(e.target.value)}
            placeholder="输入要群发的内容"
            rows={3}
            style={{ width: "100%", minHeight: 72, padding: 8, borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13, resize: "vertical" }}
          />
          <button type="button" className="mx-btn-gold" onClick={() => void handleCreate()} style={{ marginTop: 10 }}>
            {creating ? "创建中…" : "创建群发任务"}
          </button>
          <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 8 }}>每客户每月最多接收 4 条群发</div>
        </div>

        {/* 任务列表 */}
        <div className="mx-card mx-list-card">
          <div className="mx-row-title" style={{ padding: "12px 4px 6px", fontSize: 13.5, fontWeight: 700 }}>群发任务（{tasks.length}）</div>
          {tasks.length === 0 ? (
            <div style={{ padding: "8px 4px", fontSize: 12, opacity: 0.6 }}>还没有群发任务</div>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="mx-row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mx-row-title" style={{ whiteSpace: "normal" }}>
                    {t.msgType === "text" ? String((t.content as Record<string, unknown> | null)?.content ?? "文本群发") : `[${t.msgType}] 群发任务`}
                  </div>
                  <div className="mx-row-desc" style={{ marginTop: 3 }}>
                    状态：{t.status}
                    {t.errorMessage ? ` · ${t.errorMessage}` : ""}
                  </div>
                </div>
                <button type="button" className="mx-badge" style={{ fontSize: 10, padding: "4px 10px", color: "var(--kaypal-v3-success)", flexShrink: 0 }} onClick={() => void handleQuery(t.id)}>
                  {queryingId === t.id ? "查询中…" : "查结果"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex items-center gap-2">
          <Send className="h-5 w-5 text-primary" />
          <span className="font-medium">创建客户群发任务</span>
          <span className="ml-auto text-xs text-default-400">
            每客户每月最多接收 4 条群发
          </span>
        </CardHeader>
        <Divider />
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select
              label="企业配置"
              selectedKeys={form.configId ? [form.configId] : []}
              onSelectionChange={(keys) =>
                setField("configId")(Array.from(keys)[0] as string)
              }
              placeholder={configs.length === 0 ? "请先配置企业微信" : "选择企业"}
            >
              {configs.map((c) => (
                <SelectItem key={c.id}>{`${c.name}（${c.corpId}）`}</SelectItem>
              ))}
            </Select>
            <Select
              label="消息类型"
              selectedKeys={[form.msgType]}
              onSelectionChange={(keys) =>
                setField("msgType")(Array.from(keys)[0] as string)
              }
            >
              <SelectItem key="text">文本</SelectItem>
              <SelectItem key="image">图片</SelectItem>
              <SelectItem key="link">链接</SelectItem>
              <SelectItem key="miniprogram">小程序</SelectItem>
            </Select>
          </div>

          {form.msgType === "text" && (
            <Textarea
              label="文本内容"
              placeholder="群发文案"
              value={form.text}
              onValueChange={setField("text")}
            />
          )}
          {form.msgType === "image" && (
            <Input
              label="图片 media_id"
              placeholder="需先上传素材到企业微信获取 media_id"
              value={form.mediaId}
              onValueChange={setField("mediaId")}
            />
          )}
          {form.msgType === "link" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input label="链接标题" value={form.title} onValueChange={setField("title")} />
              <Input label="链接 URL" value={form.url} onValueChange={setField("url")} />
              <Input label="封面 picUrl" value={form.picUrl} onValueChange={setField("picUrl")} />
              <Input label="描述" value={form.desc} onValueChange={setField("desc")} />
            </div>
          )}
          {form.msgType === "miniprogram" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input label="小程序标题" value={form.title} onValueChange={setField("title")} />
              <Input label="封面 pic_media_id" value={form.picMediaId} onValueChange={setField("picMediaId")} />
              <Input label="appid" value={form.appid} onValueChange={setField("appid")} />
              <Input label="页面 page" value={form.page} onValueChange={setField("page")} />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Textarea
              label="目标客户 external_userid"
              placeholder="逗号分隔，最多 500 个；可在「外部联系人」接口拉取"
              value={form.externalUserIds}
              onValueChange={setField("externalUserIds")}
            />
            <Textarea
              label="发送成员 userid"
              placeholder="逗号分隔，如 zhangsan,lisi"
              value={form.senderIds}
              onValueChange={setField("senderIds")}
            />
          </div>
          <div>
            <Button color="primary" startContent={<Send className="h-4 w-4" />} isLoading={creating} onPress={handleCreate}>
              创建群发任务
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="font-medium">群发任务（{tasks.length}）</span>
          <Button size="sm" variant="flat" startContent={<RefreshCw className="h-4 w-4" />} onPress={fetchData}>
            刷新
          </Button>
        </CardHeader>
        <Divider />
        <CardBody className="flex flex-col gap-2">
          {tasks.length === 0 && (
            <p className="text-default-400 text-sm">暂无群发任务。</p>
          )}
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-2 rounded-xl border border-default-200 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Chip size="sm" color={STATUS_TONE[t.status] ?? "default"} variant="flat">
                    {t.status}
                  </Chip>
                  <Chip size="sm" variant="flat">{t.msgType}</Chip>
                  <span className="text-xs text-default-400">
                    {new Date(t.createdAt).toLocaleString("zh-CN")}
                  </span>
                </div>
                <span className="text-sm text-default-500">
                  目标 {t.externalUserIds.length} 客户 / 发送成员 {t.senderIds.length}
                  {t.wecomMsgId ? ` · msgid: ${t.wecomMsgId}` : ""}
                </span>
                {t.errorMessage && (
                  <span className="text-xs text-danger">{t.errorMessage}</span>
                )}
              </div>
              <Button
                size="sm"
                variant="flat"
                startContent={<RefreshCw className="h-4 w-4" />}
                isLoading={queryingId === t.id}
                isDisabled={!t.wecomMsgId}
                onPress={() => handleQuery(t.id)}
              >
                查询结果
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

// ============ 客户朋友圈 ============

function MomentPanel() {
  const isMobile = useIsMobile();
  const [configs, setConfigs] = useState<WecomCorpConfig[]>([]);
  const [tasks, setTasks] = useState<WecomMomentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [queryingId, setQueryingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    configId: "",
    text: "",
    attachmentType: "image" as "image" | "video" | "link",
    mediaId: "",
    title: "",
    url: "",
    picUrl: "",
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [state, list] = await Promise.all([
        wecomCrmApi.state(),
        wecomCrmApi.listMoments(),
      ]);
      setConfigs(state.configs);
      setTasks(list);
      if (!form.configId && state.configs.length > 0) {
        setForm((f) => ({ ...f, configId: state.configs[0].id }));
      }
    } catch (error: unknown) {
      addToast({
        title: "加载失败",
        description: toPublicError(error, "加载失败"),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, [form.configId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const setField = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleCreate = async () => {
    if (!form.configId) {
      addToast({ title: "请先选择企业配置", color: "warning" });
      return;
    }
    if (!form.text && !form.mediaId) {
      addToast({ title: "朋友圈需要文案或附件", color: "warning" });
      return;
    }
    const attachments: Array<Record<string, unknown>> = [];
    if (form.mediaId) {
      if (form.attachmentType === "link") {
        attachments.push({
          type: "link",
          title: form.title,
          url: form.url,
          picUrl: form.picUrl,
        });
      } else {
        attachments.push({ type: form.attachmentType, mediaId: form.mediaId });
      }
    }
    try {
      setCreating(true);
      await wecomCrmApi.createMoment({
        configId: form.configId,
        text: form.text || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      addToast({ title: "朋友圈任务已创建", color: "success" });
      setForm((f) => ({ ...f, text: "", mediaId: "", title: "", url: "", picUrl: "" }));
      void fetchData();
    } catch (error: unknown) {
      addToast({
        title: "创建失败",
        description: toPublicError(error, "创建失败"),
        color: "danger",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleQuery = async (taskId: string) => {
    try {
      setQueryingId(taskId);
      const res = await wecomCrmApi.queryMomentResult(taskId);
      addToast({
        title: `朋友圈状态：${res.status}`,
        description: JSON.stringify(res.result).slice(0, 120),
        color: "success",
      });
      void fetchData();
    } catch (error: unknown) {
      addToast({
        title: "查询失败",
        description: toPublicError(error, "查询失败"),
        color: "danger",
      });
    } finally {
      setQueryingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        <div className="mx-card" style={{ padding: 14 }}>
          <div className="mx-row-title" style={{ marginBottom: 8, fontSize: 13.5, fontWeight: 700 }}>创建朋友圈任务</div>
          <textarea
            value={form.text}
            onChange={(e) => setField("text")(e.target.value)}
            placeholder="朋友圈内容"
            rows={3}
            style={{ width: "100%", minHeight: 72, padding: 8, borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13, resize: "vertical" }}
          />
          <button type="button" className="mx-btn-gold" onClick={() => void handleCreate()} style={{ marginTop: 10 }}>
            {creating ? "创建中…" : "创建朋友圈任务"}
          </button>
          <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 8 }}>需企业认证 + 后台开通「客户朋友圈」</div>
        </div>
        <div className="mx-card mx-list-card">
          <div className="mx-row-title" style={{ padding: "12px 4px 6px", fontSize: 13.5, fontWeight: 700 }}>朋友圈任务（{tasks.length}）</div>
          {tasks.length === 0 ? (
            <div style={{ padding: "8px 4px", fontSize: 12, opacity: 0.6 }}>还没有朋友圈任务</div>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="mx-row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mx-row-title" style={{ whiteSpace: "normal" }}>{t.text || "朋友圈任务"}</div>
                  <div className="mx-row-desc" style={{ marginTop: 3 }}>
                    状态：{t.status}
                    {t.errorMessage ? ` · ${t.errorMessage}` : ""}
                  </div>
                </div>
                <button type="button" className="mx-badge" style={{ fontSize: 10, padding: "4px 10px", color: "var(--kaypal-v3-success)", flexShrink: 0 }} onClick={() => void handleQuery(t.id)}>
                  {queryingId === t.id ? "查询中…" : "查结果"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          <span className="font-medium">创建客户朋友圈任务</span>
          <span className="ml-auto text-xs text-default-400">
            需企业认证 + 后台开通「客户朋友圈」
          </span>
        </CardHeader>
        <Divider />
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select
              label="企业配置"
              selectedKeys={form.configId ? [form.configId] : []}
              onSelectionChange={(keys) =>
                setField("configId")(Array.from(keys)[0] as string)
              }
              placeholder={configs.length === 0 ? "请先配置企业微信" : "选择企业"}
            >
              {configs.map((c) => (
                <SelectItem key={c.id}>{`${c.name}（${c.corpId}）`}</SelectItem>
              ))}
            </Select>
            <Select
              label="附件类型（选填）"
              selectedKeys={[form.attachmentType]}
              onSelectionChange={(keys) =>
                setField("attachmentType")(Array.from(keys)[0] as string)
              }
            >
              <SelectItem key="image">图片</SelectItem>
              <SelectItem key="video">视频</SelectItem>
              <SelectItem key="link">链接</SelectItem>
            </Select>
          </div>
          <Textarea
            label="朋友圈文案"
            placeholder="发表的文字内容"
            value={form.text}
            onValueChange={setField("text")}
          />
          {form.attachmentType === "link" ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input label="链接标题" value={form.title} onValueChange={setField("title")} />
              <Input label="链接 URL" value={form.url} onValueChange={setField("url")} />
              <Input label="封面 picUrl" value={form.picUrl} onValueChange={setField("picUrl")} />
            </div>
          ) : (
            <Input
              label={`${form.attachmentType === "image" ? "图片" : "视频"} media_id`}
              placeholder="需先上传素材到企业微信获取 media_id"
              value={form.mediaId}
              onValueChange={setField("mediaId")}
            />
          )}
          <div>
            <Button color="primary" startContent={<Camera className="h-4 w-4" />} isLoading={creating} onPress={handleCreate}>
              创建朋友圈任务
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="font-medium">朋友圈任务（{tasks.length}）</span>
          <Button size="sm" variant="flat" startContent={<RefreshCw className="h-4 w-4" />} onPress={fetchData}>
            刷新
          </Button>
        </CardHeader>
        <Divider />
        <CardBody className="flex flex-col gap-2">
          {tasks.length === 0 && (
            <p className="text-default-400 text-sm">暂无朋友圈任务。</p>
          )}
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-2 rounded-xl border border-default-200 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Chip size="sm" color={STATUS_TONE[t.status] ?? "default"} variant="flat">
                    {t.status}
                  </Chip>
                  <span className="text-xs text-default-400">
                    {new Date(t.createdAt).toLocaleString("zh-CN")}
                  </span>
                </div>
                <span className="text-sm text-default-500">
                  {t.text ? `「${t.text.slice(0, 40)}${t.text.length > 40 ? "…" : ""}」` : "（无文案）"}
                  {t.attachments && t.attachments.length > 0
                    ? ` · ${t.attachments.length} 个附件`
                    : ""}
                  {t.wecomJobId ? ` · jobid: ${t.wecomJobId}` : ""}
                </span>
                {t.errorMessage && (
                  <span className="text-xs text-danger">{t.errorMessage}</span>
                )}
              </div>
              <Button
                size="sm"
                variant="flat"
                startContent={<UsersRound className="h-4 w-4" />}
                isLoading={queryingId === t.id}
                isDisabled={!t.wecomJobId}
                onPress={() => handleQuery(t.id)}
              >
                查询结果
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
