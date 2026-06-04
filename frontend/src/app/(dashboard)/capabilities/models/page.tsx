"use client";

import React from "react";
import { Button, Card, CardBody, Chip, Select, SelectItem, Spinner, addToast } from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { SimpleFeaturePage } from "../../agent-workbench/agent-workbench-client";
import { settingsApi, type AIModel, type DefaultModels } from "@/lib/api/settings";

function ModelHealthSection() {
    const [models, setModels] = React.useState<AIModel[]>([]);
    const [defaults, setDefaults] = React.useState<DefaultModels | null>(null);
    const [selectedModelId, setSelectedModelId] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    const [testing, setTesting] = React.useState(false);

    const load = React.useCallback(() => {
        setLoading(true);
        Promise.all([
            settingsApi.listModels(),
            settingsApi.getDefaults().catch(() => null),
        ])
            .then(([modelList, defaultConfig]) => {
                setModels(modelList);
                setDefaults(defaultConfig);
                setSelectedModelId((prev) => prev || defaultConfig?.articleCreation || modelList[0]?.id || "");
            })
            .catch((error: unknown) => {
                addToast({
                    title: "模型配置读取失败",
                    description: error instanceof Error ? error.message : "请稍后重试",
                    color: "danger",
                });
            })
            .finally(() => setLoading(false));
    }, []);

    React.useEffect(() => {
        load();
    }, [load]);

    const selectedModel = models.find((model) => model.id === selectedModelId);

    const handleTest = async () => {
        if (!selectedModel) {
            addToast({ title: "没有可测试模型", description: "请先在系统配置里添加并启用 AI 模型。", color: "warning" });
            return;
        }
        setTesting(true);
        try {
            const result = await settingsApi.testModel({
                platformId: selectedModel.platformId,
                modelId: selectedModel.modelId,
            });
            if (result.success) {
                addToast({ title: "模型测试通过", description: result.reply || "AI 模型连接正常", color: "success" });
            } else {
                addToast({ title: "模型测试失败", description: result.message, color: "danger" });
            }
        } catch (e: unknown) {
            addToast({
                title: "模型测试失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-6 justify-center">
                <Spinner size="sm" />
                <span className="text-small text-default-500">读取模型配置...</span>
            </div>
        );
    }

    const defaultPairs = defaults
        ? [
            ["文章创作", defaults.articleCreation],
            ["图片创作", defaults.imageCreation],
            ["采集分析", defaults.xCollection],
            ["选题推荐", defaults.topicSelection],
        ]
        : [];

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="flex-1">
                        <p className="text-small font-semibold text-default-800">真实模型连接</p>
                        <p className="mt-1 text-tiny text-default-500">
                            读取系统配置中的 AI 模型，调用后端 /ai-models/test 做真实连接测试。
                        </p>
                    </div>
                    <Button
                        as="a"
                        href="/settings"
                        startContent={<Icon icon="solar:settings-outline" />}
                        variant="flat"
                    >
                        系统配置
                    </Button>
                </div>

                {models.length ? (
                    <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                        <Select
                            label="测试模型"
                            labelPlacement="outside"
                            selectedKeys={selectedModelId ? [selectedModelId] : []}
                            onSelectionChange={(keys) => setSelectedModelId(String(Array.from(keys)[0] || ""))}
                        >
                            {models.map((model) => (
                                <SelectItem key={model.id}>
                                    {model.name} / {model.modelId}
                                </SelectItem>
                            ))}
                        </Select>
                        <Button
                            color="primary"
                            variant="flat"
                            isLoading={testing}
                            startContent={testing ? null : <Icon icon="solar:bolt-linear" />}
                            onPress={handleTest}
                        >
                            真实测试
                        </Button>
                    </div>
                ) : (
                    <div className="rounded-[10px] border-small border-warning-200 bg-warning-50 px-3 py-2">
                        <p className="text-small font-semibold text-warning-700">未配置 AI 模型</p>
                        <p className="mt-1 text-tiny text-warning-600">内容生成、选题推荐和回复生成会被阻断或降级；请先到系统配置添加模型。</p>
                    </div>
                )}

                <div className="flex flex-wrap gap-2">
                    <Chip color={models.length ? "success" : "warning"} size="sm" variant="flat">
                        模型 {models.length}
                    </Chip>
                    {defaultPairs.map(([label, id]) => (
                        <Chip key={label} color={id ? "primary" : "default"} size="sm" variant="flat">
                            {label}{id ? " 已配置" : " 未配置"}
                        </Chip>
                    ))}
                </div>
            </CardBody>
        </Card>
    );
}

export default function Page() {
    return (
        <SimpleFeaturePage
            title="AI模型"
            description="配置内容生成、回复生成、任务规划和证据总结使用的模型策略。"
            icon="solar:cpu-bolt-linear"
            capabilityKey="permission-check"
            localEngineTab="permissions"
            primaryAction={{ label: "执行前检查", href: "/local-engine?tab=permissions", icon: "solar:shield-check-linear" }}
            items={[
                "按内容生产、互动回复、Agent 规划、诊断总结拆分默认模型。",
                "显示额度、套餐限制、失败降级策略和调用日志入口。",
                "敏感任务可要求更强模型和人工确认。",
                "模型配置走线上账号体系，避免每台机器重复配置。",
            ]}
        >
            <ModelHealthSection />
        </SimpleFeaturePage>
    );
}
