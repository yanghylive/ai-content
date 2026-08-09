"use client";

import React, { useState, useEffect } from "react";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Button,
  Input,
  useDisclosure,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  addToast,
  Spinner,
  Chip,
  Select,
  SelectItem,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { RiskConfirmationDialog } from "@/components/risk-confirmation-dialog";
import { publishingApi, PublishAccount } from "@/lib/api/publishing";
import { toPublicError } from "@/lib/public-error";
import { FailureActionPanel } from "../components/failure-action-panel";
import { FunctionalEmptyState } from "../components/functional-empty-state";
import { ResultSummaryPanel } from "../components/result-summary-panel";

function getErrorMessage(error: unknown, fallback: string): string {
  return toPublicError(error, fallback);
}

export default function AccountsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [editingAccount, setEditingAccount] = useState<PublishAccount | null>(
    null,
  );
  const [accountToDelete, setAccountToDelete] = useState<PublishAccount | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formData, setFormData] = useState(createInitialFormData());

  function createInitialFormData() {
    return {
      name: "",
      platform: "wechat",
      appId: "",
      apiToken: "",
      config: {
        apiUrl: "https://mp.idouq.com/api/open/article",
        openComment: 1,
        onlyFansCanComment: 0,
        categoryId: "" as string | number,
        defaultThumbMediaId: "",
        baseUrl: "https://jpage.cn",
        tags: "wechat-official-account,pre-draft-preview",
        visibility: "private" as const,
      },
    };
  }

  const loadAccounts = async () => {
    setIsLoading(true);
    try {
      const data = await publishingApi.getAccounts({
        source: "api",
      });
      setLoadError("");
      setAccounts(data);
    } catch (error: unknown) {
      const message = getErrorMessage(
        error,
        "平台授权暂时无法加载，请重新加载。",
      );
      setLoadError(message);
      addToast({
        title: "加载账号失败",
        description: message,
        color: "danger",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const resetForm = () => {
    setEditingAccount(null);
    setFormData(createInitialFormData());
  };

  const handleAdd = () => {
    resetForm();
    onOpen();
  };

  const handleEdit = (account: PublishAccount) => {
    setEditingAccount(account);
    setFormData({
      name: account.name || "",
      platform: account.platform || "wechat",
      appId: account.appId || "",
      apiToken: "",
      config: {
        apiUrl:
          account.config?.apiUrl || "https://mp.idouq.com/api/open/article",
        openComment: account.config?.openComment ?? 1,
        onlyFansCanComment: account.config?.onlyFansCanComment ?? 0,
        categoryId: account.config?.categoryId ?? "",
        defaultThumbMediaId: account.config?.defaultThumbMediaId ?? "",
        baseUrl: account.config?.baseUrl || "https://jpage.cn",
        tags: Array.isArray(account.config?.tags)
          ? account.config.tags.join(",")
          : account.config?.tags || "wechat-official-account,pre-draft-preview",
        visibility: "private" as const,
      },
    });
    onOpen();
  };

  const handleSave = async () => {
    if (
      !formData.name ||
      (formData.platform === "wechat" && !formData.appId) ||
      (formData.platform === "jpage" && !formData.config.baseUrl) ||
      (!editingAccount?.hasApiToken && !formData.apiToken)
    ) {
      addToast({ title: "请填写完整信息", color: "warning" });
      return;
    }
    setIsSaving(true);
    try {
      if (editingAccount) {
        await publishingApi.updateAccount(editingAccount.id, {
          ...formData,
          apiToken: formData.apiToken || undefined,
        });
        addToast({ title: "账号更新成功", color: "success" });
      } else {
        await publishingApi.createAccount(formData);
        addToast({ title: "添加账号成功", color: "success" });
      }
      onClose();
      resetForm();
      loadAccounts();
    } catch (error: unknown) {
      addToast({
        title: editingAccount ? "更新失败" : "添加失败",
        description: getErrorMessage(
          error,
          editingAccount
            ? "平台授权未更新，请检查填写内容后重试。"
            : "平台授权未添加，请检查填写内容后重试。",
        ),
        color: "danger",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!accountToDelete) return;
    setIsDeleting(true);
    try {
      const confirmation = await publishingApi.createAccountDeleteConfirmation(
        accountToDelete.id,
      );
      await publishingApi.deleteAccount(
        accountToDelete.id,
        confirmation.confirmationId,
      );
      addToast({ title: "删除成功", color: "success" });
      setAccountToDelete(null);
      loadAccounts();
    } catch (error: unknown) {
      addToast({
        title: "删除失败",
        description: getErrorMessage(error, "平台授权未删除，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setIsDeleting(false);
    }
  };
  useEffect(() => {
    setIsMounted(true);
  }, []);
  if (!isMounted) return null;
  return (
    <div className="flex flex-col gap-4 w-full max-w-[1000px] mx-auto pb-10">
      <header className="rounded-[8px] border-small border-divider flex items-center justify-between gap-3 p-5 bg-background shadow-sm">
        <div className="flex flex-col">
          <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            平台授权配置
          </h2>
          <span className="text-small text-default-500 mt-1">
            配置公众号等平台的授权信息、发文参数和安全凭证。
          </span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            as="a"
            href="/distribution?tab=accounts"
            startContent={<Icon icon="solar:key-minimalistic-square-linear" />}
            variant="flat"
          >
            平台账号登录
          </Button>
          <Button
            as="a"
            href="/intelligence/redfox"
            startContent={<Icon icon="solar:plug-circle-linear" />}
            variant="flat"
          >
            数据来源
          </Button>
          <Button
            color="primary"
            onClick={handleAdd}
            startContent={<Icon icon="solar:add-circle-bold" />}
          >
            添加授权
          </Button>
        </div>
      </header>
      {loadError ? (
        <FailureActionPanel
          actions={[
            {
              label: "重新加载",
              onPress: () => {
                void loadAccounts();
              },
            },
            { href: "/distribution?tab=accounts", label: "平台账号登录" },
          ]}
          impact="发布中心和公众号发布暂时无法读取授权配置。"
          nextAction="先重新加载；如果仍失败，检查平台授权配置；若是真实平台登录态问题，到平台账号登录页处理。"
          reason="平台授权读取失败，可能是授权配置、凭证或服务连接暂时不可用。"
          technicalDetails={loadError}
          title="平台授权需要处理"
        />
      ) : null}
      <ResultSummaryPanel
        actions={[
          { label: "添加授权", onPress: handleAdd },
          { href: "/distribution?tab=accounts", label: "平台账号登录" },
          { href: "/distribution", label: "发布中心" },
        ]}
        failed={loadError ? 1 : 0}
        skipped={0}
        succeeded={accounts.length}
        subtitle="这里管理公众号等平台的发布授权；平台账号登录和本机发布能力仍在平台账号与发布中心处理。"
        title="平台发布授权"
        total={accounts.length + (loadError ? 1 : 0)}
      />
      <Table aria-label="平台授权配置列表">
        <TableHeader>
          <TableColumn>平台</TableColumn>
          <TableColumn>配置名称</TableColumn>
          <TableColumn>AppID / 标识</TableColumn>
          <TableColumn>操作</TableColumn>
        </TableHeader>
        <TableBody
          emptyContent={
            isLoading ? (
              <Spinner />
            ) : (
              <FunctionalEmptyState
                actions={[
                  { label: "添加授权", onPress: handleAdd },
                  { href: "/distribution?tab=accounts", label: "平台账号登录" },
                  { href: "/distribution", label: "发布中心" },
                ]}
                description="这里用于配置公众号等平台发布授权。没有授权时，发布中心仍可走平台账号登录方式，但授权发布和发文参数不会生效。"
                examples={["微信公众号", "发文参数", "授权凭证", "发布中心"]}
                surface="plain"
                title="当前没有平台授权"
              />
            )
          }
          items={accounts}
        >
          {(item) => (
            <TableRow key={item.id}>
              <TableCell>
                <Chip
                  color={item.platform === "jpage" ? "primary" : "success"}
                  variant="flat"
                  size="sm"
                  startContent={
                    <Icon
                      icon={
                        item.platform === "jpage"
                          ? "solar:document-text-linear"
                          : "fa-brands:weixin"
                      }
                    />
                  }
                >
                  {item.platform === "jpage" ? "JPage" : "公众号"}
                </Chip>
              </TableCell>
              <TableCell>{item.name}</TableCell>
              <TableCell>
                {item.platform === "jpage"
                  ? item.config?.baseUrl || "https://jpage.cn"
                  : item.appId}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-center gap-2">
                  <Button
                    isIconOnly
                    variant="light"
                    size="sm"
                    onClick={() => handleEdit(item)}
                  >
                    <Icon icon="solar:pen-linear" width={18} />
                  </Button>
                  <Button
                    isIconOnly
                    color="danger"
                    variant="light"
                    size="sm"
                    onClick={() => setAccountToDelete(item)}
                  >
                    <Icon icon="solar:trash-bin-trash-linear" width={18} />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Modal
        isOpen={isOpen}
        onClose={() => {
          onClose();
          resetForm();
        }}
      >
        <ModalContent>
          <ModalHeader>
            {editingAccount ? "编辑平台授权" : "添加平台授权"}
          </ModalHeader>
          <ModalBody className="gap-4">
            <Select
              label="所属平台"
              selectedKeys={[formData.platform]}
              onSelectionChange={(keys) =>
                setFormData({
                  ...formData,
                  platform: String(Array.from(keys)[0] || "wechat"),
                })
              }
            >
              <SelectItem key="wechat">微信公众号</SelectItem>
              <SelectItem key="jpage">JPage 私有预览</SelectItem>
            </Select>
            <Input
              label="配置名称"
              placeholder="例如：主账号"
              value={formData.name}
              onValueChange={(v) => setFormData({ ...formData, name: v })}
            />
            {formData.platform === "wechat" ? (
              <>
                <Input
                  label="发布服务地址"
                  placeholder="如: https://mp.example.com/open/article"
                  value={formData.config.apiUrl}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, apiUrl: v },
                    })
                  }
                />
                <Input
                  label="AppID"
                  placeholder="请输入公众号 AppID 或原始 ID"
                  value={formData.appId}
                  onValueChange={(v) => setFormData({ ...formData, appId: v })}
                />
              </>
            ) : (
              <>
                <Input
                  label="JPage 服务地址"
                  placeholder="https://jpage.cn"
                  type="url"
                  value={formData.config.baseUrl}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, baseUrl: v },
                    })
                  }
                />
                <Input
                  label="私有预览标签"
                  value={formData.config.tags}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, tags: v },
                    })
                  }
                />
              </>
            )}
            <Input
              description={
                editingAccount?.hasApiToken
                  ? "已保存令牌；留空表示保持不变"
                  : undefined
              }
              label="授权令牌"
              type="password"
              placeholder={
                editingAccount?.hasApiToken
                  ? "留空保持现有令牌"
                  : "请输入平台授权令牌"
              }
              value={formData.apiToken}
              onValueChange={(v) => setFormData({ ...formData, apiToken: v })}
            />
            {formData.platform === "wechat" ? (
              <>
                <Input
                  label="默认封面 media_id"
                  placeholder="微信永久素材 media_id"
                  value={formData.config.defaultThumbMediaId}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      config: {
                        ...formData.config,
                        defaultThumbMediaId: v,
                      },
                    })
                  }
                />
                <Input
                  label="分类 ID (可选)"
                  placeholder="如需分类发文，请输入分类 ID"
                  type="number"
                  value={String(formData.config.categoryId || "")}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      config: {
                        ...formData.config,
                        categoryId: Number(v),
                      },
                    })
                  }
                />
                <div className="flex gap-4 mt-2">
                  <Select
                    label="开启留言?"
                    size="sm"
                    selectedKeys={[String(formData.config.openComment ?? 1)]}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: {
                          ...formData.config,
                          openComment: Number(e.target.value),
                        },
                      })
                    }
                  >
                    <SelectItem key="1">是</SelectItem>
                    <SelectItem key="0">否</SelectItem>
                  </Select>
                  <Select
                    label="仅限粉丝留言?"
                    size="sm"
                    selectedKeys={[
                      String(formData.config.onlyFansCanComment ?? 0),
                    ]}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: {
                          ...formData.config,
                          onlyFansCanComment: Number(e.target.value),
                        },
                      })
                    }
                  >
                    <SelectItem key="1">是</SelectItem>
                    <SelectItem key="0">否</SelectItem>
                  </Select>
                </div>
              </>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button
              color="danger"
              variant="light"
              onClick={() => {
                onClose();
                resetForm();
              }}
            >
              取消
            </Button>
            <Button color="primary" onClick={handleSave} isLoading={isSaving}>
              保存设置
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <RiskConfirmationDialog
        checklist={[
          "确认该平台授权不再用于发布、检查或内容分发。",
          "删除后需要重新填写授权信息才能恢复发布能力。",
        ]}
        confirmLabel="确认删除"
        description="删除平台授权会移除该发布账号的凭证配置。"
        impactItems={[
          {
            label: "配置名称",
            value: accountToDelete?.name || "-",
          },
          {
            label: "平台",
            value: accountToDelete?.platform || "wechat",
          },
          {
            label: "AppID",
            value: accountToDelete?.appId || "-",
          },
        ]}
        isLoading={isDeleting}
        isOpen={Boolean(accountToDelete)}
        riskLevel="high"
        title="确认删除平台授权"
        onCancel={() => setAccountToDelete(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
