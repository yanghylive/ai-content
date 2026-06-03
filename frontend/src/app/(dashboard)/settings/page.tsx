"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
    Button,
    Card,
    Chip,
    Divider,
    Input,
    Select,
    SelectItem,
    Spinner,
    Switch,
    Tab,
    Tabs,
    addToast,
} from "@heroui/react";
import { Icon, loadIcons } from "@iconify/react";
import {
    type Source,
    type StorageConfig,
    sourcesApi,
    storageApi,
} from "@/lib/api/settings";

const emptyStorageConfig: StorageConfig = {
    provider: "local",
    accessKey: "",
    secretKey: "",
    bucket: "",
    domain: "",
    endpoint: "",
    region: "",
};

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

export default function SettingsPage() {
    useEffect(() => {
        loadIcons([
            "solar:global-bold",
            "solar:cloud-storage-bold",
            "solar:add-circle-bold",
            "solar:programming-bold",
            "solar:folder-with-files-linear",
            "solar:server-bold-duotone",
        ]);
    }, []);

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <header className="flex items-center justify-between gap-3 rounded-medium border-small border-divider bg-background p-4 shadow-sm">
                <h2 className="text-large font-bold text-default-900">系统配置中心</h2>
                <Button
                    color="primary"
                    variant="flat"
                    startContent={<Icon icon="solar:programming-bold" />}
                >
                    查看系统日志
                </Button>
            </header>

            <Card className="border-small border-white/10 bg-background/60 shadow-medium backdrop-blur-md dark:bg-default-100/50">
                <Tabs
                    classNames={{
                        tabList: "mx-4 mt-6 bg-default-100/50 text-medium",
                        tabContent: "text-small",
                        panel: "p-6",
                    }}
                    size="lg"
                >
                    <Tab
                        key="sources"
                        title={
                            <div className="flex items-center gap-2">
                                <Icon icon="solar:global-bold" width={20} />
                                <span>采集源配置</span>
                            </div>
                        }
                    >
                        <SourceSettings />
                    </Tab>
                    <Tab
                        key="storage"
                        title={
                            <div className="flex items-center gap-2">
                                <Icon icon="solar:cloud-storage-bold" width={20} />
                                <span>存储配置</span>
                            </div>
                        }
                    >
                        <StorageSettings />
                    </Tab>
                </Tabs>
            </Card>
        </div>
    );
}

function SourceSettings() {
    const [sources, setSources] = useState<Source[]>([]);
    const [loading, setLoading] = useState(true);

    const loadSources = useCallback(async () => {
        try {
            setLoading(true);
            const data = await sourcesApi.list();
            setSources(data);
        } catch (error) {
            addToast({
                title: "加载信息源失败",
                description: getErrorMessage(error),
                color: "danger",
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSources();
    }, [loadSources]);

    const handleSeed = async () => {
        try {
            const result = await sourcesApi.seed();
            addToast({
                title: "初始化完成",
                description: `新增 ${result.created} 个，跳过 ${result.skipped} 个`,
                color: "success",
            });
            await loadSources();
        } catch (error) {
            addToast({
                title: "初始化失败",
                description: getErrorMessage(error),
                color: "danger",
            });
        }
    };

    const handleToggle = async (id: string) => {
        try {
            await sourcesApi.toggle(id);
            setSources((prev) =>
                prev.map((source) =>
                    source.id === id ? { ...source, enabled: !source.enabled } : source,
                ),
            );
        } catch (error) {
            addToast({
                title: "切换失败",
                description: getErrorMessage(error),
                color: "danger",
            });
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner size="lg" />
            </div>
        );
    }

    if (sources.length === 0) {
        return (
            <div className="flex flex-col items-center gap-4 py-12">
                <Icon icon="solar:global-bold" width={48} className="text-default-300" />
                <p className="text-default-500">尚未配置信息源</p>
                <Button
                    color="primary"
                    onPress={handleSeed}
                    startContent={<Icon icon="solar:add-circle-bold" />}
                >
                    初始化默认渠道
                </Button>
            </div>
        );
    }

    return (
        <div className="flex max-w-4xl flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-medium font-bold">内容采集源配置</h3>
                    <p className="mt-1 text-small text-default-500">
                        管理自动采集任务的目标平台和爬虫参数
                    </p>
                </div>
                <Button
                    size="sm"
                    variant="flat"
                    onPress={handleSeed}
                    startContent={<Icon icon="solar:add-circle-bold" />}
                >
                    重新初始化
                </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {sources.map((source) => (
                    <div
                        key={source.id}
                        className="flex items-center justify-between rounded-medium border border-divider bg-default-50/50 p-4"
                    >
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="font-medium">{source.name}</span>
                                <Chip size="sm" variant="flat" color="primary">
                                    {source.type}
                                </Chip>
                            </div>
                            <p className="mt-1 max-w-[300px] truncate text-small text-default-500">
                                {source.url}
                            </p>
                            {source.lastCrawlTime ? (
                                <p className="mt-1 text-tiny text-default-400">
                                    上次采集: {new Date(source.lastCrawlTime).toLocaleString("zh-CN")}
                                </p>
                            ) : null}
                        </div>
                        <Switch
                            color="success"
                            size="sm"
                            isSelected={source.enabled}
                            onValueChange={() => handleToggle(source.id)}
                        />
                    </div>
                ))}
            </div>

            <Divider className="my-2" />

            <h3 className="text-medium font-bold">爬虫基础设置</h3>
            <div className="flex flex-col gap-4">
                <Input
                    label="请求超时时间 (秒)"
                    type="number"
                    defaultValue="30"
                    labelPlacement="outside"
                />
                <Input
                    label="爬虫代理 IP (Proxy URL)"
                    placeholder="http://127.0.0.1:7890"
                    labelPlacement="outside"
                />
            </div>
        </div>
    );
}

function StorageSettings() {
    const [config, setConfig] = useState<StorageConfig>(emptyStorageConfig);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        storageApi
            .getConfig()
            .then((data) => setConfig({ ...emptyStorageConfig, ...(data || {}) }))
            .catch((error) =>
                addToast({
                    title: "加载失败",
                    description: getErrorMessage(error),
                    color: "danger",
                }),
            )
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        try {
            setSaving(true);
            await storageApi.updateConfig(config);
            addToast({
                title: "保存成功",
                description:
                    config.provider === "local" ? "已使用本地存储" : "对象存储配置已保存",
                color: "success",
            });
        } catch (error) {
            addToast({
                title: "保存失败",
                description: getErrorMessage(error),
                color: "danger",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        try {
            setTesting(true);
            const result = await storageApi.testConnection();
            addToast({
                title: result.success ? "连接成功" : "连接失败",
                description: result.message,
                color: result.success ? "success" : "danger",
            });
        } catch (error) {
            addToast({
                title: "测试异常",
                description: getErrorMessage(error),
                color: "danger",
            });
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner size="lg" />
            </div>
        );
    }

    const isRemoteStorage = config.provider !== "local";
    const isAliyunOss = config.provider === "aliyun-oss";

    return (
        <div className="flex max-w-2xl flex-col gap-6">
            <div>
                <h3 className="text-medium font-bold">存储配置</h3>
                <p className="mt-1 text-small text-default-500">
                    选择素材、图片和生成文件的保存方式。本地存储适合单机使用；对象存储适合多设备访问和长期保存。
                </p>
            </div>

            <div className="flex flex-col gap-4">
                <Select
                    label="存储方式"
                    selectedKeys={[config.provider || "local"]}
                    onSelectionChange={(keys) => {
                        const provider = Array.from(keys)[0] as StorageConfig["provider"];
                        if (!provider) return;
                        setConfig((prev) => ({ ...prev, provider }));
                    }}
                    labelPlacement="outside"
                    disallowEmptySelection
                >
                    <SelectItem key="local">本地存储</SelectItem>
                    <SelectItem key="aliyun-oss">对象存储 - 阿里 OSS</SelectItem>
                    <SelectItem key="qiniu">对象存储 - 七牛云</SelectItem>
                </Select>

                {config.provider === "local" ? (
                    <div className="rounded-medium border border-divider bg-default-50/60 p-4">
                        <div className="flex items-start gap-3">
                            <Icon
                                icon="solar:folder-with-files-linear"
                                width={24}
                                className="mt-0.5 text-primary"
                            />
                            <div>
                                <p className="font-medium">当前使用本地存储</p>
                                <p className="mt-1 text-small text-default-500">
                                    文件保存在本机运行环境内，不需要填写云厂商密钥。适合本地桌面版和单机部署。
                                </p>
                            </div>
                        </div>
                    </div>
                ) : null}

                {isRemoteStorage ? (
                    <>
                        <Select
                            label="对象存储服务商"
                            selectedKeys={[config.provider]}
                            onSelectionChange={(keys) => {
                                const provider = Array.from(keys)[0] as StorageConfig["provider"];
                                if (!provider || provider === "local") return;
                                setConfig((prev) => ({ ...prev, provider }));
                            }}
                            labelPlacement="outside"
                            disallowEmptySelection
                        >
                            <SelectItem key="aliyun-oss">阿里 OSS</SelectItem>
                            <SelectItem key="qiniu">七牛云</SelectItem>
                        </Select>
                        <Input
                            label="Access Key"
                            placeholder={isAliyunOss ? "阿里云 AccessKey ID" : "七牛云 Access Key"}
                            value={config.accessKey}
                            onChange={(event) =>
                                setConfig({ ...config, accessKey: event.target.value })
                            }
                            labelPlacement="outside"
                        />
                        <Input
                            label="Secret Key"
                            placeholder={isAliyunOss ? "阿里云 AccessKey Secret" : "七牛云 Secret Key"}
                            type="password"
                            value={config.secretKey}
                            onChange={(event) =>
                                setConfig({ ...config, secretKey: event.target.value })
                            }
                            labelPlacement="outside"
                        />
                        <Input
                            label="Bucket 名称"
                            placeholder={isAliyunOss ? "例如：kaypal-content-assets" : "例如：my-ai-images"}
                            value={config.bucket}
                            onChange={(event) =>
                                setConfig({ ...config, bucket: event.target.value })
                            }
                            labelPlacement="outside"
                        />
                        <Input
                            label="访问域名"
                            placeholder="例如：https://cdn.example.com"
                            value={config.domain}
                            onChange={(event) =>
                                setConfig({ ...config, domain: event.target.value })
                            }
                            labelPlacement="outside"
                            description="对象访问域名，文件将以 {域名}/{路径}/{文件名} 的格式访问"
                        />
                        {isAliyunOss ? (
                            <>
                                <Input
                                    label="Endpoint"
                                    placeholder="例如：https://oss-cn-hangzhou.aliyuncs.com"
                                    value={config.endpoint || ""}
                                    onChange={(event) =>
                                        setConfig({ ...config, endpoint: event.target.value })
                                    }
                                    labelPlacement="outside"
                                />
                                <Input
                                    label="Region"
                                    placeholder="例如：oss-cn-hangzhou"
                                    value={config.region || ""}
                                    onChange={(event) =>
                                        setConfig({ ...config, region: event.target.value })
                                    }
                                    labelPlacement="outside"
                                />
                            </>
                        ) : null}
                    </>
                ) : null}
            </div>

            <div className="flex items-center justify-between pt-2">
                <Button
                    color="secondary"
                    variant="flat"
                    isLoading={testing}
                    isDisabled={!isRemoteStorage}
                    startContent={!testing && <Icon icon="solar:server-bold-duotone" />}
                    onPress={handleTest}
                >
                    测试连接
                </Button>
                <Button color="primary" isLoading={saving} onPress={handleSave}>
                    保存配置
                </Button>
            </div>
        </div>
    );
}
