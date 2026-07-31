"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Textarea,
  addToast,
  useDisclosure,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { RiskConfirmationDialog } from "@/components/risk-confirmation-dialog";
import {
  contentStrategiesApi,
  type ContentStrategy,
  type ContentStrategyPayload,
} from "@/lib/api/content-strategies";
import { toPublicError } from "@/lib/public-error";

function getErrorMessage(error: unknown, fallback: string) {
  return toPublicError(error, fallback);
}

type StrategyFormState = ContentStrategyPayload;

const createInitialFormState = (): StrategyFormState => ({
  name: "",
  description: "",
  industry: "通用",
  targetAudience: "",
  commercialGoal: "",
  corePainPoints: "",
  writingAngles: "",
  toneAndStyle: "",
  enabled: true,
  isDefault: false,
});

export default function StrategiesPage() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [strategies, setStrategies] = useState<ContentStrategy[]>([]);
  const [editingStrategy, setEditingStrategy] =
    useState<ContentStrategy | null>(null);
  const [formData, setFormData] = useState<StrategyFormState>(
    createInitialFormState(),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [strategyToDelete, setStrategyToDelete] =
    useState<ContentStrategy | null>(null);
  const [deletingStrategyId, setDeletingStrategyId] = useState("");

  const fetchStrategies = useCallback(async () => {
    try {
      setLoading(true);
      const data = await contentStrategiesApi.list();
      setStrategies(data);
    } catch (error: unknown) {
      addToast({
        title: "加载内容策略失败",
        description: getErrorMessage(
          error,
          "内容策略暂时无法加载，请重新加载。",
        ),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies]);

  const resetForm = () => {
    setEditingStrategy(null);
    setFormData(createInitialFormState());
  };

  const handleCloseModal = () => {
    onClose();
    resetForm();
  };

  const handleOpenCreate = () => {
    resetForm();
    onOpen();
  };

  const handleOpenEdit = (strategy: ContentStrategy) => {
    setEditingStrategy(strategy);
    setFormData({
      name: strategy.name,
      description: strategy.description || "",
      industry: strategy.industry,
      targetAudience: strategy.targetAudience,
      commercialGoal: strategy.commercialGoal,
      corePainPoints: strategy.corePainPoints,
      writingAngles: strategy.writingAngles,
      toneAndStyle: strategy.toneAndStyle || "",
      enabled: strategy.enabled,
      isDefault: strategy.isDefault,
    });
    onOpen();
  };

  const handleSave = async () => {
    if (
      !formData.name.trim() ||
      !formData.targetAudience.trim() ||
      !formData.commercialGoal.trim() ||
      !formData.corePainPoints.trim() ||
      !formData.writingAngles.trim()
    ) {
      addToast({ title: "请补全必填项", color: "warning" });
      return;
    }

    try {
      setSaving(true);
      if (editingStrategy) {
        await contentStrategiesApi.update(editingStrategy.id, formData);
      } else {
        await contentStrategiesApi.create(formData);
      }
      addToast({ title: "内容策略已保存", color: "success" });
      handleCloseModal();
      await fetchStrategies();
    } catch (error: unknown) {
      addToast({
        title: "保存失败",
        description: getErrorMessage(
          error,
          "内容策略未保存，请检查必填项后重试。",
        ),
        color: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (strategy: ContentStrategy) => {
    setStrategyToDelete(strategy);
  };

  const confirmDelete = async () => {
    if (!strategyToDelete) return;
    try {
      setDeletingStrategyId(strategyToDelete.id);
      await contentStrategiesApi.remove(strategyToDelete.id);
      addToast({ title: "内容策略已删除", color: "success" });
      setStrategyToDelete(null);
      await fetchStrategies();
    } catch (error: unknown) {
      addToast({
        title: "删除失败",
        description: getErrorMessage(error, "内容策略未删除，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setDeletingStrategyId("");
    }
  };

  const handleSetDefault = async (strategy: ContentStrategy) => {
    try {
      await contentStrategiesApi.setDefault(strategy.id);
      addToast({
        title: `已切换默认策略为「${strategy.name}」`,
        color: "success",
      });
      await fetchStrategies();
    } catch (error: unknown) {
      addToast({
        title: "切换默认失败",
        description: getErrorMessage(error, "默认策略未切换，请稍后重试。"),
        color: "danger",
      });
    }
  };
  return (
    <div className="flex flex-col gap-4 max-w-6xl mx-auto w-full pb-10">
      <header className="rounded-[8px] border-small border-divider flex items-center justify-between gap-3 p-5 bg-background shadow-sm">
        <div className="flex flex-col">
          <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            内容策略
          </h2>
          <span className="text-small text-default-500 mt-1">
            配置行业、目标人群、商业目标和表达视角。选题挖掘与评分会自动读取默认策略。
          </span>
        </div>
        <Button
          color="primary"
          startContent={<Icon icon="solar:add-circle-bold" />}
          onClick={handleOpenCreate}
        >
          添加策略
        </Button>
      </header>
      <Card className="bg-background dark:bg-content1 shadow-sm border-small border-divider">
        <CardHeader className="px-5 pt-6 pb-2 flex flex-col items-start gap-2">
          <h3 className="text-medium font-bold text-default-900">策略列表</h3>
          <p className="text-small text-default-500">
            建议为不同业务方向准备不同策略，但始终只保留一个默认策略供系统自动使用。
          </p>
        </CardHeader>
        <CardBody className="px-5 pb-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : (
            <Table
              aria-label="内容策略列表"
              className="border-small border-divider rounded-[8px]"
            >
              <TableHeader>
                <TableColumn>策略名称</TableColumn>
                <TableColumn>行业</TableColumn>
                <TableColumn>目标人群</TableColumn>
                <TableColumn>商业目标</TableColumn>
                <TableColumn>状态</TableColumn>
                <TableColumn align="center">操作</TableColumn>
              </TableHeader>
              <TableBody emptyContent="当前没有内容策略">
                {strategies.map((strategy) => (
                  <TableRow key={strategy.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-default-900">
                            {strategy.name}
                          </span>
                          {strategy.isDefault ? (
                            <Chip size="sm" color="success" variant="flat">
                              默认
                            </Chip>
                          ) : null}
                        </div>
                        <span className="text-small text-default-500 line-clamp-2">
                          {strategy.description || "未填写描述"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{strategy.industry}</TableCell>
                    <TableCell>
                      <span className="text-small text-default-600 line-clamp-3 max-w-xs block">
                        {strategy.targetAudience}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-small text-default-600 line-clamp-3 max-w-xs block">
                        {strategy.commercialGoal}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={strategy.enabled ? "primary" : "default"}
                        variant="flat"
                      >
                        {strategy.enabled ? "启用中" : "已禁用"}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-2">
                        {!strategy.isDefault && strategy.enabled ? (
                          <Button
                            size="sm"
                            variant="light"
                            color="success"
                            onClick={() => handleSetDefault(strategy)}
                          >
                            设为默认
                          </Button>
                        ) : null}
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          aria-label={`编辑策略：${strategy.name}`}
                          title={`编辑策略：${strategy.name}`}
                          onClick={() => handleOpenEdit(strategy)}
                        >
                          <Icon icon="solar:pen-linear" width={18} />
                        </Button>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          color="danger"
                          isDisabled={strategy.isDefault}
                          aria-label={`删除策略：${strategy.name}`}
                          title={
                            strategy.isDefault
                              ? "默认策略不能删除"
                              : `删除策略：${strategy.name}`
                          }
                          onClick={() => handleDelete(strategy)}
                        >
                          <Icon
                            icon="solar:trash-bin-trash-linear"
                            width={18}
                          />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
      <Modal
        isOpen={isOpen}
        onClose={handleCloseModal}
        size="4xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>
            {editingStrategy ? "编辑内容策略" : "新增内容策略"}
          </ModalHeader>
          <ModalBody className="gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="策略名称"
                labelPlacement="outside"
                placeholder="例如：AI 增长内容策略"
                value={formData.name}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, name: value }))
                }
              />
              <Input
                label="所属行业"
                labelPlacement="outside"
                placeholder="例如：AI / 数字化增长"
                value={formData.industry || ""}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, industry: value }))
                }
              />
            </div>
            <Textarea
              label="策略说明"
              labelPlacement="outside"
              minRows={2}
              placeholder="简要说明这个策略适用于哪类内容业务"
              value={formData.description || ""}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, description: value }))
              }
            />
            <Textarea
              label="目标人群"
              labelPlacement="outside"
              minRows={3}
              placeholder="例如：想用 AI 提升效率、获客或打造一人业务的创业者、运营和小团队负责人"
              value={formData.targetAudience}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, targetAudience: value }))
              }
            />
            <Textarea
              label="商业目标"
              labelPlacement="outside"
              minRows={3}
              placeholder="例如：通过内容吸引目标用户，转化为咨询、服务、课程或社群成交"
              value={formData.commercialGoal}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, commercialGoal: value }))
              }
            />
            <Textarea
              label="核心痛点"
              labelPlacement="outside"
              minRows={3}
              placeholder="例如：不会选题、内容太空泛、缺少转化钩子、担心被时代淘汰"
              value={formData.corePainPoints}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, corePainPoints: value }))
              }
            />
            <Textarea
              label="建议切入角度"
              labelPlacement="outside"
              minRows={3}
              placeholder="例如：趋势解读、痛点拆解、认知反转、实操方法、案例拆解"
              value={formData.writingAngles}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, writingAngles: value }))
              }
            />
            <Textarea
              label="语气与风格"
              labelPlacement="outside"
              minRows={2}
              placeholder="例如：务实、带结论、强调具体价值，避免过度炫技"
              value={formData.toneAndStyle || ""}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, toneAndStyle: value }))
              }
            />
            <div className="flex items-center justify-between rounded-[8px] border border-default-200 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-default-700">
                  启用该策略
                </p>
                <p className="text-xs text-default-400 mt-1">
                  禁用后无法被设置为默认，也不会被系统读取。
                </p>
              </div>
              <Switch
                isSelected={formData.enabled ?? true}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, enabled: value }))
                }
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onClick={handleCloseModal}>
              取消
            </Button>
            <Button color="primary" isLoading={saving} onClick={handleSave}>
              保存策略
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <RiskConfirmationDialog
        checklist={[
          "确认该策略不是当前内容生产流程依赖的业务策略。",
          "删除后，后续选题挖掘和内容评分不能再读取该策略。",
        ]}
        confirmLabel="确认删除"
        description="删除内容策略会影响后续内容生产的行业、人群、痛点和表达视角配置。"
        impactItems={[
          {
            label: "策略名称",
            value: strategyToDelete?.name || "-",
          },
          {
            label: "操作结果",
            value: "从内容运营的策略库中移除",
          },
        ]}
        isLoading={Boolean(deletingStrategyId)}
        isOpen={Boolean(strategyToDelete)}
        riskLevel="medium"
        title="确认删除内容策略"
        onCancel={() => setStrategyToDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
