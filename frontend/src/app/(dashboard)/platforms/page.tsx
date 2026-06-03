"use client";

import React, { useState, useEffect } from "react";
import {
    Table, TableHeader, TableColumn, TableBody, TableRow, TableCell,
    Button, Input, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
    addToast, Spinner, Chip,
    Select,
    SelectItem
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { publishingApi, PublishAccount } from "@/lib/api/publishing";

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "未知错误";
}

export default function AccountsPage() {
    const [isMounted, setIsMounted] = useState(false);
    const [accounts, setAccounts] = useState<PublishAccount[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [editingAccount, setEditingAccount] = useState<PublishAccount | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [formData, setFormData] = useState(createInitialFormData());

    function createInitialFormData() {
        return {
            name: '',
            platform: 'wechat',
            appId: '',
            apiToken: '',
            config: {
                apiUrl: 'https://mp.idouq.com/api/open/article',
                openComment: 1,
                onlyFansCanComment: 0,
                categoryId: '' as string | number,
            },
        };
    }

    const loadAccounts = async () => {
        setIsLoading(true);
        try {
            const data = await publishingApi.getAccounts({ source: "api", platform: "wechat" });
            setAccounts(data);
        } catch (error: unknown) {
            addToast({ title: "加载账号失败", description: getErrorMessage(error), color: "danger" });
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
            name: account.name || '',
            platform: account.platform || 'wechat',
            appId: account.appId || '',
            apiToken: account.apiToken || '',
            config: {
                apiUrl: account.config?.apiUrl || 'https://mp.idouq.com/api/open/article',
                openComment: account.config?.openComment ?? 1,
                onlyFansCanComment: account.config?.onlyFansCanComment ?? 0,
                categoryId: account.config?.categoryId ?? '',
            },
        });
        onOpen();
    };

    const handleSave = async () => {
        if (!formData.name || !formData.appId || !formData.apiToken) {
            addToast({ title: "请填写完整信息", color: "warning" });
            return;
        }
        setIsSaving(true);
        try {
            if (editingAccount) {
                await publishingApi.updateAccount(editingAccount.id, formData);
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
                description: getErrorMessage(error),
                color: "danger",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm("确定要删除此发布账号吗？")) {
            try {
                await publishingApi.deleteAccount(id);
                addToast({ title: "删除成功", color: "success" });
                loadAccounts();
            } catch (error: unknown) {
                addToast({ title: "删除失败", description: getErrorMessage(error), color: "danger" });
            }
        }
    };

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) return null;

    return (
        <div className="flex flex-col gap-6 w-full max-w-[1000px] mx-auto pb-10">
            <header className="rounded-[10px] border-small border-white/10 flex items-center justify-between gap-3 p-5 bg-background/60 backdrop-blur-md shadow-sm">
                <div className="flex flex-col">
                    <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">发布账号配置</h2>
                    <span className="text-small text-default-500 mt-1">配置第三方平台的授权信息（如微信公众号的 API Token / AppID）。</span>
                </div>
                <Button color="primary" onClick={handleAdd} startContent={<Icon icon="solar:add-circle-bold" />}>
                    添加账号
                </Button>
            </header>

            <Table aria-label="账号列表">
                <TableHeader>
                    <TableColumn>平台</TableColumn>
                    <TableColumn>名称</TableColumn>
                    <TableColumn>AppID / 标识</TableColumn>
                    <TableColumn>操作</TableColumn>
                </TableHeader>
                <TableBody emptyContent={isLoading ? <Spinner /> : "暂无配置任何账号"} items={accounts}>
                    {(item) => (
                        <TableRow key={item.id}>
                            <TableCell>
                                <Chip color="success" variant="flat" size="sm" startContent={<Icon icon="fa-brands:weixin" />}>
                                    公众号
                                </Chip>
                            </TableCell>
                            <TableCell>{item.name}</TableCell>
                            <TableCell>{item.appId}</TableCell>
                            <TableCell>
                                <div className="flex items-center justify-center gap-2">
                                    <Button isIconOnly variant="light" size="sm" onClick={() => handleEdit(item)}>
                                        <Icon icon="solar:pen-linear" width={18} />
                                    </Button>
                                    <Button isIconOnly color="danger" variant="light" size="sm" onClick={() => handleDelete(item.id)}>
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
                    <ModalHeader>{editingAccount ? "编辑发布账号" : "添加发布账号"}</ModalHeader>
                    <ModalBody className="gap-4">
                        <Select
                            label="所属平台"
                            selectedKeys={[formData.platform]}
                            onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                            isDisabled // 当前只支持微信
                        >
                            <SelectItem key="wechat">微信公众号</SelectItem>
                        </Select>
                        <Input
                            label="配置名称"
                            placeholder="例如：主账号"
                            value={formData.name}
                            onValueChange={(v) => setFormData({ ...formData, name: v })}
                        />
                        <Input
                            label="第三方 API 地址"
                            placeholder="如: https://mp.idouq.com/api/open/article"
                            value={formData.config.apiUrl}
                            onValueChange={(v) => setFormData({ ...formData, config: { ...formData.config, apiUrl: v } })}
                        />
                        <Input
                            label="AppID"
                            placeholder="请输入公众号 AppID 或原始 ID"
                            value={formData.appId}
                            onValueChange={(v) => setFormData({ ...formData, appId: v })}
                        />
                        <Input
                            label="API Token (Bearer)"
                            type="password"
                            placeholder="请输入第三方授权 Token"
                            value={formData.apiToken}
                            onValueChange={(v) => setFormData({ ...formData, apiToken: v })}
                        />
                        <Input
                            label="分类 ID (可选)"
                            placeholder="如需分类发文，请输入分类 ID"
                            type="number"
                            value={String(formData.config.categoryId || '')}
                            onValueChange={(v) => setFormData({ ...formData, config: { ...formData.config, categoryId: Number(v) } })}
                        />
                        <div className="flex gap-4 mt-2">
                            <Select
                                label="开启留言?"
                                size="sm"
                                selectedKeys={[String(formData.config.openComment ?? 1)]}
                                onChange={(e) => setFormData({ ...formData, config: { ...formData.config, openComment: Number(e.target.value) } })}
                            >
                                <SelectItem key="1">是</SelectItem>
                                <SelectItem key="0">否</SelectItem>
                            </Select>
                            <Select
                                label="仅限粉丝留言?"
                                size="sm"
                                selectedKeys={[String(formData.config.onlyFansCanComment ?? 0)]}
                                onChange={(e) => setFormData({ ...formData, config: { ...formData.config, onlyFansCanComment: Number(e.target.value) } })}
                            >
                                <SelectItem key="1">是</SelectItem>
                                <SelectItem key="0">否</SelectItem>
                            </Select>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button color="danger" variant="light" onClick={() => {
                            onClose();
                            resetForm();
                        }}>取消</Button>
                        <Button color="primary" onClick={handleSave} isLoading={isSaving}>保存设置</Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    );
}
