"use client";

import React from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Spinner,
} from "@heroui/react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CreditCard,
  DatabaseZap,
  MessageSquareText,
  PlugZap,
  Settings2,
  ShieldCheck,
  Store,
  UsersRound,
} from "lucide-react";
import toast from "@/lib/toast";
import {
  getWecomAssistantState,
  type WecomAssistantStatus,
} from "@/lib/api/wecom-ai-assistant";
import {
  getCrmAppState,
  installCrmApp,
  purchaseCrmApp,
  uninstallCrmApp,
  type MarketAppState,
} from "@/lib/api/app-market";
import { toPublicError } from "@/lib/public-error";

type WecomUiStatus = WecomAssistantStatus | "loading" | "unavailable";
type CrmUiStatus =
  | "loading"
  | "unavailable"
  | "not_purchased"
  | "purchased"
  | "installed"
  | "uninstalled";

type StatusMeta = {
  label: string;
  color: "default" | "primary" | "success" | "warning" | "danger";
};

const wecomStatusMeta: Record<WecomUiStatus, StatusMeta> = {
  loading: { label: "检查中", color: "primary" },
  unavailable: { label: "登录后查看", color: "default" },
  not_installed: { label: "未安装", color: "default" },
  active: { label: "已安装", color: "success" },
  test_failed: { label: "需重测", color: "danger" },
  disabled: { label: "已暂停", color: "warning" },
};

const crmStatusMeta: Record<CrmUiStatus, StatusMeta> = {
  loading: { label: "检查中", color: "primary" },
  unavailable: { label: "登录后查看", color: "default" },
  not_purchased: { label: "未购买", color: "default" },
  purchased: { label: "已购买未安装", color: "warning" },
  installed: { label: "已安装", color: "success" },
  uninstalled: { label: "已卸载", color: "default" },
};

function StatusChip({
  status,
  type,
}: {
  status: WecomUiStatus | CrmUiStatus;
  type: "wecom" | "crm";
}) {
  const meta =
    type === "wecom"
      ? wecomStatusMeta[status as WecomUiStatus]
      : crmStatusMeta[status as CrmUiStatus];

  return (
    <Chip
      color={meta.color}
      size="sm"
      startContent={status === "loading" ? <Spinner size="sm" /> : null}
      variant="flat"
    >
      {meta.label}
    </Chip>
  );
}

function CapabilityItem({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[8px] border border-default-200 bg-content1 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
        <span className="kaypal-v3-icon-tile h-8 w-8">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-default-500">{description}</p>
    </div>
  );
}

function resolveCrmUiStatus(
  state: MarketAppState | null,
  loading: boolean,
  unavailable: boolean,
): CrmUiStatus {
  if (loading) return "loading";
  if (unavailable) return "unavailable";
  if (!state || !state.purchased) return "not_purchased";
  if (state.installed) return "installed";
  if (state.installStatus === "uninstalled") return "uninstalled";
  return "purchased";
}

function crmPrimaryActionLabel(state: MarketAppState | null) {
  const action = state?.access?.primaryAction;
  if (action === "install") {
    return state?.installStatus === "uninstalled" ? "重新安装" : "安装";
  }
  if (action === "open") return "打开 CRM";
  if (action === "contact_sales") return "需开通授权";
  return "购买开通";
}

function crmAccessMessage(
  state: MarketAppState | null,
  loading: boolean,
  unavailable: boolean,
) {
  if (loading) return "正在检查 CRM 购买、安装和授权状态。";
  if (unavailable) return "登录后可查看 CRM 购买、安装和授权状态。";
  return state?.access?.nextActionLabel || "先购买并安装 CRM 客户管理应用。";
}

export default function AppsPage() {
  const [wecomStatus, setWecomStatus] =
    React.useState<WecomUiStatus>("loading");
  const [crmState, setCrmState] = React.useState<MarketAppState | null>(null);
  const [crmLoading, setCrmLoading] = React.useState(true);
  const [crmUnavailable, setCrmUnavailable] = React.useState(false);
  const [crmBusy, setCrmBusy] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    getWecomAssistantState()
      .then((state) => {
        if (!active) return;
        setWecomStatus(state.status || "not_installed");
      })
      .catch(() => {
        if (!active) return;
        setWecomStatus("unavailable");
      });

    getCrmAppState()
      .then((state) => {
        if (!active) return;
        setCrmState(state);
        setCrmUnavailable(false);
      })
      .catch(() => {
        if (!active) return;
        setCrmUnavailable(true);
      })
      .finally(() => {
        if (!active) return;
        setCrmLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const wecomInstalled =
    wecomStatus === "active" ||
    wecomStatus === "disabled" ||
    wecomStatus === "test_failed";
  const crmStatus = resolveCrmUiStatus(
    crmState,
    crmLoading,
    crmUnavailable,
  );
  const crmInstalled = crmStatus === "installed";
  const crmCommercialBlocked = Boolean(
    crmState?.commercialEntitlementRequired && !crmState.commercialEntitled,
  );
  const crmCommercialLabel = crmCommercialBlocked
    ? "缺少商用授权"
    : crmState?.commercialEntitled
      ? "授权有效"
      : "授权检查中";
  const crmPrimaryLabel = crmPrimaryActionLabel(crmState);
  const crmAccessText = crmAccessMessage(crmState, crmLoading, crmUnavailable);
  const crmAccessBlockers = crmState?.access?.blockers || [];

  const refreshCrm = async () => {
    const state = await getCrmAppState();
    setCrmState(state);
    setCrmUnavailable(false);
    window.dispatchEvent(new Event("kaypal-crm-install-state-changed"));
    return state;
  };

  const handleCrmPrimaryAction = async () => {
    if (crmInstalled) return;
    const primaryAction = crmState?.access?.primaryAction;
    if (crmCommercialBlocked || primaryAction === "contact_sales") {
      toast.error(
        crmState?.access?.nextActionLabel ||
          "CRM 需要有效商用授权后才能购买或安装",
      );
      return;
    }
    try {
      setCrmBusy(true);
      if (primaryAction === "purchase" || !crmState?.purchased) {
        await purchaseCrmApp();
        await refreshCrm();
        toast.success("CRM 已购买，下一步点击安装");
        return;
      }
      await installCrmApp();
      await refreshCrm();
      toast.success("CRM 已安装，左侧导航已开放");
    } catch (error) {
      toast.error(
        toPublicError(error, "CRM 开通或安装未完成，请稍后重试。"),
      );
    } finally {
      setCrmBusy(false);
    }
  };

  const handleCrmUninstall = async () => {
    try {
      setCrmBusy(true);
      await uninstallCrmApp();
      await refreshCrm();
      toast.success("CRM 已卸载，历史客户数据已保留");
    } catch (error) {
      toast.error(toPublicError(error, "CRM 未能卸载，请稍后重试。"));
    } finally {
      setCrmBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 pb-10">
      <header className="kaypal-v3-page-header flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip
              color="primary"
              startContent={<Store size={14} />}
              variant="flat"
            >
              应用市场
            </Chip>
            <Chip
              color="success"
              startContent={<ShieldCheck size={14} />}
              variant="flat"
            >
              购买安装后开放入口
            </Chip>
          </div>
          <h1>安装可用的运营应用</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-default-500">
            应用市场负责购买、安装和卸载；业务数据由系统长期保留，卸载不会删除历史数据。
          </p>
        </div>
        <Button
          as={Link}
          className="rounded-[8px] font-semibold"
          color="primary"
          endContent={<ArrowRight size={16} />}
          href="/apps/ai-employee"
        >
          查看 AI员工能力
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card className="border border-default-200 bg-content1 shadow-sm">
          <CardHeader className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
                <Bot size={24} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                    企业微信 AI 客服助手
                  </h2>
                  <StatusChip status={wecomStatus} type="wecom" />
                </div>
                <p className="mt-1 text-sm leading-6 text-default-500">
                  把客户消息整理成 AI 客服回复建议，并通过企业微信群机器人发送到团队群。
                </p>
              </div>
            </div>
            <Button
              as={Link}
              className="rounded-[8px] font-semibold"
              color={wecomInstalled ? "default" : "primary"}
              endContent={<ArrowRight size={16} />}
              href="/engagement/wecom-assistant"
              variant={wecomInstalled ? "flat" : "solid"}
            >
              {wecomInstalled ? "打开管理" : "进入安装"}
            </Button>
          </CardHeader>
          <Divider />
          <CardBody className="gap-5 p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-1">
              <CapabilityItem
                description="粘贴企业微信通知地址，验证成功后保存。"
                icon={<PlugZap size={16} />}
                title="群机器人连接"
              />
              <CapabilityItem
                description="根据客户消息生成回复建议，并正式发送到企业微信群。"
                icon={<MessageSquareText size={16} />}
                title="回复建议推送"
              />
              <CapabilityItem
                description="支持品牌、门店、回复风格和转人工关键词。"
                icon={<Settings2 size={16} />}
                title="客服规则配置"
              />
            </div>
          </CardBody>
        </Card>

        <Card className="border border-default-200 bg-content1 shadow-sm">
          <CardHeader className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-success/10 text-success">
                <UsersRound size={24} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                    CRM 客户管理
                  </h2>
                  <StatusChip status={crmStatus} type="crm" />
                  <Chip
                    color={crmCommercialBlocked ? "danger" : "success"}
                    size="sm"
                    variant="flat"
                  >
                    {crmCommercialLabel}
                  </Chip>
                </div>
                <p className="mt-1 text-sm leading-6 text-default-500">
                  统一管理获客线索、客户档案、跟进记录和客户来源。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {crmInstalled && !crmCommercialBlocked ? (
                <Button
                  as={Link}
                  className="rounded-[8px] font-semibold"
                  color="primary"
                  endContent={<ArrowRight size={16} />}
                  href="/crm"
                >
                  打开 CRM
                </Button>
              ) : (
                <Button
                  className="rounded-[8px] font-semibold"
                  color="primary"
                  isDisabled={
                    crmCommercialBlocked ||
                    crmState?.access?.primaryAction === "contact_sales"
                  }
                  isLoading={crmBusy || crmLoading}
                  onPress={handleCrmPrimaryAction}
                  startContent={
                    !crmBusy && !crmLoading ? <CreditCard size={16} /> : null
                  }
                >
                  {crmPrimaryLabel}
                </Button>
              )}
              {crmState?.purchased ? (
                <Button
                  className="rounded-[8px] font-semibold"
                  isDisabled={!crmInstalled}
                  isLoading={crmBusy && crmInstalled}
                  onPress={handleCrmUninstall}
                  variant="flat"
                >
                  卸载
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="gap-5 p-5">
            <div
              className={`rounded-[8px] border p-4 ${
                crmCommercialBlocked
                  ? "border-danger/25 bg-danger/10"
                  : "border-primary/20 bg-primary/10"
              }`}
            >
              <div className="flex items-start gap-3">
                <ShieldCheck
                  className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
                    crmCommercialBlocked ? "text-danger" : "text-primary"
                  }`}
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                    CRM 可用条件
                  </p>
                  <p className="mt-1 text-xs leading-5 text-default-600">
                    {crmAccessText}
                  </p>
                  {crmAccessBlockers.length ? (
                    <p className="mt-2 text-xs text-danger">
                      {crmAccessBlockers.join(" / ")}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-1">
              <CapabilityItem
                description="集中管理客户资料、来源和跟进记录。"
                icon={<DatabaseZap size={16} />}
                title="客户档案"
              />
              <CapabilityItem
                description="后续自动获客成功后可沉淀到 CRM，未安装时只保留任务记录。"
                icon={<DatabaseZap size={16} />}
                title="获客线索承接"
              />
              <CapabilityItem
                description="完成开通和安装后，客户管理入口会自动显示。"
                icon={<CheckCircle2 size={16} />}
                title="入口状态"
              />
            </div>

            <div className="rounded-[8px] border border-success/20 bg-success/10 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" />
                <div>
                  <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                    使用步骤
                  </p>
                  <p className="mt-1 text-xs leading-5 text-default-600">
                    购买并安装后即可开始管理客户。
                  </p>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
