"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Button,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Spinner,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Textarea,
  useDisclosure,
  addToast,
  Tabs,
  Tab,
} from "@heroui/react";
import { Icon, loadIcons } from "@/components/lucide-icon-compat";
import { stylesApi, Style } from "@/lib/api/styles";
import { toPublicError } from "@/lib/public-error";
import { FunctionalEmptyState } from "../components/functional-empty-state";
type StyleFormData = {
  name: string;
  description: string;
  promptTemplate: string;
  isDefault?: boolean;
  parameters?: Record<string, unknown>;
};
export default function StylesPage() {
  useEffect(() => {
    loadIcons([
      "solar:document-add-bold",
      "solar:document-add-linear",
      "solar:pen-linear",
      "solar:trash-bin-trash-linear",
      "solar:add-circle-bold",
      "solar:star-bold",
      "solar:star-outline",
      "solar:gallery-bold",
      "solar:chat-round-dots-bold",
    ]);
  }, []);
  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full">
      <header className="rounded-[8px] border-small border-divider flex items-center justify-between gap-3 p-4 bg-background shadow-sm">
        <div>
          <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)] flex items-center gap-2">
            <Icon icon="solar:document-add-bold" className="text-primary" />
            风格管理
          </h2>
          <p className="text-small text-default-500 mt-1">
            管理文章、小红书笔记与配图时的风格预设，每种类型支持设置全局唯一默认风格
          </p>
        </div>
      </header>
      <Card className="bg-background dark:bg-default-100 border-small border-divider shadow-sm">
        <Tabs
          classNames={{
            tabList: "mx-4 mt-6 text-medium bg-default-100",
            tabContent: "text-small",
            panel: "p-5",
          }}
          size="lg"
        >
          <Tab
            key="article"
            title={
              <div className="flex items-center gap-2">
                <Icon icon="solar:document-add-bold" width={20} />
                <span>文章风格</span>
              </div>
            }
          >
            <StyleManager
              type="article"
              title="文章风格管理"
              description="用于生成文章内容、改写、扩写等文本创作任务的预设风格"
              promptPlaceholder="输入扮演角色的指令或文章结构要求，作为 system prompt 输入给大模型..."
            />
          </Tab>
          <Tab
            key="xiaohongshu"
            title={
              <div className="flex items-center gap-2">
                <Icon icon="solar:chat-round-dots-bold" width={20} />
                <span>小红书笔记风格</span>
              </div>
            }
          >
            <StyleManager
              type="xiaohongshu"
              title="小红书笔记风格管理"
              description="用于生成小红书笔记、种草文案、经验总结等平台化内容的预设风格"
              promptPlaceholder="输入适用于小红书笔记的语气、结构、互动方式与表达偏好，例如：真实口语感、先结论后展开、结尾带标签..."
            />
          </Tab>
          <Tab
            key="image"
            title={
              <div className="flex items-center gap-2">
                <Icon icon="solar:gallery-bold" width={20} />
                <span>图片风格</span>
              </div>
            }
          >
            <StyleManager
              type="image"
              title="图片风格管理"
              description="用于生成文章配图、封面图等视觉内容的预设提示词风格"
              promptPlaceholder="输入画面主体、环境、光影、材质、画风等绘画提示词要求..."
            />
          </Tab>
        </Tabs>
      </Card>
    </div>
  );
}

function StyleManager({
  type,
  title,
  description,
  promptPlaceholder,
}: {
  type: "article" | "image" | "xiaohongshu";
  title: string;
  description: string;
  promptPlaceholder: string;
}) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [styles, setStyles] = useState<Style[]>([]);
  const [editingStyle, setEditingStyle] = useState<Style | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStyles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await stylesApi.list(type);
      setStyles(data);
    } catch (error: unknown) {
      addToast({
        title: "加载失败",
        description: toPublicError(
          error,
          "风格暂时无法加载，请稍后重试。",
        ),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    fetchStyles();
  }, [fetchStyles]);

  const handleAdd = () => {
    setEditingStyle(null);
    onOpen();
  };

  const handleEdit = (style: Style) => {
    setEditingStyle(style);
    onOpen();
  };

  const handleDelete = async (id: string) => {
    try {
      await stylesApi.remove(id);
      setStyles(styles.filter((s) => s.id !== id));
      addToast({ title: "删除成功", color: "success" });
    } catch (error: unknown) {
      addToast({
        title: "删除失败",
        description: toPublicError(error, "风格未能删除，请稍后重试。"),
        color: "danger",
      });
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await stylesApi.setDefault(id);
      fetchStyles(); // 重新拉取以更新列表中的 default 状态
      addToast({ title: "已设为默认风格", color: "success" });
    } catch (error: unknown) {
      addToast({
        title: "设置失败",
        description: toPublicError(
          error,
          "默认风格未能更新，请稍后重试。",
        ),
        color: "danger",
      });
    }
  };

  const handleSave = async (formData: StyleFormData) => {
    try {
      if (editingStyle) {
        await stylesApi.update(editingStyle.id, { ...formData, type });
      } else {
        await stylesApi.create({ ...formData, type });
      }
      onClose();
      fetchStyles();
      addToast({ title: "保存成功", color: "success" });
    } catch (error: unknown) {
      addToast({
        title: "保存失败",
        description: toPublicError(error, "风格未能保存，请稍后重试。"),
        color: "danger",
      });
    }
  };
  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h3 className="text-medium font-bold">{title}</h3>
          <p className="text-small text-default-500 mt-1">{description}</p>
        </div>
        <Button
          color="primary"
          startContent={<Icon icon="solar:add-circle-bold" />}
          onClick={handleAdd}
        >
          添加风格
        </Button>
      </div>
      <Table
        aria-label={`${title}列表`}
        className="border-small border-divider rounded-[8px] shadow-sm bg-background"
      >
        <TableHeader>
          <TableColumn>风格名称</TableColumn>
          <TableColumn>状态</TableColumn>
          <TableColumn>描述</TableColumn>
          <TableColumn>更新时间</TableColumn>
          <TableColumn align="center">操作</TableColumn>
        </TableHeader>
        <TableBody
          emptyContent={
            <FunctionalEmptyState
              actions={[{ label: "添加风格", onPress: handleAdd }]}
              description="还没有可复用的创作风格。添加后可以作为文章、小红书笔记或配图生成的默认风格。"
              examples={["文章风格", "小红书风格", "配图风格", "默认风格"]}
              surface="plain"
              title={`当前没有${title}`}
            />
          }
        >
          {styles.map((style) => (
            <TableRow key={style.id}>
              <TableCell>
                <span className="font-medium text-default-900">
                  {style.name}
                </span>
              </TableCell>
              <TableCell>
                {style.isDefault ? (
                  <Chip
                    size="sm"
                    color="success"
                    variant="flat"
                    startContent={<Icon icon="solar:star-bold" />}
                  >
                    默认
                  </Chip>
                ) : (
                  <Chip size="sm" color="default" variant="flat">
                    普通
                  </Chip>
                )}
              </TableCell>
              <TableCell>
                <span className="text-small text-default-500 truncate max-w-xs block">
                  {style.description || "-"}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-small text-default-500">
                  {new Date(style.updatedAt).toLocaleString("zh-CN")}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-center gap-2">
                  {!style.isDefault && (
                    <Button
                      size="sm"
                      variant="light"
                      color="success"
                      onClick={() => handleSetDefault(style.id)}
                      title="设为默认"
                    >
                      设为默认
                    </Button>
                  )}
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    onClick={() => handleEdit(style)}
                    title="编辑"
                  >
                    <Icon icon="solar:pen-linear" width={18} />
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    color="danger"
                    onClick={() => handleDelete(style.id)}
                    title="删除"
                    isDisabled={style.isDefault}
                  >
                    <Icon icon="solar:trash-bin-trash-linear" width={18} />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <StyleModal
        isOpen={isOpen}
        onClose={onClose}
        style={editingStyle}
        onSave={handleSave}
        promptPlaceholder={promptPlaceholder}
        type={type}
      />
    </div>
  );
}

function StyleModal({
  isOpen,
  onClose,
  style,
  onSave,
  promptPlaceholder,
  type,
}: {
  isOpen: boolean;
  onClose: () => void;
  style: Style | null;
  onSave: (data: StyleFormData) => Promise<void>;
  promptPlaceholder: string;
  type: "article" | "image" | "xiaohongshu";
}) {
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    promptTemplate: string;
    parameters: Record<string, unknown>;
  }>({ name: "", description: "", promptTemplate: "", parameters: {} });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (style) {
      setFormData({
        name: style.name,
        description: style.description || "",
        promptTemplate: style.promptTemplate,
        parameters: style.parameters || {},
      });
    } else {
      setFormData({
        name: "",
        description: "",
        promptTemplate: "",
        parameters: {},
      });
    }
  }, [style]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.promptTemplate.trim()) {
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...formData, isDefault: style ? undefined : false }); // 新建默认不为 default, 需单独设置
    } catch (error: unknown) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl">
      <ModalContent>
        <ModalHeader>{style ? "编辑创作风格" : "添加创作风格"}</ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4">
            <Input
              label="风格名称"
              placeholder="例如：小红书爆款风、深度科技分析等"
              value={formData.name}
              isRequired
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              labelPlacement="outside"
            />
            <Input
              label="描述简介"
              placeholder="简要描述该风格的特点"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              labelPlacement="outside"
            />
            <Textarea
              label="Prompt 模板"
              placeholder={promptPlaceholder}
              value={formData.promptTemplate}
              isRequired
              minRows={8}
              onChange={(e) =>
                setFormData({ ...formData, promptTemplate: e.target.value })
              }
              labelPlacement="outside"
            />
            {type === "image" && (
              <Input
                label="图片比例 (可选)"
                placeholder="例如：16:9，留空即为默认"
                value={
                  typeof formData.parameters?.ratio === "string"
                    ? formData.parameters.ratio
                    : ""
                }
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    parameters: {
                      ...formData.parameters,
                      ratio: e.target.value,
                    },
                  })
                }
                labelPlacement="outside"
              />
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onClick={onClose}>
            取消
          </Button>
          <Button color="primary" onClick={handleSubmit} isLoading={saving}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
