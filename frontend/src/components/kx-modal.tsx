"use client";

import React from "react";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";

/**
 * 全站统一内容弹窗（B4 2026-08-23）：替代 45 处自写 fixed-overlay 弹窗。
 *
 * 规格：
 * - 宽度三档：sm=480（确认/表单小弹窗）/ md=640（标准表单）/ lg=860（复杂内容）
 * - 圆角 20（--kx-radius）、磨砂玻璃（Modal 底 bg-content1 已玻璃化，自动生效）
 * - 右上角 X 关闭、底部按钮区右对齐（确认在右、取消在左，业界标准）
 * - 遮罩 backdrop=blur（品牌 overlay token）
 *
 * 用法：
 *   <KxModal open={open} onClose={close} title="标题" size="md"
 *     footer={<><KxModalCancel onClick={close}/><Button color="primary" onPress={save}>保存</Button></>}>
 *     内容
 *   </KxModal>
 */

export interface KxModalProps {
  open: boolean;
  onClose: () => void;
  /** 弹窗标题 */
  title?: React.ReactNode;
  /** 宽度档：sm 480 / md 640 / lg 860，默认 md */
  size?: "sm" | "md" | "lg";
  /** 底部按钮区（右对齐由组件保证） */
  footer?: React.ReactNode;
  /** 透传 heroui Modal 其余 props（isDismissable 等） */
  modalProps?: Omit<React.ComponentProps<typeof Modal>, "isOpen" | "children" | "className">;
  children: React.ReactNode;
}

const SIZE_CLASS: Record<"sm" | "md" | "lg", string> = {
  sm: "max-w-[480px]",
  md: "max-w-[640px]",
  lg: "max-w-[860px]",
};

export function KxModal({
  open,
  onClose,
  title,
  size = "md",
  footer,
  modalProps,
  children,
}: KxModalProps) {
  return (
    <Modal
      backdrop="blur"
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      className={`${SIZE_CLASS[size]} rounded-[var(--kx-radius)]`}
      {...modalProps}
    >
      <ModalContent>
        {title ? (
          <ModalHeader className="text-[16px] font-bold text-[var(--kx-ink)]">{title}</ModalHeader>
        ) : null}
        <ModalBody>{children}</ModalBody>
        {footer ? (
          <ModalFooter className="justify-end">{footer}</ModalFooter>
        ) : null}
      </ModalContent>
    </Modal>
  );
}

/** 标准取消按钮（弹窗底部左侧） */
export function KxModalCancel({ onClick, label = "取消" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="kx-btn kx-btn-ghost"
    >
      {label}
    </button>
  );
}
