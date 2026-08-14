"use client";

import React from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Select,
  SelectItem,
  Spinner,
  addToast,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { SimpleFeaturePage } from "../../agent-workbench/agent-workbench-client";
import {
  settingsApi,
  type AIModel,
  type DefaultModels,
} from "@/lib/api/settings";
import { toPublicError } from "@/lib/public-error";

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
        setSelectedModelId(
          (prev) =>
            prev || defaultConfig?.articleCreation || modelList[0]?.id || "",
        );
      })
      .catch((error: unknown) => {
        addToast({
          title: "AI 服务配置读取失败",
          description: toPublicError(
            error,
            "AI 服务配置暂时无法读取，请稍后重试。",
          ),
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
      addToast({
        title: "没有可检查的 AI 服务",
        description: "请先在系统配置里添加并启用 AI 服务。",
        color: "warning",
      });
      return;
    }
    setTesting(true);
    try {
      const result = await settingsApi.testModel({
        platformId: selectedModel.platformId,
        modelId: selectedModel.modelId,
      });
      if (result.success) {
        addToast({
          title: "AI 服务连接正常",
          description: result.reply || "写作与回复能力可用",
          color: "success",
        });
      } else {
        addToast({
          title: "AI 服务检查失败",
          description: result.message,
          color: "danger",
        });
      }
    } catch (e: unknown) {
      addToast({
        title: "AI 服务检查失败",
        description: toPublicError(
          e,
          "AI 服务检查未完成，请稍后重试。",
        ),
        color: "danger",
      });
    } finally {
      setTesting(false);
    }
  };
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-5 justify-center">
        <Spinner size="sm" />
        <span className="text-small text-default-500">读取 AI 服务配置...</span>
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
            <p className="text-small font-semibold text-default-800">
              AI 服务连接
            </p>
            <p className="mt-1 text-tiny text-default-500">
              读取系统配置中的 AI 服务，检查写作、分析和回复能力是否可用。
            </p>
          </div>
          <Button
            as="a"
            href="/settings?tab=ai"
            startContent={<Icon icon="solar:settings-outline" />}
            variant="flat"
          >
            系统配置
          </Button>
        </div>
        {models.length ? (
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <Select
              label="选择服务"
              labelPlacement="outside"
              selectedKeys={selectedModelId ? [selectedModelId] : []}
              onSelectionChange={(keys) =>
                setSelectedModelId(String(Array.from(keys)[0] || ""))
              }
            >
              {models.map((model) => (
                <SelectItem
                  key={model.id}
                  textValue={`${model.name} ${model.modelId}`}
                >
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
              检查连接
            </Button>
          </div>
        ) : (
          <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 px-3 py-2">
            <p className="text-small font-semibold text-warning-700">
              未配置 AI 服务
            </p>
            <p className="mt-1 text-tiny text-warning-600">
              内容生成、选题推荐和回复生成暂不可用；请先到系统配置添加可用服务。
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Chip
            color={models.length ? "success" : "warning"}
            size="sm"
            variant="flat"
          >
            服务 {models.length}
          </Chip>
          {defaultPairs.map(([label, id]) => (
            <Chip
              key={label}
              color={id ? "primary" : "default"}
              size="sm"
              variant="flat"
            >
              {label}
              {id ? " 已配置" : " 未配置"}
            </Chip>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function IntelligenceCapabilityLinks() {
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div>
          <p className="text-small font-semibold text-default-800">
            情报能力管理
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <Button
            as="a"
            href="/intelligence/costs"
            startContent={<Icon icon="solar:bill-list-linear" />}
            variant="flat"
          >
            用量明细
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export default function Page() {
  return (
    <SimpleFeaturePage
      title="AI 服务"
      description="配置内容生成、回复生成、任务规划和结果总结使用的智能服务。"
      icon="solar:cpu-bolt-linear"
      capabilityKey="permission-check"
      localEngineTab="permissions"
      primaryAction={{
        label: "执行前检查",
        href: "/local-engine?tab=permissions",
        icon: "solar:shield-check-linear",
      }}
      items={[
        "按内容生产、互动回复、任务规划和结果总结选择默认服务。",
        "查看可用额度、套餐限制、失败处理方式和使用记录。",
        "敏感任务可使用更高规格服务并要求人工确认。",
        "服务配置会随账号同步到当前设备。",
      ]}
    >
      <ModelHealthSection />
      <IntelligenceCapabilityLinks />
    </SimpleFeaturePage>
  );
}
