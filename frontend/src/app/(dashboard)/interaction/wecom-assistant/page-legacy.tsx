"use client";

import React, { useEffect, useMemo, useState } from "react";
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
    Switch,
    Textarea,
    addToast,
} from "@heroui/react";
import {
    AlertTriangle,
    Bot,
    CheckCircle2,
    ClipboardCheck,
    MessageSquareText,
    PauseCircle,
    PlayCircle,
    PlugZap,
    RefreshCcw,
    Send,
    Settings2,
    ShieldCheck,
    Store,
    Trash2,
    WandSparkles,
} from "lucide-react";
import { RiskConfirmationDialog } from "@/components/risk-confirmation-dialog";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import {
    createDefaultWecomAssistantState,
    deleteWecomAssistant,
    generateAutoReplySuggestion,
    getWecomAssistantState,
    installWecomAssistant,
    replyStyleOptions,
    retestWecomAssistant,
    sendAutoReplySuggestion,
    setWecomAssistantEnabled,
    testWecomWebhook,
    updateWecomAssistantSettings,
    validateWecomWebhookUrl,
    type AutoReplySuggestion,
    type WecomAssistantSettings,
    type WecomAssistantState,
    type WecomAssistantStatus,
    type WecomMessageRecord,
    type WecomRiskLevel,
} from "@/lib/api/wecom-ai-assistant";

type StepKey = "connect" | "settings" | "done";

const statusMeta: Record<WecomAssistantStatus, { label: string; color: "default" | "success" | "warning" | "danger" }> = {
    not_installed: { label: "未安装", color: "default" },
    active: { label: "已连接", color: "success" },
    test_failed: { label: "测试失败", color: "danger" },
    disabled: { label: "已暂停", color: "warning" },
};

const riskMeta: Record<WecomRiskLevel, { label: string; color: "success" | "warning" | "danger" }> = {
    low: { label: "低", color: "success" },
    medium: { label: "中", color: "warning" },
    high: { label: "高", color: "danger" },
};

function formatDate(value?: string | null) {
    if (!value) return "尚未测试";
    try {
        return new Intl.DateTimeFormat("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(value));
    } catch {
        return value;
    }
}

function StatusChip({ status }: { status: WecomAssistantStatus }) {
    const meta = statusMeta[status];
    return (
        <Chip color={meta.color} variant="flat" size="sm">{meta.label}</Chip> ); } function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) { return ( <div className="rounded-[8px] border border-default-200 bg-content1 px-4 py-3"> <p className="text-tiny text-default-500">{label}</p><div className="mt-1 text-sm font-medium text-[var(--kaypal-v3-ink)]">{value}</div> </div> ); } function StepPill({ active, done, children }: { active?: boolean; done?: boolean; children: React.ReactNode }) { return ( <div className={"flex items-center gap-2 rounded-full px-3 py-1.5 text-xs " + (active ? "bg-primary text-primary-foreground" : done ? "bg-success/15 text-success" : "bg-default-100 text-default-500")}>{done ? <CheckCircle2 size={14} /> : null} {children}</div> ); } function SuggestionPreview({ suggestion }: { suggestion: AutoReplySuggestion }) { const meta = riskMeta[suggestion.riskLevel]; return ( <Card className="border border-default-200 bg-content1 shadow-none"> <CardBody className="gap-3 text-sm"> <div className="flex flex-wrap items-center gap-2">
                    <Chip color={meta.color} variant="flat" size="sm">风险：{meta.label}</Chip><Chip color={suggestion.shouldTransfer ? "danger" : "success"} variant="flat" size="sm">{suggestion.shouldTransfer ? "建议转人工" : "可由客服确认后回复"}</Chip> </div><div> <p className="text-tiny text-default-500">客户消息</p><p className="mt-1 rounded-[8px] bg-default-100 px-3 py-2">{suggestion.customerMessage}</p> </div><div> <p className="text-tiny text-default-500">建议回复</p><p className="mt-1 rounded-[8px] bg-primary/10 px-3 py-2 text-[var(--kaypal-v3-ink)]">{suggestion.suggestedReply}</p> </div>{suggestion.transferReason ? ( <p className="text-danger text-xs">{suggestion.transferReason}</p> ) : null}<p className="text-default-600">处理建议：{suggestion.action}</p>
            </CardBody>
        </Card>
    );
}

function MessageRecordCard({ record }: { record: WecomMessageRecord }) {
    const color = record.status === "sent" ? "success" : record.status === "failed" ? "danger" : "warning"; return ( <div className="rounded-[8px] border border-default-200 bg-content1 p-4"> <div className="flex flex-wrap items-center justify-between gap-2"> <div className="flex items-center gap-2"> <MessageSquareText size={16} className="text-primary"/> <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">{record.title}</span> </div><div className="flex items-center gap-2">
                    <Chip color={color} size="sm" variant="flat">{record.status === "sent" ? "已发送" : record.status === "failed" ? "失败" : "发送中"}</Chip><span className="text-xs text-default-400">{formatDate(record.createdAt)}</span> </div> </div><pre className="mt-3 whitespace-pre-wrap rounded-[8px] bg-default-100 px-3 py-2 text-xs leading-5 text-default-700">{record.content}</pre>
        </div>
    );
}

export default function WecomAssistantPage() {
    const [state, setState] = useState<WecomAssistantState>(() => createDefaultWecomAssistantState());
    const [isMounted, setIsMounted] = useState(false);
    const [step, setStep] = useState<StepKey>("connect");
    const [connectionName, setConnectionName] = useState("门店客服群");
    const [webhookUrl, setWebhookUrl] = useState("");
    const [settings, setSettings] = useState<WecomAssistantSettings>(() => createDefaultWecomAssistantState().settings);
    const [isTesting, setIsTesting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [testPassed, setTestPassed] = useState(false);
    const [demoMessage, setDemoMessage] = useState("你们今天下午可以预约吗？");
    const [demoSuggestion, setDemoSuggestion] = useState<AutoReplySuggestion | null>(null);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() =>{
        let cancelled = false;
        getWecomAssistantState()
            .then((loaded) =>{
                if (cancelled) return;
                const saved = createDefaultWecomAssistantState();
                setState(loaded);
                setSettings(loaded.settings || saved.settings);
                if (loaded.integration) {
                    setConnectionName(loaded.integration.name);
                    setStep("done");
                    setTestPassed(true);
                }
            })
            .catch((error) =>{
                if (cancelled) return;
                addToast({ title: "加载企微助手失败", description: toPublicError(error, "企业微信助手暂时无法加载，请重新加载。"), color: "danger" });
                const saved = createDefaultWecomAssistantState();
                setState(saved);
                setSettings(saved.settings);
            })
            .finally(() =>{
                if (!cancelled) setIsMounted(true);
            });
        return () =>{
            cancelled = true;
        };
    }, []);

    const isInstalled = Boolean(state.integration);
    const canTest = useMemo(() => validateWecomWebhookUrl(webhookUrl), [webhookUrl]);
    const previewSuggestion = useMemo(() =>{
        if (!demoMessage.trim()) return null;
        return generateAutoReplySuggestion({ customerMessage: demoMessage, settings });
    }, [demoMessage, settings]);

    const updateSettings = (patch: Partial<WecomAssistantSettings>) =>{
        setSettings((current) => ({
            ...current,
            ...patch,
            autoSendToCustomer: false,
        }));
    };

    const handleTest = async () =>{
        setIsTesting(true);
        try {
            await testWecomWebhook(webhookUrl);
            setTestPassed(true);
            addToast({ title: "测试成功", description: "请确认企业微信群已收到测试消息。", color: "success" });
        } catch (error) {
            setTestPassed(false);
            addToast({ title: "测试失败", description: toPublicError(error, "企业微信连接测试未完成，请检查地址后重试。"), color: "danger" });
        } finally {
            setIsTesting(false);
        }
    };

    const handleInstall = async () =>{
        setIsSaving(true);
        try {
            const nextState = await installWecomAssistant({
                name: connectionName,
                webhookUrl,
                settings,
            });
            setState(nextState);
            setSettings(nextState.settings);
            setStep("done");
            setTestPassed(true);
            addToast({ title: "安装成功", description: "企业微信 AI 客服助手已启用。", color: "success" });
        } catch (error) {
            addToast({ title: "安装失败", description: toPublicError(error, "企业微信助手未安装，请检查连接设置后重试。"), color: "danger" });
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveSettings = async () =>{
        try {
            const nextState = await updateWecomAssistantSettings(settings);
            setState(nextState);
            setSettings(nextState.settings);
            addToast({ title: "设置已保存", color: "success" });
        } catch (error) {
            addToast({ title: "保存失败", description: toPublicError(error, "企业微信助手设置未保存，请重试。"), color: "danger" });
        }
    };

    const handleRetest = async () =>{
        setIsTesting(true);
        try {
            const nextState = await retestWecomAssistant();
            setState(nextState);
            addToast({ title: "重新测试成功", color: "success" });
        } catch (error) {
            addToast({ title: "重新测试失败", description: toPublicError(error, "企业微信连接复测未完成，请重试。"), color: "danger" });
        } finally {
            setIsTesting(false);
        }
    };

    const handleToggleEnabled = async (enabled: boolean) =>{
        try {
            const nextState = await setWecomAssistantEnabled(enabled);
            setState(nextState);
            setSettings(nextState.settings);
            addToast({ title: enabled ? "已恢复发送" : "已暂停发送", color: enabled ? "success" : "warning" });
        } catch (error) {
            addToast({ title: "状态更新失败", description: toPublicError(error, "发送状态未更新，请重试。"), color: "danger" });
        }
    };

    const handleDelete = () =>{
        setDeleteOpen(true);
    };

    const confirmDelete = async () =>{
        setIsDeleting(true);
        try {
            const nextState = await deleteWecomAssistant();
            setState(nextState);
            setSettings(nextState.settings);
            setConnectionName("门店客服群");
            setWebhookUrl("");
            setStep("connect");
            setTestPassed(false);
            setDeleteOpen(false);
            addToast({ title: "连接已删除", color: "success" });
        } catch (error) {
            addToast({ title: "删除失败", description: toPublicError(error, "企业微信连接未删除，请重试。"), color: "danger" });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleSendDemo = async () =>{
        try {
            const result = await sendAutoReplySuggestion(demoMessage);
            setState(result.state);
            setDemoSuggestion(result.suggestion);
            addToast({ title: "测试建议已发送", description: "消息已发送到企业微信群并写入发送记录。", color: "success" });
        } catch (error) {
            addToast({ title: "发送失败", description: toPublicError(error, "测试建议未发送，请检查连接后重试。"), color: "danger"}); } }; if (!isMounted) return null; return ( <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 pb-10"> <header className="rounded-[8px] border border-default-200 bg-content1 p-5 shadow-sm "> <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"> <div className="max-w-3xl"> <div className="mb-3 flex flex-wrap items-center gap-2">
                            <Chip color="primary" variant="flat"startContent={<PlugZap size={14} />}>企业微信连接</Chip><StatusChip status={state.status} /> </div><h1 className="text-[26px] font-bold leading-9 text-[var(--kaypal-v3-ink)]">企业微信 AI 客服助手</h1><p className="mt-2 text-sm leading-6 text-default-500"> 把客户咨询提醒、AI 回复建议、售后风险提醒发送到企业微信群，帮助门店客服更快响应客户。 AI 只生成建议，不会直接替你回复客户。 </p> </div><div className="flex flex-wrap gap-2">{isInstalled ? (
                            <>
                                <Button variant="flat" startContent={<RefreshCcw size={16} />} isLoading={isTesting} onClick={handleRetest}>
                                    重新测试
                                </Button><Button
                                    color={state.status === "active" ? "warning" : "success"}
                                    variant="flat"
                                    startContent={state.status === "active" ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                                    onClick={() => handleToggleEnabled(state.status !== "active")}
                                >{state.status === "active" ? "暂停" : "恢复"}</Button> </> ) : null}</div> </div> </header><div className="grid gap-4 md:grid-cols-3">
                <SummaryItem label="适用场景" value="门店客服群 / 售后群 / 预约咨询群" />
                <SummaryItem label="当前能力" value="生成 AI 回复建议并推送到企业微信群" />
                <SummaryItem label="安全边界" value="不直接读取客户微信，不自动替客户发送"/> </div>{!isInstalled ? ( <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]"> <Card className="border border-default-200 shadow-sm"> <CardHeader className="flex-col items-start gap-3"> <div className="flex flex-wrap gap-2">
                                <StepPill active={step === "connect"} done={testPassed}>1. 连接企业微信</StepPill><StepPill active={step === "settings"}>2. 设置客服规则</StepPill><StepPill active={step === "done"}>3. 完成安装</StepPill> </div><div> <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">安装企业微信连接</h2><p className="mt-1 text-sm text-default-500">用户在应用内粘贴企业微信群机器人地址，系统测试成功后即可启用。</p> </div> </CardHeader><Divider /> <CardBody className="gap-5">{step === "connect"? ( <> <div className="rounded-[8px] border border-primary/20 bg-primary/5 p-4"> <div className="flex items-center gap-2 text-sm font-semibold text-primary"> <ShieldCheck size={16} /> 安全模式说明 </div><p className="mt-2 text-sm leading-6 text-default-600">
                                            第一版不会直接替你回复客户，只会把 AI 建议发送到企业微信群，由员工确认后回复客户。
                                        </p>
                                    </div><Input
                                        label="连接名称"
                                        placeholder="例如：上海静安店客服群"
                                        value={connectionName}
                                        onValueChange={setConnectionName}
                                    />
                                    <Input
                                        label="企业微信机器人地址"
                                        placeholder="粘贴企业微信群机器人地址"
                                        value={webhookUrl}
                                        isInvalid={Boolean(webhookUrl) && !canTest}
                                        errorMessage="请输入有效的企业微信机器人地址"onValueChange={(value) =>{ setWebhookUrl(value); setTestPassed(false); }} /> <div className="flex flex-wrap gap-3">
                                        <Button variant="flat" startContent={<Send size={16} />} isDisabled={!canTest} isLoading={isTesting} onClick={handleTest}>
                                            发送测试消息
                                        </Button><Button color="primary" isDisabled={!testPassed} onClick={() => setStep("settings")}>
                                            下一步：设置客服规则
                                        </Button>
                                    </div>
                                </>
                            ) : null}

                            {step === "settings"? ( <> <div className="grid gap-4 md:grid-cols-2">
                                        <Input label="品牌名称" value={settings.brandName} onValueChange={(value) => updateSettings({ brandName: value })} />
                                        <Input label="门店名称" value={settings.storeName} onValueChange={(value) => updateSettings({ storeName: value })} />
                                    </div><Select
                                        label="回复风格"
                                        selectedKeys={[settings.replyStyle]}
                                        onChange={(event) => updateSettings({ replyStyle: event.target.value })}
                                    >{replyStyleOptions.map((item) => (
                                            <SelectItem key={item.key}>{item.label}</SelectItem>
                                        ))}</Select><Textarea
                                        label="转人工关键词"minRows={4} value={settings.transferKeywords} onValueChange={(value) => updateSettings({ transferKeywords: value })} /> <div className="flex flex-col gap-3 rounded-[8px] border border-default-200 p-4"> <Switch isSelected={settings.sendToWecom} onValueChange={(value) => updateSettings({ sendToWecom: value })}> 发送 AI 回复建议到企业微信群 </Switch><Switch isSelected={false} isDisabled> 自动回复客户（暂未开放） </Switch> </div><div className="flex flex-wrap gap-3">
                                        <Button variant="flat" onClick={() => setStep("connect")}>返回</Button><Button color="primary"isLoading={isSaving} onClick={handleInstall}>保存并启用</Button> </div> </> ) : null}</CardBody> </Card><Card className="border border-default-200 shadow-sm"> <CardHeader className="flex-col items-start gap-1"> <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">用户安装指引</h2><p className="text-sm text-default-500">给最终用户看的配置说明。</p> </CardHeader><Divider /> <CardBody className="gap-4 text-sm leading-6 text-default-600"> <div className="rounded-[8px] bg-default-100 p-4"> <p>1. 打开企业微信目标群</p><p>2. 点击右上角「群设置」</p><p>3. 找到「群机器人」</p><p>4. 添加机器人</p><p>5. 复制机器人地址并粘贴到应用中</p> </div><div className="rounded-[8px] border border-warning/20 bg-warning/10 p-4 text-warning-700"> 企业微信连接地址相当于发送权限。系统需要加密保存，页面只展示脱敏地址。 </div> </CardBody> </Card> </div> ) : ( <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]"> <Card className="border border-default-200 shadow-sm"> <CardHeader className="flex-col items-start gap-1"> <div className="flex items-center gap-2"> <Store size={18} className="text-primary"/> <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">连接与规则管理</h2> </div><p className="text-sm text-default-500">管理企业微信群连接、回复风格和转人工边界。</p> </CardHeader><Divider /> <CardBody className="gap-5"> <div className="grid gap-3 sm:grid-cols-2">
                                <SummaryItem label="连接名称" value={state.integration?.name || "-"} />
                                <SummaryItem label="连接状态" value={<StatusChip status={state.status} />} />
                                <SummaryItem label="连接地址" value={commercialDisplayText(state.integration?.maskedWebhookUrl || "-")} />
                                <SummaryItem label="最近测试"value={formatDate(state.integration?.lastTestedAt)} /> </div><Divider /> <div className="grid gap-4 md:grid-cols-2">
                                <Input label="品牌名称" value={settings.brandName} onValueChange={(value) => updateSettings({ brandName: value })} />
                                <Input label="门店名称" value={settings.storeName} onValueChange={(value) => updateSettings({ storeName: value })} />
                            </div><Select
                                label="回复风格"
                                selectedKeys={[settings.replyStyle]}
                                onChange={(event) => updateSettings({ replyStyle: event.target.value })}
                            >{replyStyleOptions.map((item) => (
                                    <SelectItem key={item.key}>{item.label}</SelectItem>
                                ))}</Select><Textarea
                                label="转人工关键词"minRows={4} value={settings.transferKeywords} onValueChange={(value) => updateSettings({ transferKeywords: value })} /> <div className="flex flex-col gap-3 rounded-[8px] border border-default-200 p-4"> <Switch isSelected={settings.sendToWecom} onValueChange={(value) => updateSettings({ sendToWecom: value })}> 发送 AI 回复建议到企业微信群 </Switch><Switch isSelected={false} isDisabled> 自动回复客户（暂未开放） </Switch> </div><div className="flex flex-wrap gap-3">
                                <Button color="primary" startContent={<Settings2 size={16} />} onClick={handleSaveSettings}>保存设置</Button><Button variant="flat" startContent={<RefreshCcw size={16} />} isLoading={isTesting} onClick={handleRetest}>重新测试</Button><Button color="danger" variant="flat"startContent={<Trash2 size={16} />} onClick={handleDelete}>删除连接</Button> </div> </CardBody> </Card><div className="flex flex-col gap-4"> <Card className="border border-default-200 shadow-sm"> <CardHeader className="flex-col items-start gap-1"> <div className="flex items-center gap-2"> <WandSparkles size={18} className="text-primary"/> <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">AI 回复建议</h2> </div><p className="text-sm text-default-500">读取客户消息，生成建议并写入企业微信发送记录。</p> </CardHeader><Divider /> <CardBody className="gap-4">
                                <Textarea
                                    label="客户消息"minRows={3} value={demoMessage} onValueChange={setDemoMessage} />{previewSuggestion ? <SuggestionPreview suggestion={demoSuggestion || previewSuggestion} /> : null}<div className="flex flex-wrap gap-3">
                                    <Button
                                        color="primary"
                                        startContent={<Send size={16} />}
                                        isDisabled={!demoMessage.trim() || state.status !== "active"}
                                        onClick={handleSendDemo}
                                    >
                                        发送回复建议
                                    </Button>{state.status !== "active" ? (
                                        <Chip color="warning" variant="flat"startContent={<AlertTriangle size={14} />}>当前连接已暂停</Chip> ) : null}</div> </CardBody> </Card><Card className="border border-default-200 shadow-sm"> <CardHeader className="flex-col items-start gap-1"> <div className="flex items-center gap-2"> <ClipboardCheck size={18} className="text-primary"/> <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">最近发送记录</h2> </div><p className="text-sm text-default-500">最近通过企业微信助手发送的记录。</p> </CardHeader><Divider /> <CardBody className="gap-3">{state.records.length ? ( state.records.map((record) => <MessageRecordCard key={record.id} record={record} />) ) : ( <div className="rounded-[8px] border border-dashed border-default-300 p-8 text-center text-sm text-default-500"> 暂无发送记录 </div> )}</CardBody> </Card> </div> </div> )}<Card className="border border-default-200 bg-content1 shadow-sm"> <CardBody className="grid gap-4 text-sm leading-6 text-default-600 md:grid-cols-3"> <div className="flex gap-3"> <Bot className="mt-0.5 text-primary"size={18} /> <div> <p className="font-semibold text-[var(--kaypal-v3-ink)]">第一版能力</p><p>AI 生成回复建议，发送到企业微信群，由员工确认后回复客户。</p> </div> </div><div className="flex gap-3"> <ShieldCheck className="mt-0.5 text-success"size={18} /> <div> <p className="font-semibold text-[var(--kaypal-v3-ink)]">安全边界</p><p>不直接自动回复客户；退款、投诉、差评等场景优先转人工。</p> </div> </div><div className="flex gap-3"> <PlugZap className="mt-0.5 text-warning"size={18} /> <div> <p className="font-semibold text-[var(--kaypal-v3-ink)]">发送能力</p><p>授权信息加密保存，并通过企业微信机器人真实发送。</p>
                        </div>
                    </div>
                </CardBody>
            </Card><RiskConfirmationDialog
                checklist={[
                    "确认企业微信群不再接收 AI 回复建议。",
                    "删除后需要重新粘贴企业微信机器人地址并测试通过才能恢复。",
                ]}
                confirmLabel="确认删除"
                description="删除企业微信连接后，系统将不再向该群发送 AI 回复建议。"
                impactItems={[
                    {
                        label: "连接名称",
                        value: state.integration?.name || connectionName || "-",
                    },
                    {
                        label: "连接地址",
                        value: commercialDisplayText(state.integration?.maskedWebhookUrl || "-"),
                    },
                ]}
                isLoading={isDeleting}
                isOpen={deleteOpen}
                riskLevel="high"
                title="确认删除企业微信连接"
                onCancel={() => setDeleteOpen(false)}
                onConfirm={confirmDelete}
            />
        </div>
    );
}
