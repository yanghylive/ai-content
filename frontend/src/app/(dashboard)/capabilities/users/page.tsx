"use client";

import React from "react";
import {
    Card,
    CardBody,
    CardHeader,
    Chip,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableColumn,
    TableHeader,
    TableRow,
    Select,
    SelectItem,
    Switch,
    Button,
    addToast,
} from "@heroui/react";
import { api } from "@/lib/api/client";

interface UserRow {
    id: string;
    username: string;
    email: string;
    name: string;
    status: string;
    role: string;
    commercialExecutionAllowed: boolean;
    planMode: string;
    lastLoginAt: string | null;
    createdAt: string;
    updatedAt: string;
}

const ROLE_OPTIONS = [
    { value: "operator", label: "操作员", desc: "可发起任务，不能批高风险" },
    { value: "manager", label: "经理", desc: "可批高风险" },
    { value: "admin", label: "管理员", desc: "全部权限 + 改其他用户角色" },
];

const PLAN_OPTIONS = [
    { value: "trial", label: "试用", desc: "试用模式，有阻断" },
    { value: "commercial", label: "商用", desc: "商用模式，可自动发送" },
];

export default function UsersManagementPage() {
    const [users, setUsers] = React.useState<UserRow[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [currentRole, setCurrentRole] = React.useState<string>("operator");
    const [busyId, setBusyId] = React.useState("");

    const load = React.useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ success: boolean; data: UserRow }>("/auth/me");
            setCurrentRole((res as any).data?.role ?? "operator");
        } catch {
            setCurrentRole("operator");
        }
        try {
            const res = await api.get<UserRow[]>("/auth/users");
            setUsers(res as any);
        } catch (error: unknown) {
            addToast({
                title: "用户列表读取失败",
                description: error instanceof Error ? error.message : "请确认当前账号是 admin",
                color: "danger",
            });
            setUsers([]);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        load();
    }, [load]);

    const update = async (
        id: string,
        patch: { role?: string; planMode?: string; commercialExecutionAllowed?: boolean },
    ) => {
        setBusyId(id);
        try {
            await api.patch(`/auth/users/${id}/role`, patch);
            addToast({ title: "已更新", color: "success" });
            await load();
        } catch (error: unknown) {
            addToast({
                title: "更新失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setBusyId("");
        }
    };

    const isAdmin = currentRole === "admin";

    return (
        <div className="flex flex-col gap-4 p-4 md:p-6">
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardHeader className="flex flex-col items-start gap-1">
                    <h1 className="text-xl font-semibold">用户与权限</h1>
                    <p className="text-small text-default-500">
                        管理系统账号的角色、计划模式与商用执行权限。
                        {isAdmin
                            ? "你以 admin 身份登录，可以改任何用户。"
                            : "只读视图——只有 admin 角色可改。"}
                    </p>
                </CardHeader>
            </Card>

            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Spinner size="sm" />
                        </div>
                    ) : (
                        <Table aria-label="用户列表" removeWrapper>
                            <TableHeader>
                                <TableColumn>账号</TableColumn>
                                <TableColumn>角色</TableColumn>
                                <TableColumn>计划</TableColumn>
                                <TableColumn>商用发送</TableColumn>
                                <TableColumn>状态</TableColumn>
                                <TableColumn>最近登录</TableColumn>
                            </TableHeader>
                            <TableBody emptyContent="没有用户">
                                {users.map((u) => (
                                    <TableRow key={u.id}>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-medium">{u.name}</span>
                                                <span className="text-tiny text-default-500">
                                                    {u.username} · {u.email}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {isAdmin ? (
                                                <Select
                                                    aria-label="角色"
                                                    size="sm"
                                                    selectedKeys={[u.role]}
                                                    isDisabled={busyId === u.id}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        if (v && v !== u.role) {
                                                            update(u.id, { role: v });
                                                        }
                                                    }}
                                                    className="min-w-[140px]"
                                                >
                                                    {ROLE_OPTIONS.map((r) => (
                                                        <SelectItem key={r.value}>
                                                            {r.label}
                                                        </SelectItem>
                                                    ))}
                                                </Select>
                                            ) : (
                                                <Chip
                                                    size="sm"
                                                    variant="flat"
                                                    color={
                                                        u.role === "admin"
                                                            ? "danger"
                                                            : u.role === "manager"
                                                                ? "warning"
                                                                : "default"
                                                    }
                                                >
                                                    {ROLE_OPTIONS.find((r) => r.value === u.role)?.label ??
                                                        u.role}
                                                </Chip>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {isAdmin ? (
                                                <Select
                                                    aria-label="计划"
                                                    size="sm"
                                                    selectedKeys={[u.planMode]}
                                                    isDisabled={busyId === u.id}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        if (v && v !== u.planMode) {
                                                            update(u.id, { planMode: v });
                                                        }
                                                    }}
                                                    className="min-w-[120px]"
                                                >
                                                    {PLAN_OPTIONS.map((p) => (
                                                        <SelectItem key={p.value}>
                                                            {p.label}
                                                        </SelectItem>
                                                    ))}
                                                </Select>
                                            ) : (
                                                <Chip size="sm" variant="flat">
                                                    {PLAN_OPTIONS.find((p) => p.value === u.planMode)?.label ??
                                                        u.planMode}
                                                </Chip>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {isAdmin ? (
                                                <Switch
                                                    size="sm"
                                                    isSelected={u.commercialExecutionAllowed}
                                                    isDisabled={busyId === u.id}
                                                    onValueChange={(v) =>
                                                        update(u.id, { commercialExecutionAllowed: v })
                                                    }
                                                />
                                            ) : (
                                                <Chip
                                                    size="sm"
                                                    variant="flat"
                                                    color={u.commercialExecutionAllowed ? "success" : "default"}
                                                >
                                                    {u.commercialExecutionAllowed ? "允许" : "禁止"}
                                                </Chip>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                size="sm"
                                                variant="flat"
                                                color={u.status === "active" ? "success" : "default"}
                                            >
                                                {u.status === "active" ? "活跃" : "停用"}
                                            </Chip>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-tiny text-default-500">
                                                {u.lastLoginAt
                                                    ? new Date(u.lastLoginAt).toLocaleString("zh-CN")
                                                    : "从未登录"}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardBody>
            </Card>

            <Card className="border-small border-divider bg-background shadow-sm">
                <CardHeader>
                    <h2 className="text-base font-semibold">角色说明</h2>
                </CardHeader>
                <CardBody className="flex flex-col gap-3 text-small">
                    {ROLE_OPTIONS.map((r) => (
                        <div key={r.value} className="flex items-start gap-3">
                            <Chip
                                size="sm"
                                variant="flat"
                                color={
                                    r.value === "admin"
                                        ? "danger"
                                        : r.value === "manager"
                                            ? "warning"
                                            : "default"
                                }
                                className="min-w-[80px]"
                            >
                                {r.label}
                            </Chip>
                            <span className="text-default-600">{r.desc}</span>
                        </div>
                    ))}
                    <div className="mt-2 border-t border-divider pt-3 text-tiny text-default-500">
                        商用发送开关允许该用户跳过"确认后发送"，对高风险任务直接自动发送。
                        计划模式：商用模式不再有 approval gate；试用模式需要确认。
                    </div>
                </CardBody>
            </Card>
        </div>
    );
}
