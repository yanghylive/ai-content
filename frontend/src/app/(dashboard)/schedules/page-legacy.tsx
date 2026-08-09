"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardBody,
  CardHeader,
  Switch,
  Input,
  Button,
  Spinner,
  Divider,
  Select,
  SelectItem,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { toast } from "@/lib/toast";
import {
  schedulesApi,
  type CreateArticlesScheduleConfig,
  type ScheduleConfig,
} from "@/lib/api/schedules";
const parseCron = (cron: string) => {
  if (!cron) return { mode: "custom", value: "" };
  const dailyMatch = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    const mm = dailyMatch[1].padStart(2, "0");
    const hh = dailyMatch[2].padStart(2, "0");
    return { mode: "daily", value: `${hh}:${mm}` };
  }
  const hourlyMatch = cron.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (hourlyMatch) {
    return { mode: "hourly", value: hourlyMatch[1] };
  }
  return { mode: "custom", value: cron };
};
const buildCron = (mode: string, value: string, oldCron: string) => {
  if (mode === "daily") {
    const [hh, mm] = (value || "00:00").split(":");
    return `${Number(mm)} ${Number(hh)} * * *`;
  }
  if (mode === "hourly") {
    return `0 */${value || 1} * * *`;
  }
  return oldCron;
};
const taskTypeMap: Record<
  string,
  { title: string; desc: string; icon: string }
> = {
  collect_materials: {
    title: "自动采集素材",
    desc: "从所有已启用的信息源定期获取最新内容",
    icon: "solar:cloud-download-linear",
  },
  mine_materials: {
    title: "自动挖掘素材",
    desc: "批量利用大模型加工并提炼未处理的素材",
    icon: "solar:magic-stick-3-linear",
  },
  create_articles: {
    title: "自动生成文章",
    desc: "从就绪的精选选题中按默认风格生成草稿",
    icon: "solar:document-text-linear",
  },
};
export default function SchedulesPage() {
  const [configs, setConfigs] = useState<ScheduleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTask, setSavingTask] = useState<string | null>(null);
  useEffect(() => {
    fetchSchedules();
  }, []);
  const fetchSchedules = async () => {
    try {
      setLoading(true);
      const data = await schedulesApi.list();
      setConfigs(data || []);
    } catch {
      toast.error("获取系统调度配置失败");
    } finally {
      setLoading(false);
    }
  };
  const handleUpdate = async (config: ScheduleConfig) => {
    try {
      setSavingTask(config.taskType);
      await schedulesApi.update(config.taskType, {
        cronExpr: config.cronExpr,
        enabled: config.enabled,
        config: config.config,
      });
      toast.success(
        `${taskTypeMap[config.taskType]?.title || "任务"}设置已保存`,
      );
      await fetchSchedules();
    } catch {
      toast.error("请求失败");
    } finally {
      setSavingTask(null);
    }
  };
  const handleChange = (
    taskType: string,
    field: keyof ScheduleConfig,
    value: string | boolean | CreateArticlesScheduleConfig | undefined,
  ) => {
    setConfigs((prev) =>
      prev.map((c) => (c.taskType === taskType ? { ...c, [field]: value } : c)),
    );
  };
  if (loading) {
    return (
      <div className="flex w-full h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 p-5">
      <div>
        <h1 className="text-[22px] font-bold leading-[30px]">定时任务</h1>
        <p className="text-default-500 mt-2">
          配置自动采集、素材挖掘和文章生成的固定时间。不需要理解调度规则，先选择频率再保存。
        </p>
      </div>      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {configs.map((config) => {
          const meta = taskTypeMap[config.taskType] || {
            title: config.taskType,
            desc: "未知的系统任务",
            icon: "solar:settings-linear",
          };
          return (
            <Card key={config.taskType} className="w-full">
              <CardHeader className="flex gap-3 px-5 pt-5 pb-3 justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon icon={meta.icon} width={24} />
                  </div>
                  <div className="flex flex-col">
                    <p className="text-md font-bold">{meta.title}</p>
                    <p
                      className="text-small text-default-500 line-clamp-2"
                      title={meta.desc}
                    >
                      {meta.desc}
                    </p>
                  </div>
                </div>
                <Switch
                  isSelected={config.enabled}
                  onValueChange={(val) =>
                    handleChange(config.taskType, "enabled", val)
                  }
                  color="primary"
                />
              </CardHeader>
              <Divider />
              <CardBody className="px-5 py-4 flex flex-col gap-4">
                {(() => {
                  const parsed = parseCron(config.cronExpr);
                  return (
                    <div className="flex flex-col gap-3">
                      <Select
                        label="运行频率"
                        selectedKeys={[parsed.mode]}
                        onSelectionChange={(keys) => {
                          const newMode = Array.from(keys)[0] as string;
                          if (!newMode || newMode === parsed.mode) return;

                          let newCron = config.cronExpr;
                          if (newMode === "daily") newCron = "0 0 * * *";
                          else if (newMode === "hourly")
                            newCron = "0 */1 * * *";

                          handleChange(config.taskType, "cronExpr", newCron);
                        }}
                        size="sm"
                        variant="bordered"
                        isDisabled={!config.enabled}
                        disallowEmptySelection
                      >
                        <SelectItem key="hourly">每隔几小时</SelectItem>
                        <SelectItem key="daily">每天固定时间</SelectItem>
                        <SelectItem key="custom">高级 (自定义 Cron)</SelectItem>
                      </Select>
                      {parsed.mode === "hourly" && (
                        <Input
                          type="number"
                          label="间隔小时数"
                          min={1}
                          max={23}
                          value={parsed.value}
                          onValueChange={(val) => {
                            handleChange(
                              config.taskType,
                              "cronExpr",
                              buildCron("hourly", val, config.cronExpr),
                            );
                          }}
                          size="sm"
                          variant="bordered"
                          isDisabled={!config.enabled}
                        />
                      )}
                      {parsed.mode === "daily" && (
                        <Input
                          type="time"
                          label="执行时间"
                          value={parsed.value}
                          onValueChange={(val) => {
                            handleChange(
                              config.taskType,
                              "cronExpr",
                              buildCron("daily", val, config.cronExpr),
                            );
                          }}
                          size="sm"
                          variant="bordered"
                          isDisabled={!config.enabled}
                        />
                      )}
                      {parsed.mode === "custom" && (
                        <Input
                          label="Cron 表达式"
                          placeholder="如: 0 * * * *"
                          value={config.cronExpr}
                          onValueChange={(val) =>
                            handleChange(config.taskType, "cronExpr", val)
                          }
                          description="支持标准的 5 位或 6 位 Cron 格式"
                          variant="bordered"
                          size="sm"
                          isDisabled={!config.enabled}
                        />
                      )}
                    </div>
                  );
                })()}
                {config.taskType === "create_articles" && (
                  <div className="flex flex-col gap-3 mt-1 pt-3 border-t border-dashed border-default-200">
                    <p className="text-xs font-semibold text-default-500">
                      生成门槛卡控保护
                    </p>
                    <div className="flex gap-3">
                      <Input
                        type="number"
                        label="最低 AI 评分"
                        description="低于该分的选题将不被处理"
                        value={config.config?.minScore?.toString() || "80"}
                        onValueChange={(val) =>
                          handleChange(config.taskType, "config", {
                            ...config.config,
                            minScore: Number(val),
                          })
                        }
                        size="sm"
                        variant="bordered"
                        min={0}
                        max={100}
                        isDisabled={!config.enabled}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        label="单次最大篇数"
                        description="避免批量超流"
                        value={config.config?.limit?.toString() || "5"}
                        onValueChange={(val) =>
                          handleChange(config.taskType, "config", {
                            ...config.config,
                            limit: Number(val),
                          })
                        }
                        size="sm"
                        variant="bordered"
                        min={1}
                        max={50}
                        isDisabled={!config.enabled}
                        className="flex-1"
                      />
                    </div>
                  </div>
                )}
                <div className="flex justify-between items-center mt-2">
                  <p className="text-xs text-default-400">
                    上次运行:
                    {config.lastRunTime
                      ? new Date(config.lastRunTime).toLocaleString()
                      : "从未运行"}
                  </p>
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    isLoading={savingTask === config.taskType}
                    onPress={() => handleUpdate(config)}
                  >
                    保存配置
                  </Button>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
