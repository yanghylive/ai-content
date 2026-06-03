"use client";

import React from "react";
import {
    Button,
    Card,
    CardBody,
    Chip,
    Spinner,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableColumn,
    TableHeader,
    TableRow,
    addToast,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { SimpleFeaturePage } from "../../agent-workbench/agent-workbench-client";
import { riskPolicyApi, type RiskPolicy } from "@/lib/api/local-engine";
import { authApi, type AuthUser } from "@/lib/api/auth";

function RiskPolicySection() {
    const [policies, setPolicies] = React.useState<RiskPolicy[]>([]);
    const [currentUser, setCurrentUser] = React.useState<AuthUser | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState<string | null>(null);
    const [saving, setSaving] = React.useState<string | null>(null);
    const [draft, setDraft] = React.useState<Record<string, Partial<RiskPolicy>>>({});
    const canEditPolicies =
        currentUser?.kaypalRole === "SUPER_ADMIN" ||
        currentUser?.kaypalPlatformRole === "SUPER_ADMIN";

    const loadPolicies = React.useCallback(() => {
        setLoading(true);
        setLoadError(null);
        Promise.all([
            riskPolicyApi.list(),
            authApi.me().catch(() => null),
        ])
            .then(([list, user]) => {
                setPolicies(list);
                setCurrentUser(user);
            })
            .catch((error: unknown) => {
                setPolicies([]);
                setLoadError(error instanceof Error ? error.message : "风控策略读取失败");
            })
            .finally(() => setLoading(false));
    }, []);

    React.useEffect(() => {
        loadPolicies();
    }, [loadPolicies]);

    const updateDraft = (action: string, field: keyof RiskPolicy, value: boolean) => {
        setDraft((prev) => ({
            ...prev,
            [action]: { ...prev[action], [field]: value },
        }));
    };

    const handleSave = async (policy: RiskPolicy) => {
        const changes = draft[policy.action];
        if (!changes) return;
        if (!canEditPolicies) {
            addToast({
                title: "当前为只读",
                description: "修改风控策略需要 Kaypal SUPER_ADMIN 或租户 owner 权限。",
                color: "warning",
            });
            return;
        }
        setSaving(policy.action);
        try {
            const updated = await riskPolicyApi.update(policy.action, changes);
            setPolicies((prev) => prev.map((p) => (p.action === updated.action ? updated : p)));
            setDraft((prev) => {
                const next = { ...prev };
                delete next[policy.action];
                return next;
            });
            addToast({ title: "策略已更新", description: policy.action, color: "success" });
        } catch (e: unknown) {
            addToast({
                title: "更新失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setSaving(null);
        }
    };

    const getVal = (policy: RiskPolicy, field: "requireConfirm" | "autoExecute" | "forbidden") => {
        return draft[policy.action]?.[field] ?? policy[field];
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-6 justify-center">
                <Spinner size="sm" />
                <span className="text-small text-default-500">加载风控策略...</span>
            </div>
        );
    }

    if (loadError) {
        return (
            <Card className="border-small border-danger-200 bg-danger-50 shadow-sm">
                <CardBody className="gap-3">
                    <div className="flex items-start gap-3">
                        <Icon className="mt-0.5 text-danger-600" icon="solar:danger-triangle-linear" width={22} />
                        <div className="flex-1">
                            <p className="text-small font-semibold text-danger-700">风控策略读取失败</p>
                            <p className="mt-1 text-small text-danger-600">{loadError}</p>
                            <p className="mt-1 text-tiny text-danger-500">
                                发布、发送、删除、远程接管等高风险动作仍以后端实际拦截为准；请先确认登录态、套餐权限和后端服务状态。
                            </p>
                        </div>
                    </div>
                    <div>
                        <Button color="danger" size="sm" variant="flat" onPress={loadPolicies}>
                            重新读取
                        </Button>
                    </div>
                </CardBody>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody>
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <p className="text-small font-semibold text-default-800">后端确认策略</p>
                                <p className="text-tiny text-default-500 mt-1">
                                    发布、删除账号、发送/草稿、Agent 确认、远程接管等高风险动作必须带后端确认记录；套餐只决定是否有权限执行，不允许前端本地开关绕过确认。
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Chip color="primary" variant="flat">后端强制确认</Chip>
                                <Chip color="warning" variant="flat">前端不可绕过</Chip>
                                <Chip color={canEditPolicies ? "success" : "default"} variant="flat">
                                    {canEditPolicies ? "可编辑" : "只读"}
                                </Chip>
                            </div>
                        </div>
                    </div>
                </CardBody>
            </Card>

            {currentUser ? (
                <Card className="border-small border-divider bg-background shadow-sm">
                    <CardBody>
                        <div className="flex flex-wrap items-center gap-3 text-small">
                            <p className="font-semibold text-default-800">当前权限</p>
                            <Chip size="sm" variant="flat">
                                管理角色：{currentUser.kaypalRole || "无"}
                            </Chip>
                            <Chip size="sm" variant="flat">
                                平台角色：{currentUser.kaypalPlatformRole || "无"}
                            </Chip>
                            <Chip
                                color={currentUser.kaypalPlan === "FREE" ? "default" : "primary"}
                                size="sm"
                                variant="flat"
                            >
                                套餐：{currentUser.kaypalPlan || "FREE"}
                            </Chip>
                            {!canEditPolicies ? (
                                <span className="text-tiny text-default-500">
                                    修改风控策略需要 Kaypal SUPER_ADMIN 或租户 owner 权限。
                                </span>
                            ) : null}
                        </div>
                    </CardBody>
                </Card>
            ) : null}

            {policies.length > 0 ? (
                <Card className="border-small border-divider bg-background shadow-sm">
                    <CardBody className="p-0">
                        <Table aria-label="风控策略配置表" removeWrapper>
                            <TableHeader>
                                <TableColumn>动作</TableColumn>
                                <TableColumn>来源</TableColumn>
                                <TableColumn>风险等级</TableColumn>
                                <TableColumn>需确认</TableColumn>
                                <TableColumn>自动执行</TableColumn>
                                <TableColumn>禁止</TableColumn>
                                <TableColumn>最低套餐</TableColumn>
                                <TableColumn>操作</TableColumn>
                            </TableHeader>
                            <TableBody>
                                {policies.map((policy) => (
                                    <TableRow key={policy.action}>
                                        <TableCell>
                                            <span className="text-small font-medium">{policy.action}</span>
                                            {policy.description ? (
                                                <p className="mt-1 text-tiny text-default-400">{policy.description}</p>
                                            ) : null}
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                color={policy.source === "custom" ? "primary" : "default"}
                                                size="sm"
                                                variant="flat"
                                            >
                                                {policy.source === "custom" ? "自定义" : "默认"}
                                            </Chip>
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                color={
                                                    policy.riskLevel === "high"
                                                        ? "danger"
                                                        : policy.riskLevel === "medium"
                                                            ? "warning"
                                                            : "default"
                                                }
                                                size="sm"
                                                variant="flat"
                                            >
                                                {policy.riskLevel}
                                            </Chip>
                                        </TableCell>
                                        <TableCell>
                                            <Switch
                                                isDisabled={!canEditPolicies}
                                                isSelected={getVal(policy, "requireConfirm")}
                                                size="sm"
                                                onValueChange={(v) => updateDraft(policy.action, "requireConfirm", v)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Switch
                                                isDisabled={!canEditPolicies}
                                                isSelected={getVal(policy, "autoExecute")}
                                                size="sm"
                                                onValueChange={(v) => updateDraft(policy.action, "autoExecute", v)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Switch
                                                isDisabled={!canEditPolicies}
                                                isSelected={getVal(policy, "forbidden")}
                                                size="sm"
                                                onValueChange={(v) => updateDraft(policy.action, "forbidden", v)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Chip size="sm" variant="bordered">{policy.minPlan}</Chip>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                isDisabled={!canEditPolicies || !draft[policy.action]}
                                                isLoading={saving === policy.action}
                                                size="sm"
                                                variant="flat"
                                                onPress={() => handleSave(policy)}
                                            >
                                                {canEditPolicies ? "保存" : "只读"}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardBody>
                </Card>
            ) : (
                <Card className="border-small border-divider bg-background shadow-sm">
                    <CardBody>
                        <p className="text-small text-default-400 text-center py-4">暂无风控策略数据</p>
                    </CardBody>
                </Card>
            )}
        </div>
    );
}

export default function Page() {
    return (
        <SimpleFeaturePage
            title="权限风控"
            description="统一管理发布、发送、删除、改文件、扣费和外部提交等动作的确认策略。"
            icon="solar:shield-check-linear"
            capabilityKey="permission-check"
            localEngineTab="permissions"
            primaryAction={{ label: "处理待确认", href: "/confirmations", icon: "solar:check-square-linear" }}
            items={[
                "定义哪些动作必须进待我确认，哪些动作允许自动执行。",
                "确认卡统一展示账号、目标、内容、当前窗口和影响范围。",
                "失败提示统一显示动作名、影响对象、当前阶段、未执行动作、下一步和证据数。",
                "风控规则同时作用于发布中心、互动中心和智能任务。",
            ]}
        >
            <RiskPolicySection />
        </SimpleFeaturePage>
    );
}
