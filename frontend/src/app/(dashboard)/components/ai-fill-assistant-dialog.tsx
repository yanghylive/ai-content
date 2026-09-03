"use client";

import React from "react";
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";
import { Bot, CheckCircle2 } from "@/components/iconpark";

export type AiFillCandidate = {
  id: string;
  title: string;
  description: string;
  fields: Array<{ label: string; value: string }>;
};

type AiFillAssistantDialogProps = {
  candidates: AiFillCandidate[];
  description: string;
  isOpen: boolean;
  title: string;
  onApply: (candidate: AiFillCandidate) => void;
  onOpenChange: (open: boolean) => void;
};

export function AiFillAssistantDialog({
  candidates,
  description,
  isOpen,
  title,
  onApply,
  onOpenChange,
}: AiFillAssistantDialogProps) {
  const [selectedId, setSelectedId] = React.useState(candidates[0]?.id || "");
  const selected =
    candidates.find((candidate) => candidate.id === selectedId) ||
    candidates[0];

  React.useEffect(() => {
    if (isOpen) setSelectedId(candidates[0]?.id || "");
  }, [candidates, isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      scrollBehavior="inside"
      size="3xl"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Bot aria-hidden="true" className="h-5 w-5 text-primary" />
                <span>{title}</span>
                <Chip color="primary" size="sm" variant="flat">
                  候选回填
                </Chip>
              </div>
              <p className="text-small font-normal leading-6 text-default-500">
                {description}
              </p>
            </ModalHeader>
            <ModalBody>
              <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                <div className="flex flex-col gap-2">
                  {candidates.map((candidate) => {
                    const selectedCandidate = candidate.id === selected?.id;
                    return (
                      <button
                        key={candidate.id}
                        className={[
                          "rounded-[8px] border-small p-3 text-left transition",
                          selectedCandidate
                            ? "border-primary-200 bg-primary-50 text-primary-700"
                            : "border-divider bg-default-50 text-default-700 hover:border-default-300",
                        ].join(" ")}
                        type="button"
                        onClick={() => setSelectedId(candidate.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-small font-semibold">
                            {candidate.title}
                          </span>
                          {selectedCandidate ? (
                            <CheckCircle2
                              aria-hidden="true"
                              className="h-4 w-4"
                            />
                          ) : null}
                        </div>
                        <p className="mt-1 text-tiny leading-5 opacity-80">
                          {candidate.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <div className="rounded-[8px] border-small border-divider bg-default-50 p-4">
                  {selected ? (
                    <div className="grid gap-3">
                      {selected.fields.map((field) => (
                        <div
                          key={`${selected.id}-${field.label}`}
                          className="rounded-[8px] bg-background p-3"
                        >
                          <p className="text-tiny font-semibold text-default-500">
                            {field.label}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-small leading-6 text-default-800">
                            {field.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-small text-default-500">暂无候选内容。</p>
                  )}
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose}>
                取消
              </Button>
              <Button
                color="primary"
                isDisabled={!selected}
                onPress={() => {
                  if (!selected) return;
                  onApply(selected);
                  onClose();
                }}
              >
                回填到表单
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
