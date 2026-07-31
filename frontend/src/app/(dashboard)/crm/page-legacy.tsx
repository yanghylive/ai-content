"use client";

import React from "react";
import Link from "next/link";
import {
    Button,
    Card,
    CardBody,
    CardFooter,
    CardHeader,
    Chip,
    Divider,
    Input,
    Spinner,
    Textarea,
} from "@heroui/react";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import {
    Archive,
    ArrowRight,
    Building2,
    Check,
    CircleDollarSign,
    ClipboardList,
    DatabaseZap,
	    FileText,
	    Eye,
    Plus,
    RefreshCw,
    Search,
    UsersRound,
} from "lucide-react";
import toast from "@/lib/toast";
import { FunctionalEmptyState } from "../components/functional-empty-state";
import { getCrmAppState } from "@/lib/api/app-market";
import {
    archiveCrmCompany,
    archiveCrmCustomer,
    archiveCrmNote,
    archiveCrmOpportunity,
    archiveCrmTask,
    completeCrmTask,
    createCrmCompany,
    createCrmCustomer,
    createCrmNote,
    createCrmOpportunity,
    createCrmTask,
    getCrmSummary,
    getCrmTimeline,
    listCrmCompanies,
    listCrmCustomers,
    listCrmNotes,
    listCrmOpportunities,
    listCrmTasks,
    type CrmCompany,
    type CrmCustomer,
    type CrmNote,
    type CrmOpportunity,
    type CrmSummary,
    type CrmTask,
    type CrmTimelineEvent,
} from "@/lib/api/crm";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toActionableError, toPublicError } from "@/lib/public-error";

type CrmTab = "customers" | "companies" | "opportunities" | "tasks" | "notes";

const statusLabels: Record<string, string> = {
    new: "新线索",
    contacted: "已触达",
    interested: "有意向",
    follow_up: "待跟进",
    customer: "已成交",
    invalid: "无效",
    archived: "已归档",
};

const stageLabels: Record<string, string> = {
    qualified: "已确认",
    proposal: "方案中",
    negotiation: "谈判中",
    won: "已成交",
    lost: "已丢单",
};

const tabLabels: Array<{ key: CrmTab; label: string; icon: React.ReactNode }> = [
    { key: "customers", label: "联系人", icon: <UsersRound size={14} /> },
    { key: "companies", label: "公司", icon: <Building2 size={14} /> },
    { key: "opportunities", label: "商机", icon: <CircleDollarSign size={14} /> },
    { key: "tasks", label: "任务", icon: <ClipboardList size={14} /> },
    { key: "notes", label: "备注", icon: <FileText size={14} /> },
];

function formatDate(value?: string | null) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function formatMoney(cents?: number | null) {
    const amount = (cents ?? 0) / 100;
    return new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: "CNY",
        maximumFractionDigits: 0,
    }).format(amount);
}

function toCents(value: string) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 0;
    return Math.max(0, Math.round(amount * 100));
}

function crmText(value: unknown, fallback = "-") {
    return commercialDisplayText(value, fallback) || fallback;
}

function crmNullableText(value: string | null) {
    return value ? crmText(value, "") : null;
}

function sanitizeTags(tags: string[]) {
    return tags.map((tag) => crmText(tag, "")).filter(Boolean);
}

function sanitizeCrmCustomer(customer: CrmCustomer): CrmCustomer {
    return {
        ...customer,
        displayName: crmText(customer.displayName, "联系人"),
        companyName: crmNullableText(customer.companyName),
        title: crmNullableText(customer.title),
        email: crmNullableText(customer.email),
        phone: crmNullableText(customer.phone),
        wechat: crmNullableText(customer.wechat),
	        sourcePlatform: crmNullableText(customer.sourcePlatform),
	        sourceAccount: customer.sourceAccount
	            ? {
	                ...customer.sourceAccount,
	                name: crmNullableText(customer.sourceAccount.name),
	                platform: crmText(customer.sourceAccount.platform, "manual"),
	            }
	            : null,
        sourceKeyword: crmNullableText(customer.sourceKeyword),
        matchedKeyword: crmNullableText(customer.matchedKeyword),
        sourceUrl: crmNullableText(customer.sourceUrl),
        sourceText: crmNullableText(customer.sourceText),
        latestReply: crmNullableText(customer.latestReply),
        tags: sanitizeTags(customer.tags),
        profileUrl: crmNullableText(customer.profileUrl),
        externalUserId: crmNullableText(customer.externalUserId),
        dedupeKey: crmNullableText(customer.dedupeKey),
    };
}

function sanitizeCrmCompany(company: CrmCompany): CrmCompany {
    return {
        ...company,
        name: crmText(company.name, "公司"),
        domain: crmNullableText(company.domain),
        industry: crmNullableText(company.industry),
        phone: crmNullableText(company.phone),
        website: crmNullableText(company.website),
        city: crmNullableText(company.city),
        tags: sanitizeTags(company.tags),
    };
}

function sanitizeCrmOpportunity(opportunity: CrmOpportunity): CrmOpportunity {
    return {
        ...opportunity,
        name: crmText(opportunity.name, "商机"),
        companyName: crmNullableText(opportunity.companyName),
        primaryCustomerName: crmNullableText(opportunity.primaryCustomerName),
        nextStep: crmNullableText(opportunity.nextStep),
        competitor: crmNullableText(opportunity.competitor),
        source: crmNullableText(opportunity.source),
    };
}

function sanitizeCrmTask(task: CrmTask): CrmTask {
    return {
        ...task,
        title: crmText(task.title, "任务"),
        description: crmNullableText(task.description),
        companyName: crmNullableText(task.companyName),
        customerName: crmNullableText(task.customerName),
        opportunityName: crmNullableText(task.opportunityName),
    };
}

function sanitizeCrmNote(note: CrmNote): CrmNote {
    return {
        ...note,
        body: crmText(note.body, "备注"),
        companyName: crmNullableText(note.companyName),
        customerName: crmNullableText(note.customerName),
        opportunityName: crmNullableText(note.opportunityName),
    };
}

function sanitizeCrmTimelineEvent(event: CrmTimelineEvent): CrmTimelineEvent {
    return {
        ...event,
        eventType: crmText(event.eventType, "动态"),
        channel: crmNullableText(event.channel),
        content: crmNullableText(event.content),
        replyContent: crmNullableText(event.replyContent),
        status: crmNullableText(event.status),
        failureReason: crmNullableText(event.failureReason),
    };
}

const emptyCustomerForm = {
    displayName: "",
    companyName: "",
	    title: "",
	    email: "",
	    phone: "",
	    wechat: "",
	    externalUserId: "",
	    sourcePlatform: "manual",
	    sourceAccountId: "",
	    sourceAccountName: "",
	    sourceKeyword: "",
	    sourceUrl: "",
    sourceText: "",
    latestReply: "",
    tags: "",
};

const emptyCompanyForm = {
    name: "",
    industry: "",
    city: "",
    domain: "",
};

const emptyOpportunityForm = {
    name: "",
    companyName: "",
    stage: "qualified",
    amountYuan: "",
    nextStep: "",
};

const emptyTaskForm = {
    title: "",
    priority: "normal",
    dueAt: "",
    customerId: "",
    opportunityId: "",
    description: "",
};

const emptyNoteForm = {
    body: "",
    customerId: "",
    opportunityId: "",
};

export default function CrmPage() {
    const [loading, setLoading] = React.useState(true);
    const [installed, setInstalled] = React.useState(false);
    const [summary, setSummary] = React.useState<CrmSummary | null>(null);
    const [customers, setCustomers] = React.useState<CrmCustomer[]>([]);
    const [companies, setCompanies] = React.useState<CrmCompany[]>([]);
    const [opportunities, setOpportunities] = React.useState<CrmOpportunity[]>([]);
    const [tasks, setTasks] = React.useState<CrmTask[]>([]);
    const [notes, setNotes] = React.useState<CrmNote[]>([]);
    const [selectedCustomerId, setSelectedCustomerId] = React.useState<string | null>(null);
    const [timeline, setTimeline] = React.useState<CrmTimelineEvent[]>([]);
    const [q, setQ] = React.useState("");
    const [activeTab, setActiveTab] = React.useState<CrmTab>("customers");

    // ?action=new 进入时：自动滚动到「快速新增」表单并聚焦姓名框
    React.useEffect(() => {
        if (typeof window === "undefined") return;
        if (!window.location.search.includes("action=new")) return;
        const timer = setTimeout(() => {
            document.getElementById("crm-quick-create")?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 600);
        return () => clearTimeout(timer);
    }, []);
    const [saving, setSaving] = React.useState(false);
    const [customerForm, setCustomerForm] = React.useState(emptyCustomerForm);
    const [companyForm, setCompanyForm] = React.useState(emptyCompanyForm);
    const [opportunityForm, setOpportunityForm] = React.useState(emptyOpportunityForm);
    const [taskForm, setTaskForm] = React.useState(emptyTaskForm);
    const [noteForm, setNoteForm] = React.useState(emptyNoteForm);

    const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) || customers[0] || null;
    const selectedCustomerTimelineId = selectedCustomer?.id || null;

	    const loadCrm = React.useCallback(async (keyword: string) =>{
        setLoading(true);
        try {
            const appState = await getCrmAppState();
            setInstalled(Boolean(appState.installed));
            if (!appState.installed) {
                setSummary(null);
                setCustomers([]);
                setCompanies([]);
                setOpportunities([]);
                setTasks([]);
                setNotes([]);
                setTimeline([]);
                return;
            }
            const [
                nextSummary,
                nextCustomers,
                nextCompanies,
                nextOpportunities,
                nextTasks,
                nextNotes,
            ] = await Promise.all([
                getCrmSummary(),
                listCrmCustomers({ q: keyword }),
                listCrmCompanies({ q: keyword }),
                listCrmOpportunities({ q: keyword }),
                listCrmTasks({ q: keyword }),
                listCrmNotes({ q: keyword }),
            ]);
            setSummary(nextSummary);
            setCustomers(nextCustomers.map(sanitizeCrmCustomer));
            setCompanies(nextCompanies.map(sanitizeCrmCompany));
            setOpportunities(nextOpportunities.map(sanitizeCrmOpportunity));
            setTasks(nextTasks.map(sanitizeCrmTask));
            setNotes(nextNotes.map(sanitizeCrmNote));
            setSelectedCustomerId((current) =>{
                if (current && nextCustomers.some((customer) => customer.id === current)) return current;
                return nextCustomers[0]?.id || null;
            });
        } catch (error) {
            toast.error(toPublicError(error, "CRM 数据暂时无法加载，请重新加载。"));
        } finally {
            setLoading(false);
        }
	    }, []);

    React.useEffect(() =>{
        loadCrm("");
    }, [loadCrm]);

    React.useEffect(() =>{
        if (!selectedCustomerTimelineId || !installed) {
            setTimeline([]);
            return;
        }
        let active = true;
        getCrmTimeline(selectedCustomerTimelineId)
            .then((events) =>{
                if (active) setTimeline(events.map(sanitizeCrmTimelineEvent));
            })
            .catch(() =>{
                if (active) setTimeline([]);
            });
        return () =>{
            active = false;
        };
    }, [installed, selectedCustomerTimelineId]);

    const handleCreate = async () =>{
        setSaving(true);
        try {
            if (activeTab === "customers") {
                const displayName = customerForm.displayName.trim();
                if (!displayName) {
                    // 引导到表单而不是干报错：滚动到快速新增卡片并聚焦姓名框
                    document.getElementById("crm-quick-create")?.scrollIntoView({ behavior: "smooth", block: "center" });
                    setTimeout(() => {
                        const input = document.querySelector<HTMLInputElement>("#crm-quick-create")?.closest("div")?.parentElement?.querySelector("input");
                        input?.focus();
                    }, 400);
                    throw new Error("先在下方「快速新增」表单里填客户姓名");
                }
                const customer = await createCrmCustomer({
                    displayName,
                    companyName: customerForm.companyName.trim() || undefined,
	                    title: customerForm.title.trim() || undefined,
	                    email: customerForm.email.trim() || undefined,
	                    phone: customerForm.phone.trim() || undefined,
	                    wechat: customerForm.wechat.trim() || undefined,
	                    externalUserId: customerForm.externalUserId.trim() || undefined,
	                    sourcePlatform: customerForm.sourcePlatform,
	                    sourceAccountId: customerForm.sourceAccountId.trim() || undefined,
	                    sourceAccountName: customerForm.sourceAccountName.trim() || undefined,
	                    sourceKeyword: customerForm.sourceKeyword.trim() || undefined,
	                    sourceUrl: customerForm.sourceUrl.trim() || undefined,
                    sourceText: customerForm.sourceText.trim() || undefined,
                    latestReply: customerForm.latestReply.trim() || undefined,
                    tags: customerForm.tags.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean),
                });
                setCustomerForm(emptyCustomerForm);
                setSelectedCustomerId(customer.id);
                toast.success("联系人已写入 CRM");
            }
            if (activeTab === "companies") {
                const name = companyForm.name.trim();
                if (!name) throw new Error("公司名称不能为空");
                await createCrmCompany({
                    name,
                    industry: companyForm.industry.trim() || null,
                    city: companyForm.city.trim() || null,
                    domain: companyForm.domain.trim() || null,
                });
                setCompanyForm(emptyCompanyForm);
                toast.success("公司已创建");
            }
            if (activeTab === "opportunities") {
                const name = opportunityForm.name.trim();
                if (!name) throw new Error("商机名称不能为空");
                await createCrmOpportunity({
                    name,
                    companyName: opportunityForm.companyName.trim() || undefined,
                    stage: opportunityForm.stage,
                    amountCents: toCents(opportunityForm.amountYuan),
                    nextStep: opportunityForm.nextStep.trim() || undefined,
                });
                setOpportunityForm(emptyOpportunityForm);
                toast.success("商机已创建");
            }
            if (activeTab === "tasks") {
                const title = taskForm.title.trim();
                if (!title) throw new Error("任务标题不能为空");
                await createCrmTask({
                    title,
                    priority: taskForm.priority,
                    dueAt: taskForm.dueAt || undefined,
                    customerId: taskForm.customerId || null,
                    opportunityId: taskForm.opportunityId || null,
                    description: taskForm.description.trim() || undefined,
                });
                setTaskForm(emptyTaskForm);
                toast.success("任务已创建");
            }
            if (activeTab === "notes") {
                const body = noteForm.body.trim();
                if (!body) throw new Error("备注内容不能为空");
                await createCrmNote({
                    body,
                    customerId: noteForm.customerId || null,
                    opportunityId: noteForm.opportunityId || null,
                });
                setNoteForm(emptyNoteForm);
                toast.success("备注已创建");
            }
            await loadCrm(q);
        } catch (error) {
            toast.error(toActionableError(error, "CRM 记录未保存，请重试。"));
        } finally {
            setSaving(false);
        }
    };

    const archiveAndReload = async (action: () => Promise<unknown>, message: string) =>{
        try {
            await action();
            await loadCrm(q);
            toast.success(message);
        } catch (error) {
            toast.error(toActionableError(error, "CRM 操作未完成，请重试。")); } }; if (loading && !summary && customers.length === 0) { return ( <div className="flex h-full items-center justify-center"> <div className="flex items-center gap-3 rounded-[8px] border border-default-200 bg-content1 px-4 py-3 shadow-sm">
                    <Spinner size="sm"/> <span className="text-sm text-default-500">正在加载 CRM...</span> </div> </div> ); } if (!installed) { return ( <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5"> <header className="kaypal-v3-page-header p-5">
                    <Chip color="warning" variant="flat"startContent={<DatabaseZap size={14} />}> 未安装 </Chip><h1 className="mt-3">CRM 客户管理</h1><p className="mt-2 text-sm leading-6 text-default-500">
                        CRM 是应用市场里的付费应用。购买并安装后，左侧会出现 CRM 入口，自动获客线索会沉淀到这里。
                    </p><Button as={Link} href="/apps" color="primary" className="mt-4 rounded-[8px] font-semibold"endContent={<ArrowRight size={16} />}> 去应用市场安装 </Button> </header> </div> ); } return ( <div className="mx-auto flex w-full max-w-[1460px] flex-col gap-3 pb-8 text-[13px]"> <header className="kaypal-v3-page-header flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"> <div> <div className="flex flex-wrap items-center gap-2">
                        <Chip color="success" variant="flat" startContent={<UsersRound size={14} />}>
                            CRM 已安装
                        </Chip><Chip variant="flat">应用市场付费应用</Chip> </div><h1 className="mt-2">CRM 客户管理</h1><p className="mt-1 text-sm text-default-500">公司、联系人、商机、任务、备注和自动获客时间线。</p> </div><div className="flex flex-wrap gap-2">
                    <Button
                        variant="flat"className="rounded-[8px] font-semibold"
                        onPress={() => loadCrm(q)}
                        startContent={<RefreshCw size={16} />}
                    >
                        刷新
                    </Button><Button color="primary" className="rounded-[8px] font-semibold" onPress={() => {
                        document.getElementById("crm-quick-create")?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }} startContent={<Plus size={16} />}> 新增 </Button> </div> </header><div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
                <Metric label="联系人" value={summary?.activeCustomers ?? 0} />
                <Metric label="公司" value={summary?.totalCompanies ?? 0} />
                <Metric label="进行中商机" value={summary?.activeOpportunities ?? 0} />
                <Metric label="已成交商机" value={summary?.wonOpportunities ?? 0} />
                <Metric label="待办任务" value={summary?.openTasks ?? 0} tone={(summary?.overdueTasks ?? 0) > 0 ? "danger" : "default"} />
                <Metric label="管道金额" value={formatMoney(summary?.pipelineAmountCents ?? 0)} />
                <Metric label="时间线"value={summary?.timelineEvents ?? 0} /> </div><Card className="border border-default-200 bg-content1 shadow-sm"> <CardBody className="flex flex-col gap-3 p-3"> <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between"> <div className="flex flex-wrap gap-1">{tabLabels.map((tab) => (
                                <Button
                                    key={tab.key}
                                    size="sm"
                                    variant={activeTab === tab.key ? "solid" : "flat"}
                                    color={activeTab === tab.key ? "primary" : "default"} className="rounded-[8px] font-semibold"onPress={() => setActiveTab(tab.key)} startContent={tab.icon} >{tab.label}</Button> ))}</div><div className="flex w-full gap-2 lg:w-[420px]">
                            <Input
                                value={q}
                                onValueChange={setQ}
                                size="sm"
                                placeholder="搜索名称、关键词、来源内容"
                                startContent={<Search size={14} />}
                                onKeyDown={(event) =>{
                                    if (event.key === "Enter") loadCrm(q);
                                }}
                            />
                            <Button size="sm" variant="flat" className="rounded-[8px]"onPress={() => loadCrm(q)}> 搜索 </Button> </div> </div><Divider /> <div className="grid min-h-[520px] grid-cols-1 gap-3 xl:grid-cols-[1.25fr_0.75fr]"> <div className="overflow-x-auto">{activeTab === "customers" && (
                                <CustomersTable
                                    customers={customers}
                                    selectedId={selectedCustomer?.id || null}
                                    onSelect={setSelectedCustomerId}
                                    onArchive={(customer) => archiveAndReload(() => archiveCrmCustomer(customer.id), "联系人已归档")}
                                />
                            )}
                            {activeTab === "companies" && (
                                <CompaniesTable
                                    companies={companies}
                                    onArchive={(company) => archiveAndReload(() => archiveCrmCompany(company.id), "公司已归档")}
                                />
                            )}
                            {activeTab === "opportunities" && (
                                <OpportunitiesTable
                                    opportunities={opportunities}
                                    onArchive={(opportunity) => archiveAndReload(() => archiveCrmOpportunity(opportunity.id), "商机已归档")}
                                />
                            )}
                            {activeTab === "tasks" && (
                                <TasksTable
                                    tasks={tasks}
                                    onComplete={(task) => archiveAndReload(() => completeCrmTask(task.id), "任务已完成")}
                                    onArchive={(task) => archiveAndReload(() => archiveCrmTask(task.id), "任务已归档")}
                                />
                            )}
                            {activeTab === "notes" && (
                                <NotesTable
                                    notes={notes}
                                    onArchive={(note) => archiveAndReload(() => archiveCrmNote(note.id), "备注已归档")} /> )}</div><CustomerDetail customer={selectedCustomer} timeline={timeline} /> </div> </CardBody> </Card><Card className="border border-default-200 bg-content1 shadow-sm"> <CardHeader className="p-3"> <div> <h2 id="crm-quick-create" className="text-sm font-bold text-[var(--kaypal-v3-ink)]">快速新增：{tabLabels.find((tab) => tab.key === activeTab)?.label}</h2><p className="text-xs text-default-500">写入后同步生成时间线，自动获客沉淀的数据也会进入同一套 CRM 表。</p> </div> </CardHeader><Divider /> <CardBody className="p-3">{activeTab === "customers"&& ( <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
                            <Input size="sm" label="姓名/昵称" value={customerForm.displayName} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, displayName: value }))} />
                            <Input size="sm" label="公司" value={customerForm.companyName} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, companyName: value }))} />
                            <Input size="sm" label="职位" value={customerForm.title} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, title: value }))} />
                            <Input size="sm" label="邮箱" value={customerForm.email} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, email: value }))} />
                            <Input size="sm" label="手机号" value={customerForm.phone} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, phone: value }))} />
                            <Input size="sm" label="微信号" value={customerForm.wechat} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, wechat: value }))} />
                            <Input size="sm" label="平台用户 ID" value={customerForm.externalUserId} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, externalUserId: value }))} />
                            <SelectLike label="来源平台" value={customerForm.sourcePlatform} onChange={(value) => setCustomerForm((prev) => ({ ...prev, sourcePlatform: value }))} options={{ manual: "手动录入", douyin: "抖音", wechat: "微信", "wechat-channel": "视频号", xiaohongshu: "小红书", growth: "增长获客" }} />
                            <Input size="sm" label="来源账号名称" value={customerForm.sourceAccountName} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, sourceAccountName: value }))} />
                            <Input size="sm" label="来源账号 ID" value={customerForm.sourceAccountId} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, sourceAccountId: value }))} />
                            <Input size="sm" label="来源关键词" value={customerForm.sourceKeyword} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, sourceKeyword: value }))} />
                            <Input size="sm" label="来源链接" value={customerForm.sourceUrl} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, sourceUrl: value }))} />
                            <Input size="sm" label="标签" value={customerForm.tags} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, tags: value }))} />
                            <Textarea size="sm" label="来源内容" minRows={1} value={customerForm.sourceText} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, sourceText: value }))} />
                            <Textarea size="sm" label="最近回复" minRows={1} value={customerForm.latestReply} onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, latestReply: value }))} />
                        </div>
                    )}
                    {activeTab === "companies"&& ( <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
                            <Input size="sm" label="公司名称" value={companyForm.name} onValueChange={(value) => setCompanyForm((prev) => ({ ...prev, name: value }))} />
                            <Input size="sm" label="行业" value={companyForm.industry} onValueChange={(value) => setCompanyForm((prev) => ({ ...prev, industry: value }))} />
                            <Input size="sm" label="城市" value={companyForm.city} onValueChange={(value) => setCompanyForm((prev) => ({ ...prev, city: value }))} />
                            <Input size="sm" label="域名" value={companyForm.domain} onValueChange={(value) => setCompanyForm((prev) => ({ ...prev, domain: value }))} />
                        </div>
                    )}
                    {activeTab === "opportunities"&& ( <div className="grid grid-cols-1 gap-2 lg:grid-cols-5">
                            <Input size="sm" label="商机名称" value={opportunityForm.name} onValueChange={(value) => setOpportunityForm((prev) => ({ ...prev, name: value }))} />
                            <Input size="sm" label="公司" value={opportunityForm.companyName} onValueChange={(value) => setOpportunityForm((prev) => ({ ...prev, companyName: value }))} />
                            <Input size="sm" label="金额（元）" value={opportunityForm.amountYuan} onValueChange={(value) => setOpportunityForm((prev) => ({ ...prev, amountYuan: value }))} />
                            <SelectLike label="阶段" value={opportunityForm.stage} onChange={(value) => setOpportunityForm((prev) => ({ ...prev, stage: value }))} options={stageLabels} />
                            <Input size="sm" label="下一步" value={opportunityForm.nextStep} onValueChange={(value) => setOpportunityForm((prev) => ({ ...prev, nextStep: value }))} />
                        </div>
                    )}
                    {activeTab === "tasks"&& ( <div className="grid grid-cols-1 gap-2 lg:grid-cols-5">
                            <Input size="sm" label="任务标题" value={taskForm.title} onValueChange={(value) => setTaskForm((prev) => ({ ...prev, title: value }))} />
                            <SelectLike label="优先级" value={taskForm.priority} onChange={(value) => setTaskForm((prev) => ({ ...prev, priority: value }))} options={{ low: "低", normal: "普通", high: "高" }} />
                            <Input size="sm" type="date" label="截止日期" value={taskForm.dueAt} onValueChange={(value) => setTaskForm((prev) => ({ ...prev, dueAt: value }))} />
                            <RelatedSelect label="关联联系人" value={taskForm.customerId} onChange={(value) => setTaskForm((prev) => ({ ...prev, customerId: value }))} items={customers.map((customer) => ({ id: customer.id, label: customer.displayName }))} />
                            <Textarea size="sm" label="说明" minRows={1} value={taskForm.description} onValueChange={(value) => setTaskForm((prev) => ({ ...prev, description: value }))} />
                        </div>
                    )}
                    {activeTab === "notes"&& ( <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_220px_220px]">
                            <Textarea size="sm" label="备注内容" minRows={1} value={noteForm.body} onValueChange={(value) => setNoteForm((prev) => ({ ...prev, body: value }))} />
                            <RelatedSelect label="关联联系人" value={noteForm.customerId} onChange={(value) => setNoteForm((prev) => ({ ...prev, customerId: value }))} items={customers.map((customer) => ({ id: customer.id, label: customer.displayName }))} />
                            <RelatedSelect label="关联商机"value={noteForm.opportunityId} onChange={(value) => setNoteForm((prev) => ({ ...prev, opportunityId: value }))} items={opportunities.map((opportunity) => ({ id: opportunity.id, label: opportunity.name }))} /> </div> )}</CardBody><CardFooter className="justify-end gap-2 p-3 pt-0"><Button color="primary" className="rounded-[8px] font-semibold" onPress={handleCreate} isLoading={saving} startContent={!saving ? <Plus size={16} /> : null}> 确认新增 </Button></CardFooter> </Card> </div> ); } function CustomersTable({ customers, selectedId, onSelect, onArchive }: { customers: CrmCustomer[]; selectedId: string | null; onSelect: (id: string) => void; onArchive: (customer: CrmCustomer) => void; }) { return ( <table className="w-full min-w-[920px] border-collapse"><thead className="bg-default-50 text-left text-[12px] font-semibold text-default-500"><tr><th className="px-3 py-2">联系人</th><th className="px-3 py-2">公司/职位</th><th className="px-3 py-2">来源</th><th className="px-3 py-2">最近回复</th><th className="px-3 py-2">跟进</th><th className="px-3 py-2 text-right">操作</th></tr></thead><tbody>{customers.length ? customers.map((customer) => ( <tr key={customer.id} className={`border-t border-default-100 hover:bg-default-50 ${selectedId === customer.id ?"bg-primary-50/50" : ""}`}><td className="px-3 py-2">
                        <button type="button" className="text-left font-semibold text-[var(--kaypal-v3-ink)]"onClick={() => onSelect(customer.id)}>{customer.displayName}</button><div className="mt-1 flex flex-wrap gap-1">{customer.tags.slice(0, 3).map((tag) => <Chip key={tag} size="sm" variant="flat" className="h-5 rounded-[6px] text-[11px]">{tag}</Chip>)}</div> </td><td className="px-3 py-2 text-default-600">{customer.companyName || "-"}<div className="text-xs text-default-400">{customer.title || customer.phone || customer.wechat || "-"}</div></td><td className="px-3 py-2 text-default-600">{customer.sourceAccount?.name || customer.sourceKeyword || customer.sourcePlatform || "-"}<div className="text-xs text-default-400">{customer.sourceKeyword || customer.matchedKeyword || "-"}</div></td><td className="max-w-[280px] truncate px-3 py-2 text-default-600">{customer.latestReply || customer.sourceText || "-"}</td><td className="px-3 py-2"><Chip size="sm" color={customer.archived ? "default" : "success"} variant="flat">{statusLabels[customer.status] || customer.status}</Chip></td><td className="px-3 py-2 text-right"><div className="flex justify-end gap-1"><Button as={Link} href={`/crm/customer?id=${encodeURIComponent(customer.id)}`} isIconOnly aria-label={`打开 ${customer.displayName} 客户档案`} size="sm" variant="flat"><Eye size={14} /></Button><ArchiveButton disabled={customer.archived} onPress={() => onArchive(customer)} /></div></td></tr>
            )) : <EmptyRow colSpan={6} label="暂无联系人"/>}</tbody></table> ); } function CompaniesTable({ companies, onArchive }: { companies: CrmCompany[]; onArchive: (company: CrmCompany) => void }) { return ( <table className="w-full min-w-[820px] border-collapse"><thead className="bg-default-50 text-left text-[12px] font-semibold text-default-500"><tr><th className="px-3 py-2">公司</th><th className="px-3 py-2">行业/城市</th><th className="px-3 py-2">联系人</th><th className="px-3 py-2">商机</th><th className="px-3 py-2">更新时间</th><th className="px-3 py-2 text-right">操作</th></tr></thead><tbody>{companies.length ? companies.map((company) => ( <tr key={company.id} className="border-t border-default-100 hover:bg-default-50"><td className="px-3 py-2 font-semibold text-[var(--kaypal-v3-ink)]">{company.name}<div className="text-xs text-default-400">{company.domain || company.website || "-"}</div></td><td className="px-3 py-2 text-default-600">{company.industry || "-"}<div className="text-xs text-default-400">{company.city || "-"}</div></td><td className="px-3 py-2">{company.customerCount}</td><td className="px-3 py-2">{company.opportunityCount}</td><td className="px-3 py-2 text-default-500">{formatDate(company.updatedAt)}</td><td className="px-3 py-2 text-right"><ArchiveButton disabled={company.archived} onPress={() => onArchive(company)} /></td></tr>
            )) : <EmptyRow colSpan={6} label="暂无公司"/>}</tbody></table> ); } function OpportunitiesTable({ opportunities, onArchive }: { opportunities: CrmOpportunity[]; onArchive: (opportunity: CrmOpportunity) => void }) { return ( <table className="w-full min-w-[920px] border-collapse"><thead className="bg-default-50 text-left text-[12px] font-semibold text-default-500"><tr><th className="px-3 py-2">商机</th><th className="px-3 py-2">阶段</th><th className="px-3 py-2">金额</th><th className="px-3 py-2">公司/联系人</th><th className="px-3 py-2">下一步</th><th className="px-3 py-2 text-right">操作</th></tr></thead><tbody>{opportunities.length ? opportunities.map((opportunity) => ( <tr key={opportunity.id} className="border-t border-default-100 hover:bg-default-50"><td className="px-3 py-2 font-semibold text-[var(--kaypal-v3-ink)]">{opportunity.name}<div className="text-xs text-default-400">{formatDate(opportunity.updatedAt)}</div></td><td className="px-3 py-2"><Chip size="sm" variant="flat" color={opportunity.stage === "won" ? "success" : "primary"}>{stageLabels[opportunity.stage] || opportunity.stage}</Chip></td><td className="px-3 py-2 font-semibold">{formatMoney(opportunity.amountCents)}</td><td className="px-3 py-2 text-default-600">{opportunity.companyName || "-"}<div className="text-xs text-default-400">{opportunity.primaryCustomerName || "-"}</div></td><td className="max-w-[260px] truncate px-3 py-2 text-default-600">{opportunity.nextStep || "-"}</td><td className="px-3 py-2 text-right"><ArchiveButton disabled={opportunity.archived} onPress={() => onArchive(opportunity)} /></td></tr>
            )) : <EmptyRow colSpan={6} label="暂无商机"/>}</tbody></table> ); } function TasksTable({ tasks, onComplete, onArchive }: { tasks: CrmTask[]; onComplete: (task: CrmTask) => void; onArchive: (task: CrmTask) => void }) { return ( <table className="w-full min-w-[900px] border-collapse"><thead className="bg-default-50 text-left text-[12px] font-semibold text-default-500"><tr><th className="px-3 py-2">任务</th><th className="px-3 py-2">对象</th><th className="px-3 py-2">优先级</th><th className="px-3 py-2">截止</th><th className="px-3 py-2">状态</th><th className="px-3 py-2 text-right">操作</th></tr></thead><tbody>{tasks.length ? tasks.map((task) => ( <tr key={task.id} className="border-t border-default-100 hover:bg-default-50"><td className="px-3 py-2 font-semibold text-[var(--kaypal-v3-ink)]">{task.title}<div className="max-w-[300px] truncate text-xs font-normal text-default-400">{task.description || "-"}</div></td><td className="px-3 py-2 text-default-600">{task.customerName || task.companyName || "-"}<div className="text-xs text-default-400">{task.opportunityName || "-"}</div></td><td className="px-3 py-2">{task.priority}</td><td className="px-3 py-2 text-default-500">{formatDate(task.dueAt)}</td><td className="px-3 py-2"><Chip size="sm" variant="flat" color={task.status === "done" ? "success" : "warning"}>{task.status === "done" ? "已完成" : "待处理"}</Chip></td><td className="px-3 py-2 text-right"> <div className="flex justify-end gap-1">
                            <Button size="sm" variant="flat" className="rounded-[8px]" isDisabled={task.status === "done"} onPress={() => onComplete(task)} startContent={<Check size={14} />}>完成</Button><ArchiveButton disabled={task.archived} onPress={() => onArchive(task)} />
                        </div>
                    </td></tr>
            )) : <EmptyRow colSpan={6} label="暂无任务"/>}</tbody></table> ); } function NotesTable({ notes, onArchive }: { notes: CrmNote[]; onArchive: (note: CrmNote) => void }) { return ( <table className="w-full min-w-[820px] border-collapse"><thead className="bg-default-50 text-left text-[12px] font-semibold text-default-500"><tr><th className="px-3 py-2">备注</th><th className="px-3 py-2">联系人</th><th className="px-3 py-2">商机</th><th className="px-3 py-2">创建时间</th><th className="px-3 py-2 text-right">操作</th></tr></thead><tbody>{notes.length ? notes.map((note) => ( <tr key={note.id} className="border-t border-default-100 hover:bg-default-50"><td className="max-w-[420px] px-3 py-2 text-default-700">{note.body}</td><td className="px-3 py-2 text-default-600">{note.customerName || note.companyName || "-"}</td><td className="px-3 py-2 text-default-600">{note.opportunityName || "-"}</td><td className="px-3 py-2 text-default-500">{formatDate(note.createdAt)}</td><td className="px-3 py-2 text-right"><ArchiveButton disabled={note.archived} onPress={() => onArchive(note)} /></td></tr>
            )) : <EmptyRow colSpan={5} label="暂无备注"/>}</tbody></table> ); } function CustomerDetail({ customer, timeline }: { customer: CrmCustomer | null; timeline: CrmTimelineEvent[] }) { return ( <div className="rounded-[8px] border border-default-200 bg-content2 p-3"> <div className="flex items-start justify-between gap-2"> <div> <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">{customer?.displayName || "客户详情"}</h2><p className="mt-1 text-xs text-default-500">{customer?.companyName || "选择联系人查看来源和时间线"}</p>
                </div>{customer ? <Chip size="sm" variant="flat" color="success">{statusLabels[customer.status] || customer.status}</Chip> : null}</div><Divider className="my-3"/>{customer ? ( <div className="flex flex-col gap-3"> <div className="grid grid-cols-2 gap-2 text-xs">
                        <InfoItem label="来源关键词" value={customer.sourceKeyword || "-"} />
                        <InfoItem label="匹配关键词" value={customer.matchedKeyword || "-"} />
                        <InfoItem label="来源账号" value={customer.sourceAccount?.name || customer.sourceAccount?.id || "-"} />
                        <InfoItem label="联系方式" value={customer.phone || customer.wechat || customer.email || "-"} />
                        <InfoItem label="评分" value={`${customer.score}`} />
                    </div><Button as={Link} href={`/crm/customer?id=${encodeURIComponent(customer.id)}`} color="primary" size="sm" variant="flat" startContent={<Eye size={14} />}>打开完整档案</Button><TextBlock label="来源内容" value={customer.sourceText || "暂无来源内容"} />
                    <TextBlock label="最近回复" value={customer.latestReply || "暂无回复内容"} /> <div> <div className="mb-2 text-xs font-semibold text-default-500">时间线</div><div className="flex max-h-[300px] flex-col gap-2 overflow-auto pr-1">{timeline.length ? timeline.map((event) => ( <div key={event.id} className="rounded-[8px] border border-default-200 bg-content1 p-3"> <div className="flex items-center justify-between gap-2"> <span className="font-semibold text-[var(--kaypal-v3-ink)]">{event.eventType}</span><span className="text-xs text-default-400">{formatDate(event.createdAt)}</span> </div><p className="mt-1 text-xs leading-5 text-default-600">{event.replyContent || event.content || "-"}</p> </div> )) : ( <div className="rounded-[8px] border border-dashed border-default-200 p-4 text-center text-default-400">暂无时间线</div> )}</div> </div> </div> ) : ( <div className="rounded-[8px] border border-dashed border-default-200 p-8 text-center text-default-400">暂无客户详情</div>
            )}</div>
    );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number | string; tone?: "default" | "danger"}) { return ( <div className={`rounded-[8px] border bg-content1 p-3 shadow-sm ${tone ==="danger" ? "border-danger-200" : "border-default-200"}`}> <div className="text-[11px] font-semibold text-default-500">{label}</div><div className={`mt-1 truncate text-xl font-bold ${tone ==="danger" ? "text-danger" : "text-[var(--kaypal-v3-ink)]"}`}>{value}</div> </div> ); } function InfoItem({ label, value }: { label: string; value: string }) { return ( <div className="rounded-[8px] border border-default-200 bg-content1 p-2"> <div className="text-[11px] font-semibold text-default-500">{label}</div><div className="mt-1 truncate text-sm font-semibold text-[var(--kaypal-v3-ink)]">{value}</div> </div> ); } function TextBlock({ label, value }: { label: string; value: string }) { return ( <div className="rounded-[8px] border border-default-200 bg-content1 p-3"> <div className="text-xs font-semibold text-default-500">{label}</div><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--kaypal-v3-ink)]">{value}</p>
        </div>
    );
}

function ArchiveButton({ disabled, onPress }: { disabled?: boolean; onPress: () => void }) {
    return (
        <Button size="sm" variant="flat" className="rounded-[8px]"isDisabled={disabled} onPress={onPress} startContent={<Archive size={14} />}> 归档 </Button> ); } function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) { const meta = getCrmEmptyMeta(label); return ( <tr><td colSpan={colSpan} className="px-4 py-6"><FunctionalEmptyState actions={meta.actions} description={meta.description} examples={meta.examples} surface="plain" title={meta.title} /></td></tr> ); } function getCrmEmptyMeta(label: string) { const baseActions = [{ href: "/growth", label: "增长获客" }, { href: "/crm/import", label: "导入线索" }]; const map: Record<string, { title: string; description: string; examples: string[]; actions: Array<{ href?: string; label: string }> }> = { "暂无联系人": { title: "当前没有联系人", description: "联系人会从增长获客、客户互动和手动新增沉淀进来。可以先导入线索，或在下方快速新增联系人。", examples: ["导入线索", "手动新增", "互动沉淀", "跟进时间线"], actions: baseActions }, "暂无公司": { title: "当前没有公司", description: "公司用于把联系人和商机归组。可以先导入线索，也可以在下方快速新增公司。", examples: ["公司档案", "联系人归组", "商机关联"], actions: [{ href: "/crm/import", label: "导入线索" }] }, "暂无商机": { title: "当前没有商机", description: "商机用于记录意向、金额、阶段和下一步。可以先从联系人筛选意向客户，再在下方新增商机。", examples: ["意向客户", "阶段推进", "下一步动作"], actions: [{ href: "/growth?view=leads", label: "查看线索" }] }, "暂无任务": { title: "当前没有跟进任务", description: "任务用于提醒销售下一步动作。可以先选择联系人或商机，再在下方快速新增任务。", examples: ["回访", "报价", "加微信", "复盘"], actions: [{ href: "/engagement", label: "客户互动" }] }, "暂无备注": { title: "当前没有备注", description: "备注用于记录客户背景、沟通重点和内部判断。可以先选择联系人，再在下方补充备注。", examples: ["客户背景", "沟通重点", "内部判断"], actions: [{ href: "/crm/import", label: "导入线索" }] } }; return map[label] || { title: label, description: "当前列表为空，可以先从增长获客、导入线索或快速新增开始。", examples: ["新增记录", "导入线索", "增长获客"], actions: baseActions }; } function SelectLike({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (value: string) => void; }) { return ( <label className="flex flex-col gap-1 text-xs font-medium text-default-500">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 rounded-[8px] border border-default-200 bg-default-100 px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none">{Object.entries(options).map(([key, optionLabel]) => <option key={key} value={key}>{optionLabel}</option>)}</select> </label> ); } function RelatedSelect({ label, value, items, onChange }: { label: string; value: string; items: Array<{ id: string; label: string }>; onChange: (value: string) => void; }) { return ( <label className="flex flex-col gap-1 text-xs font-medium text-default-500">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 rounded-[8px] border border-default-200 bg-default-100 px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none"
            >
                <option value="">不关联</option>{items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
    );
}
