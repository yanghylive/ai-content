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
    Textarea,
    addToast,
} from "@heroui/react";
import { Icon, loadIcons } from "@/components/lucide-icon-compat";
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

type SourceFormState = {
    id?: string;
    name: string;
    type: string;
    url: string;
    enabled: boolean;
    configJson: string;
};

const emptySourceForm: SourceFormState = {
    name: "",
    type: "crawler",
    url: "",
    enabled: true,
    configJson: "{\n  \"platform\": \"\"\n}",
};

const sourceTypeOptions = [
    { key: "crawler", label: "网页采集" },
    { key: "rss", label: "RSS 订阅" },
    { key: "api", label: "API 接口" },
];

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

function toSourceForm(source: Source): SourceFormState {
    return {
        id: source.id,
        name: source.name,
        type: source.type || "crawler",
        url: source.url,
        enabled: source.enabled,
        configJson: JSON.stringify(source.config || {}, null, 2),
    };
}

function parseSourceConfig(configJson: string) {
    const text = configJson.trim();
    if (!text) return {};
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("高级配置必须是 JSON 对象");
    }
    return parsed as Record<string, unknown>;
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
            <header className="flex items-center justify-between gap-3 rounded-[10px] border-small border-divider bg-background p-4 shadow-sm">
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
    const [form, setForm] = useState<SourceFormState | null>(null);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);

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
            setTogglingId(id);
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
        } finally {
            setTogglingId(null);
        }
    };

    const handleSaveSource = async () => {
        if (!form) return;

        const name = form.name.trim();
        const url = form.url.trim();
        if (!name || !url) {
            addToast({
                title: "请补全采集源",
                description: "名称和采集地址不能为空",
                color: "warning",
            });
            return;
        }

        try {
            setSaving(true);
            const payload = {
                name,
                type: form.type,
                url,
                enabled: form.enabled,
                config: parseSourceConfig(form.configJson),
            };

            if (form.id) {
                await sourcesApi.update(form.id, payload);
            } else {
                await sourcesApi.create(payload);
            }

            addToast({
                title: "保存成功",
                description: form.id ? "采集源配置已更新" : "采集源已新增",
                color: "success",
            });
            setForm(null);
            await loadSources();
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

    const handleDeleteSource = async (source: Source) => {
        if (!window.confirm(`确定删除采集源「${source.name}」吗？`)) return;

        try {
            setDeletingId(source.id);
            await sourcesApi.remove(source.id);
            addToast({
                title: "删除成功",
                description: `已删除 ${source.name}`,
                color: "success",
            });
            if (form?.id === source.id) setForm(null);
            await loadSources();
        } catch (error) {
            addToast({
                title: "删除失败",
                description: getErrorMessage(error),
                color: "danger",
            });
        } finally {
            setDeletingId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner size="lg" />
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
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="flat"
                        onPress={handleSeed}
                        startContent={<Icon icon="solar:add-circle-bold" />}
                    >
                        初始化默认源
                    </Button>
                    <Button
                        size="sm"
                        color="primary"
                        onPress={() => setForm({ ...emptySourceForm })}
                        startContent={<Icon icon="solar:add-circle-bold" />}
                    >
                        新增采集源
                    </Button>
                </div>
            </div>

            {form ? (
                <div className="rounded-[10px] border border-divider bg-default-50/50 p-4">
                    <div className="mb-4 flex items-center justify-between">
                        <div>
                            <h4 className="font-medium">
                                {form.id ? "编辑采集源" : "新增采集源"}
                            </h4>
                            <p className="mt-1 text-small text-default-500">
                                手动维护采集地址、启用状态和高级参数。
                            </p>
                        </div>
                        <Button size="sm" variant="light" onPress={() => setForm(null)}>
                            取消
                        </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Input
                            label="采集源名称"
                            value={form.name}
                            onChange={(event) =>
                                setForm((prev) =>
                                    prev ? { ...prev, name: event.target.value } : prev,
                                )
                            }
                            labelPlacement="outside"
                            placeholder="例如：Aibase"
                        />
                        <Select
                            label="采集类型"
                            selectedKeys={[form.type]}
                            onSelectionChange={(keys) => {
                                const type = Array.from(keys)[0] as string | undefined;
                                if (!type) return;
                                setForm((prev) => (prev ? { ...prev, type } : prev));
                            }}
                            labelPlacement="outside"
                            disallowEmptySelection
                        >
                            {sourceTypeOptions.map((option) => (
                                <SelectItem key={option.key}>{option.label}</SelectItem>
                            ))}
                        </Select>
                    </div>
                    <div className="mt-4">
                        <Input
                            label="采集地址"
                            value={form.url}
                            onChange={(event) =>
                                setForm((prev) =>
                                    prev ? { ...prev, url: event.target.value } : prev,
                                )
                            }
                            labelPlacement="outside"
                            placeholder="https://example.com"
                        />
                    </div>
                    <div className="mt-4">
                        <Textarea
                            label="高级配置 JSON"
                            value={form.configJson}
                            onChange={(event) =>
                                setForm((prev) =>
                                    prev ? { ...prev, configJson: event.target.value } : prev,
                                )
                            }
                            minRows={4}
                            labelPlacement="outside"
                            description='例如：{"platform":"Aibase","timeout":30,"proxyUrl":""}'
                        />
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                        <Switch
                            color="success"
                            isSelected={form.enabled}
                            onValueChange={(enabled) =>
                                setForm((prev) => (prev ? { ...prev, enabled } : prev))
                            }
                        >
                            启用采集源
                        </Switch>
                        <Button color="primary" isLoading={saving} onPress={handleSaveSource}>
                            保存采集源
                        </Button>
                    </div>
                </div>
            ) : null}

            {sources.length === 0 ? (
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
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {sources.map((source) => (
                        <div
                            key={source.id}
                            className="flex items-center justify-between gap-3 rounded-[10px] border border-divider bg-default-50/50 p-4"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="truncate font-medium">{source.name}</span>
                                    <Chip size="sm" variant="flat" color="primary">
                                        {source.type}
                                    </Chip>
                                </div>
                                <p className="mt-1 max-w-[300px] truncate text-small text-default-500">
                                    {source.url}
                                </p>
                                {source.lastCrawlTime ? (
                                    <p className="mt-1 text-tiny text-default-400">
                                        上次采集:{" "}
                                        {new Date(source.lastCrawlTime).toLocaleString("zh-CN")}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <Switch
                                    color="success"
                                    size="sm"
                                    isSelected={source.enabled}
                                    isDisabled={togglingId === source.id}
                                    onValueChange={() => handleToggle(source.id)}
                                />
                                <Button
                                    size="sm"
                                    variant="light"
                                    isIconOnly
                                    aria-label={`编辑 ${source.name}`}
                                    onPress={() => setForm(toSourceForm(source))}
                                >
                                    <Icon icon="solar:pen-bold" width={18} />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="light"
                                    color="danger"
                                    isIconOnly
                                    aria-label={`删除 ${source.name}`}
                                    isLoading={deletingId === source.id}
                                    onPress={() => handleDeleteSource(source)}
                                >
                                    <Icon icon="solar:trash-bin-trash-bold" width={18} />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Divider className="my-2" />

            <h3 className="text-medium font-bold">爬虫基础设置</h3>
            <div className="rounded-[10px] border border-divider bg-default-50/50 p-4 text-small text-default-500">
                请求超时时间、代理地址、平台标识等采集参数现在保存在每个采集源的高级配置 JSON
                里。需要单独调整某个渠道时，点该渠道右侧的编辑按钮。
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
                    <div className="rounded-[10px] border border-divider bg-default-50/60 p-4">
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
