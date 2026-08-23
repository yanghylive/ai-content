"use client";

import React from "react";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";

/**
 * 统一确认弹窗：替换 window.confirm。
 *
 * - danger：不可逆操作（删除/清空/归档），红色确认按钮
 * - warning：未保存离开警告，黄色确认按钮
 *
 * 无障碍：HeroUI Modal 自带 role=dialog + aria-modal + focus trap + Esc 关闭；
 * 本组件补 aria-labelledby/aria-describedby 关联标题与描述。
 * 防连点：loading 时禁用按钮并阻止关闭。
 */

export type ConfirmModalKind = "danger" | "warning";

export interface ConfirmModalProps {
  open: boolean;
  kind: ConfirmModalKind;
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  kind,
  title,
  description,
  confirmText = "确定",
  cancelText = "取消",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const isDanger = kind === "danger";
  const titleId = React.useId();
  const descId = React.useId();

  return (
    <Modal
      backdrop="blur"
      isDismissable={!loading}
      isKeyboardDismissDisabled={loading}
      hideCloseButton
      isOpen={open}
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
      placement="center"
      size="sm"
      classNames={{
        base: "bg-background border-small border-divider",
        header: "pb-1",
        footer: "pt-1",
      }}
    >
      <ModalContent aria-labelledby={titleId} aria-describedby={descId}>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <span id={titleId} className="text-base font-bold leading-6">
                {title}
              </span>
            </ModalHeader>
            {description ? (
              <ModalBody className="py-2">
                <p
                  id={descId}
                  className="text-small font-normal leading-6 text-default-500"
                >
                  {description}
                </p>
              </ModalBody>
            ) : null}
            <ModalFooter>
              <Button
                color="default"
                isDisabled={loading}
                variant="flat"
                onPress={onCancel}
              >
                {cancelText}
              </Button>
              <Button
                color={isDanger ? "danger" : "warning"}
                isLoading={loading}
                onPress={onConfirm}
              >
                {confirmText}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
