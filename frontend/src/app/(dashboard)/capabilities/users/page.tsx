"use client";

import React from "react";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";
import { ExternalLink, ShieldCheck, UsersRound } from "lucide-react";

const KAYPAL_ACCOUNT_URL = "https://test.kaypal.cn";

export default function UsersManagementPage() {
    return (
        <div className="flex w-full max-w-[960px] flex-col gap-4 p-4 md:p-6">
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardHeader className="flex flex-col items-start gap-2">
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
                            <UsersRound size={20} />
                        </div>
                        <div>
                            <h1 className="text-xl font-semibold">Kaypal 账号体系</h1>
                            <p className="mt-1 text-small text-default-500">
                                当前内容工作台不在本地维护用户、角色和组织成员。
                            </p>
                        </div>
                    </div>
                </CardHeader>
                <CardBody className="gap-4 text-small text-default-600">
                    <p>
                        用户登录、组织成员、套餐权限、角色和设备授权都以 Kaypal 线上系统为准。
                        3010 本地工作台只读取授权结果，不提供本地用户管理能力。
                    </p>
                    <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-[8px] border border-divider p-4">
                            <Chip size="sm" color="primary" variant="flat">登录来源</Chip>
                            <p className="mt-3 font-medium text-default-900">Kaypal 单点登录</p>
                            <p className="mt-1 text-tiny text-default-500">本地只保存授权会话，不保存线上账号体系。</p>
                        </div>
                        <div className="rounded-[8px] border border-divider p-4">
                            <Chip size="sm" color="success" variant="flat">权限来源</Chip>
                            <p className="mt-3 font-medium text-default-900">线上套餐与组织权限</p>
                            <p className="mt-1 text-tiny text-default-500">能否使用能力，以 Kaypal 后台返回为准。</p>
                        </div>
                        <div className="rounded-[8px] border border-divider p-4">
                            <Chip size="sm" color="warning" variant="flat">本地职责</Chip>
                            <p className="mt-3 font-medium text-default-900">执行与设备状态</p>
                            <p className="mt-1 text-tiny text-default-500">本地负责运行环境、平台账号和任务执行。</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 border-t border-divider pt-4">
                        <Button
                            color="primary"
                            startContent={<ExternalLink size={16} />}
                            onPress={() => window.open(KAYPAL_ACCOUNT_URL, "_blank", "noopener,noreferrer")}
                        >
                            打开 Kaypal 后台
                        </Button>
                        <Button
                            variant="flat"
                            startContent={<ShieldCheck size={16} />}
                            onPress={() => window.location.assign("/capabilities/account")}
                        >
                            查看本机账号与设备
                        </Button>
                    </div>
                </CardBody>
            </Card>
        </div>
    );
}
