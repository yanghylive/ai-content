"use client";

import React from "react";
import Link from "next/link";
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Textarea,
  Tooltip,
} from "@heroui/react";
import {
  Archive,
  Braces,
  Edit3,
  MessageSquareText,
  Plus,
  Send,
} from "lucide-react";
import toast from "@/lib/toast";
import {
  archiveCrmWelcomeMessageTemplate,
  createCrmWelcomeMessageTemplate,
  prepareCrmWelcomeMessage,
  updateCrmWelcomeMessageTemplate,
  type CrmCustomer,
  type CrmWelcomeMessageChannel,
  type CrmWelcomeMessagePreparation,
  type CrmWelcomeMessageTemplate,
} from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useConfirm } from "@/hooks/use-confirm";

const channelLabels: Record<CrmWelcomeMessageChannel, string> = {
  douyin: "抖音私信",
  wechat: "微信",
  "wechat-channel": "视频号私信",
};

const variables = [
  { label: "客户名", value: "{{customer_name}}" },
  { label: "公司", value: "{{company_name}}" },
  { label: "来源账号", value: "{{source_account}}" },
  { label: "来源关键词", value: "{{source_keyword}}" },
];

function renderTemplate(body: string, customer: CrmCustomer) {
  const values: Record<string, string> = {
    customer_name: customer.displayName,
    company_name: customer.companyName || "",
    source_account: customer.sourceAccount?.name || "",
    source_keyword: customer.sourceKeyword || "",
  };
  return body.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (match, key: string) => values[key] ?? match,
  );
}

function preparationHref(preparation: CrmWelcomeMessagePreparation) {
  const params = new URLSearchParams({
    crmCustomerId: preparation.customerId,
    crmPreparationId: preparation.id,
  });
  const path =
    preparation.channel === "wechat"
      ? "/engagement/wechat"
      : preparation.channel === "wechat-channel"
        ? "/engagement/channel-messages"
        : "/engagement/douyin-messages";
  return `${path}?${params.toString()}`;
}

type WelcomeMessagePanelProps = {
  customer: CrmCustomer;
  templates: CrmWelcomeMessageTemplate[];
  onTemplatesChange: (templates: CrmWelcomeMessageTemplate[]) => void;
  onPrepared: () => Promise<void> | void;
};

export function WelcomeMessagePanel({
  customer,
  templates,
  onTemplatesChange,
  onPrepared,
}: WelcomeMessagePanelProps) {
  const { confirm, modal } = useConfirm();
  const [selectedTemplateId, setSelectedTemplateId] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [preparation, setPreparation] =
    React.useState<CrmWelcomeMessagePreparation | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingTemplateId, setEditingTemplateId] = React.useState<
    string | null
  >(null);
  const [templateName, setTemplateName] = React.useState("");
  const [templateBody, setTemplateBody] = React.useState("");
  const [templateChannel, setTemplateChannel] =
    React.useState<CrmWelcomeMessageChannel>("douyin");
  const [savingTemplate, setSavingTemplate] = React.useState(false);

  const selectedTemplate = templates.find(
    (template) => template.id === selectedTemplateId,
  );
  const renderedTemplateMessage = selectedTemplate
    ? renderTemplate(selectedTemplate.body, customer)
    : "";
  const messageIsDirty =
    !preparation && message.trim() !== renderedTemplateMessage.trim();
  const templateBaseline = editingTemplateId
    ? templates.find((template) => template.id === editingTemplateId)
    : null;
  const templateIsDirty =
    modalOpen &&
    (templateName.trim() !== (templateBaseline?.name || "") ||
      templateBody.trim() !== (templateBaseline?.body || "") ||
      templateChannel !== (templateBaseline?.channel || "douyin"));

  useUnsavedChangesWarning(messageIsDirty || templateIsDirty);

  React.useEffect(() => {
    if (selectedTemplateId && selectedTemplate) return;
    const first = templates[0];
    setSelectedTemplateId(first?.id || "");
    setMessage(first ? renderTemplate(first.body, customer) : "");
  }, [customer, selectedTemplate, selectedTemplateId, templates]);

  const selectTemplate = (templateId: string) => {
    if (!messageIsDirty) {
      applyTemplate(templateId);
      return;
    }
    void confirm({
      kind: "warning",
      title: "有未保存的修改",
      description: "测试消息还有未保存的修改，切换模板将丢失这些修改。",
      confirmText: "切换模板",
      cancelText: "留在当前",
    }).then((ok) => {
      if (ok) applyTemplate(templateId);
    });
  };

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((item) => item.id === templateId);
    setMessage(template ? renderTemplate(template.body, customer) : "");
    setPreparation(null);
  };

  const openTemplateModal = (template?: CrmWelcomeMessageTemplate) => {
    setEditingTemplateId(template?.id || null);
    setTemplateName(template?.name || "");
    setTemplateBody(template?.body || "");
    setTemplateChannel(template?.channel || "douyin");
    setModalOpen(true);
  };

  const closeTemplateModal = () => {
    if (!templateIsDirty) {
      setModalOpen(false);
      return;
    }
    void confirm({
      kind: "warning",
      title: "有未保存的修改",
      description: "模板还有未保存的修改，关闭将丢失这些修改。",
      confirmText: "关闭",
      cancelText: "留在当前",
    }).then((ok) => {
      if (ok) setModalOpen(false);
    });
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    const body = templateBody.trim();
    if (!name || !body) {
      toast.error("请填写模板名称和内容");
      return;
    }
    setSavingTemplate(true);
    try {
      const saved = editingTemplateId
        ? await updateCrmWelcomeMessageTemplate(editingTemplateId, {
            name,
            body,
            channel: templateChannel,
          })
        : await createCrmWelcomeMessageTemplate({
            name,
            body,
            channel: templateChannel,
          });
      const next = editingTemplateId
        ? templates.map((template) =>
            template.id === saved.id ? saved : template,
          )
        : [saved, ...templates];
      onTemplatesChange(next);
      setSelectedTemplateId(saved.id);
      setMessage(renderTemplate(saved.body, customer));
      setModalOpen(false);
      toast.success(editingTemplateId ? "模板已更新" : "模板已创建");
    } catch (error) {
      toast.error(toPublicError(error, "模板未保存，请重试。"));
    } finally {
      setSavingTemplate(false);
    }
  };

  const archiveTemplate = async () => {
    if (!selectedTemplate) return;
    const ok = await confirm({
      kind: "danger",
      title: `归档模板「${selectedTemplate.name}」`,
      description: "归档后该模板不再出现在模板列表中。",
      confirmText: "归档",
    });
    if (!ok) return;
    try {
      await archiveCrmWelcomeMessageTemplate(selectedTemplate.id);
      const next = templates.filter(
        (template) => template.id !== selectedTemplate.id,
      );
      onTemplatesChange(next);
      const first = next[0];
      setSelectedTemplateId(first?.id || "");
      setMessage(first ? renderTemplate(first.body, customer) : "");
      setPreparation(null);
      toast.success("模板已归档");
    } catch (error) {
      toast.error(toPublicError(error, "模板未归档，请重试。"));
    }
  };

  const prepare = async () => {
    if (!message.trim()) {
      toast.error("请先填写欢迎消息");
      return;
    }
    setPreparing(true);
    try {
      const result = await prepareCrmWelcomeMessage(customer.id, {
        templateId: selectedTemplate?.id,
        message: message.trim(),
        channel: selectedTemplate?.channel || "douyin",
        accountId: customer.sourceAccount?.id || undefined,
        accountName: customer.sourceAccount?.name || undefined,
      });
      setPreparation(result);
      await onPrepared();
      toast.success("测试发送已准备，尚未发送");
    } catch (error) {
      toast.error(toPublicError(error, "测试发送未准备好，请重试。"));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <section aria-labelledby="welcome-message-heading" className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-divider pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            id="welcome-message-heading"
            className="text-base font-semibold text-foreground"
          >
            欢迎消息
          </h2>
          <p className="mt-1 text-sm text-default-500">
            {customer.sourceAccount?.name || "未指定来源账号"}
          </p>
        </div>
        <Button
          color="primary"
          size="sm"
          startContent={<Plus size={15} />}
          onPress={() => openTemplateModal()}
        >
          新建模板
        </Button>
      </div>

      {templates.length ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)]">
          <div className="space-y-3">
            <Select
              label="消息模板"
              selectedKeys={selectedTemplateId ? [selectedTemplateId] : []}
              onSelectionChange={(keys) =>
                selectTemplate(String(Array.from(keys)[0] || ""))
              }
            >
              {templates.map((template) => (
                <SelectItem key={template.id}>
                  {template.name} · {channelLabels[template.channel]}
                </SelectItem>
              ))}
            </Select>
            <div className="flex gap-2">
              <Tooltip content="编辑模板">
                <Button
                  isIconOnly
                  aria-label="编辑模板"
                  size="sm"
                  variant="flat"
                  onPress={() =>
                    selectedTemplate && openTemplateModal(selectedTemplate)
                  }
                >
                  <Edit3 size={15} />
                </Button>
              </Tooltip>
              <Tooltip content="归档模板">
                <Button
                  isIconOnly
                  aria-label="归档模板"
                  color="danger"
                  size="sm"
                  variant="flat"
                  onPress={archiveTemplate}
                >
                  <Archive size={15} />
                </Button>
              </Tooltip>
              {selectedTemplate ? (
                <Chip size="sm" variant="flat">
                  {channelLabels[selectedTemplate.channel]}
                </Chip>
              ) : null}
            </div>
          </div>
          <div className="space-y-3">
            <Textarea
              label="测试消息"
              minRows={5}
              value={message}
              onValueChange={(value) => {
                setMessage(value);
                setPreparation(null);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Braces aria-hidden size={15} className="text-default-400" />
              {variables.map((variable) => (
                <Button
                  key={variable.value}
                  size="sm"
                  variant="flat"
                  onPress={() => {
                    setMessage((current) => `${current}${variable.value}`);
                    setPreparation(null);
                  }}
                >
                  {variable.label}
                </Button>
              ))}
            </div>
            <Button
              color="primary"
              isLoading={preparing}
              startContent={!preparing ? <MessageSquareText size={16} /> : null}
              onPress={prepare}
            >
              准备测试发送
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-44 flex-col items-center justify-center gap-3 border border-dashed border-divider px-5 text-center">
          <MessageSquareText size={24} className="text-default-400" />
          <div>
            <p className="font-medium">还没有欢迎消息模板</p>
            <p className="mt-1 text-sm text-default-500">
              新建第一条模板后即可为当前客户准备测试发送。
            </p>
          </div>
          <Button
            color="primary"
            size="sm"
            startContent={<Plus size={15} />}
            onPress={() => openTemplateModal()}
          >
            新建模板
          </Button>
        </div>
      )}

      {preparation ? (
        <div className="border border-warning-300 bg-warning-50 p-4 text-warning-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">测试发送已准备</p>
                <Chip color="warning" size="sm" variant="flat">
                  尚未发送
                </Chip>
              </div>
              <p className="mt-2 text-sm leading-6">{preparation.message}</p>
              <p className="mt-2 text-xs text-warning-800">
                {preparation.targetName} ·{" "}
                {preparation.accountName || "待选账号"}
              </p>
            </div>
            <Button
              as={Link}
              color="warning"
              endContent={<Send size={15} />}
              href={preparationHref(preparation)}
              size="sm"
            >
              前往测试发送
            </Button>
          </div>
        </div>
      ) : null}

      <Modal
        isOpen={modalOpen}
        onOpenChange={(isOpen) => {
          if (isOpen) setModalOpen(true);
          else closeTemplateModal();
        }}
      >
        <ModalContent>
          <ModalHeader>
            {editingTemplateId ? "编辑欢迎消息模板" : "新建欢迎消息模板"}
          </ModalHeader>
          <ModalBody className="gap-4">
            <Input
              label="模板名称"
              value={templateName}
              onValueChange={setTemplateName}
            />
            <Chip size="sm" variant="flat">
              {channelLabels[templateChannel]}
            </Chip>
            <Textarea
              label="模板内容"
              minRows={6}
              value={templateBody}
              onValueChange={setTemplateBody}
            />
            <div className="flex flex-wrap gap-2">
              {variables.map((variable) => (
                <Button
                  key={variable.value}
                  size="sm"
                  variant="flat"
                  onPress={() =>
                    setTemplateBody((current) => `${current}${variable.value}`)
                  }
                >
                  {variable.label}
                </Button>
              ))}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={closeTemplateModal}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={savingTemplate}
              onPress={saveTemplate}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {modal}
    </section>
  );
}
