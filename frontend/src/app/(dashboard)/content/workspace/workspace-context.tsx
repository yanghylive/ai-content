"use client";

import { Chip, Input, ScrollShadow, Tabs, Tab } from "@heroui/react";
import {
  BookOpen,
  Library,
  Palette,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildReviewChecks,
  type EditorValue,
  type WorkspaceBrandVoice,
  type WorkspaceKnowledgeView,
  type WorkspaceMaterialView,
} from "./workspace-types";

type ContextTab = "materials" | "brand" | "knowledge" | "checks";

type WorkspaceContextProps = {
  value: EditorValue;
  materials: WorkspaceMaterialView[];
  knowledge: WorkspaceKnowledgeView[];
  brandVoice: WorkspaceBrandVoice;
  onInsertMaterial: (material: WorkspaceMaterialView) => void;
  onBrandVoiceChange: (voice: WorkspaceBrandVoice) => void;
  idPrefix?: string;
  variant?: "panel" | "drawer";
};

const TABS: Array<{
  id: ContextTab;
  label: string;
  icon: typeof Library;
}> = [
  { id: "materials", label: "素材", icon: Library },
  { id: "brand", label: "品牌", icon: Palette },
  { id: "knowledge", label: "知识", icon: BookOpen },
  { id: "checks", label: "检查", icon: ShieldCheck },
];

const BRAND_VOICES: Array<{
  id: WorkspaceBrandVoice;
  label: string;
  detail: string;
}> = [
  { id: "professional", label: "专业可信", detail: "结论明确，解释充分，避免夸张承诺" },
  { id: "practical", label: "实战经验", detail: "使用案例、步骤和可验证细节" },
  { id: "concise", label: "克制简洁", detail: "短句优先，减少形容词与重复信息" },
];

export function WorkspaceContext({
  value,
  materials,
  knowledge,
  brandVoice,
  onInsertMaterial,
  onBrandVoiceChange,
  idPrefix = "workspace-context",
  variant = "panel",
}: WorkspaceContextProps) {
  const [activeTab, setActiveTab] = useState<ContextTab>("materials");
  const [knowledgeKeyword, setKnowledgeKeyword] = useState("");
  const checks = useMemo(() => buildReviewChecks(value), [value]);
  const blockedCount = checks.filter((item) => item.status === "blocked").length;
  const passCount = checks.filter((item) => item.status === "pass").length;
  const activeBrandVoice =
    BRAND_VOICES.find((item) => item.id === brandVoice) || BRAND_VOICES[0];
  const contextNextAction = blockedCount
    ? "先打开检查页处理阻塞项"
    : materials.length || knowledge.length
      ? "从素材或知识补充正文"
      : "继续正文编辑并补充依据";
  const contextHandoffLabel = blockedCount
    ? `${blockedCount} 个阻塞项待处理`
    : `${passCount}/${checks.length} 已通过，可交给审核页`;
  const filteredKnowledge = useMemo(() => {
    const keyword = knowledgeKeyword.trim().toLowerCase();
    if (!keyword) return knowledge;
    return knowledge.filter((item) =>
      `${item.title} ${item.excerpt}`.toLowerCase().includes(keyword),
    );
  }, [knowledge, knowledgeKeyword]);
  const renderTabCount = (tabId: ContextTab) => {
    if (tabId === "brand") return undefined;
    const count =
      tabId === "materials"
        ? materials.length
        : tabId === "knowledge"
          ? knowledge.length
          : blockedCount || checks.length;
    return (
      <Chip
        className="h-5 px-1 text-11"
        color={tabId === "checks" && blockedCount ? "danger" : "default"}
        radius="sm"
        size="sm"
        variant="flat"
      >
        {count}
      </Chip>
    );
  };

  return (
    <aside
      aria-label="创作上下文"
      className={`flex min-w-0 flex-col overflow-hidden bg-content1 ${
        variant === "drawer"
          ? "h-full min-h-0"
          : "min-h-[420px] rounded-[6px] border border-divider lg:max-h-[calc(100dvh-12rem)]"
      }`}
    >
      <div className="border-b border-divider px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">创作上下文</h2>
            <p className="mt-0.5 text-xs leading-5 text-default-500">
              素材、品牌、知识和检查放在同一屏，先判断该补哪一块。
            </p>
          </div>
          <Chip radius="sm" size="sm" variant="flat">
            {activeBrandVoice.label}
          </Chip>
        </div>

        <div className="rounded-lg border border-divider bg-content1 p-4 bg-default-100">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">当前上下文</h3>
              <p className="mt-0.5 text-xs leading-5 text-default-500">
                先补依据和表达，再把可交接内容送到审核页。
              </p>
            </div>
            <dl className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <dt className="w-[96px] shrink-0 text-xs text-default-500">当前表达</dt>
                <dd className="text-xs text-foreground">{activeBrandVoice.label}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[96px] shrink-0 text-xs text-default-500">下一步</dt>
                <dd className="text-xs text-foreground">{contextNextAction}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[96px] shrink-0 text-xs text-default-500">交接结果</dt>
                <dd className="text-xs text-foreground">{contextHandoffLabel}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[96px] shrink-0 text-xs text-default-500">素材可插入</dt>
                <dd className="text-xs text-foreground">{materials.length} 条</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[96px] shrink-0 text-xs text-default-500">知识可引用</dt>
                <dd className="text-xs text-foreground">{knowledge.length} 条</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-3">
          <Tabs
            aria-label="创作上下文标签"
            classNames={{ tabList: "w-full" }}
            onSelectionChange={(key) => setActiveTab(key as ContextTab)}
            selectedKey={activeTab}
            size="sm"
            variant="solid"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <Tab
                  aria-controls={`${idPrefix}-${tab.id}`}
                  id={`${idPrefix}-tab-${tab.id}`}
                  key={tab.id}
                  title={
                    <div className="flex items-center gap-1">
                      <Icon aria-hidden="true" className="h-4 w-4" />
                      {tab.label}
                      {renderTabCount(tab.id)}
                    </div>
                  }
                />
              );
            })}
          </Tabs>
        </div>
      </div>

      <ScrollShadow className="min-h-0 flex-1">
        {activeTab === "materials" ? (
          <section
            aria-labelledby={`${idPrefix}-tab-materials`}
            className="p-3"
            id={`${idPrefix}-materials`}
            role="tabpanel"
          >
            <div className="rounded-lg border border-divider bg-content1 p-4">
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">可用素材</h3>
                  <p className="mt-0.5 text-xs leading-5 text-default-500">
                    点一下就会追加到正文并触发自动保存。
                  </p>
                </div>
                {materials.length ? (
                  <div className="space-y-1.5">
                    {materials.map((material) => (
                      <div
                        key={material.id}
                        className="flex items-start gap-2 cursor-pointer py-2"
                        onClick={() => onInsertMaterial(material)}
                      >
                        <Library aria-hidden="true" className="mt-0.5 h-4 w-4 text-primary" />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-sm font-medium text-foreground">{material.title}</span>
                          <span className="text-xs leading-5 text-default-500 line-clamp-2">{material.summary || "暂无摘要"}</span>
                        </div>
                        <Chip className="ml-auto h-5 px-1 text-11" radius="sm" size="sm" variant="flat">
                          {material.platformLabel}
                        </Chip>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <span className="text-default-400">
                      <Library aria-hidden="true" className="h-6 w-6" />
                    </span>
                    <h3 className="text-sm font-semibold text-foreground">暂无可用素材</h3>
                    <p className="text-xs text-default-500">可先到素材库采集或整理内容。</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "brand" ? (
          <section
            aria-labelledby={`${idPrefix}-tab-brand`}
            className="p-3"
            id={`${idPrefix}-brand`}
            role="tabpanel"
          >
            <div className="rounded-lg border border-divider bg-content1 p-4">
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">品牌表达</h3>
                  <p className="mt-0.5 text-xs leading-5 text-default-500">
                    用于本地规则预览和人工复核，不会在未确认时改写正文。
                  </p>
                </div>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
                >
                  {BRAND_VOICES.map((voice) => {
                    const selected = brandVoice === voice.id;
                    return (
                      <div
                        aria-checked={selected}
                        aria-label={voice.label}
                        className={`cursor-pointer rounded-lg border p-3 ${selected ? "border-primary ring-2 ring-primary/30 bg-primary-50" : "border-divider hover:border-default-300"}`}
                        key={voice.id}
                        onClick={() => onBrandVoiceChange(voice.id)}
                        role="radio"
                      >
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">{voice.label}</p>
                          <p className="text-xs leading-5 text-default-500">{voice.detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "knowledge" ? (
          <section
            aria-labelledby={`${idPrefix}-tab-knowledge`}
            className="p-3"
            id={`${idPrefix}-knowledge`}
            role="tabpanel"
          >
            <div className="rounded-lg border border-divider bg-content1 p-4">
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">知识引用</h3>
                  <p className="mt-0.5 text-xs leading-5 text-default-500">
                    搜索已有知识，给正文补足可引用依据。
                  </p>
                </div>
                <Input
                  aria-label="搜索知识引用"
                  classNames={{ inputWrapper: "h-9 min-h-9 rounded-[6px]" }}
                  placeholder="搜索当前知识上下文"
                  size="sm"
                  startContent={<Search aria-hidden="true" className="h-4 w-4 text-default-400" />}
                  value={knowledgeKeyword}
                  variant="bordered"
                  onValueChange={setKnowledgeKeyword}
                />
                {filteredKnowledge.length ? (
                  <div className="space-y-1.5">
                    {filteredKnowledge.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-2 py-2"
                      >
                        <BookOpen aria-hidden="true" className="mt-0.5 h-4 w-4 text-primary" />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-sm font-medium text-foreground">{item.title}</span>
                          <span className="text-xs leading-5 text-default-500 line-clamp-2">{item.excerpt}</span>
                        </div>
                        <Chip className="ml-auto h-5 px-1 text-11" radius="sm" size="sm" variant="flat">
                          {item.sourceLabel}
                        </Chip>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <span className="text-default-400">
                      <BookOpen aria-hidden="true" className="h-6 w-6" />
                    </span>
                    <h3 className="text-sm font-semibold text-foreground">
                      {knowledgeKeyword ? "没有匹配的知识引用" : "暂无可引用知识"}
                    </h3>
                    <p className="text-xs text-default-500">
                      {knowledgeKeyword
                        ? "换个关键词再试，或清空搜索回到全部知识。"
                        : "当前还没有可引用的知识片段。"}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "checks" ? (
          <section
            aria-labelledby={`${idPrefix}-tab-checks`}
            className="p-3"
            id={`${idPrefix}-checks`}
            role="tabpanel"
          >
            <div className="rounded-lg border border-divider bg-content1 p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">即时检查</h3>
                    <p className="mt-0.5 text-xs leading-5 text-default-500">
                      进入发布准备前先看阻塞项和提醒项。
                    </p>
                  </div>
                  <Chip
                    color={blockedCount ? "danger" : "success"}
                    radius="sm"
                    size="sm"
                    variant="flat"
                  >
                    {blockedCount ? `${blockedCount} 个阻塞项` : `${passCount}/${checks.length} 通过`}
                  </Chip>
                </div>
                <div className="space-y-1.5">
                  {checks.map((check) => (
                    <div
                      key={check.id}
                      className="flex items-start gap-2 py-2"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                          check.status === "pass"
                            ? "bg-success"
                            : check.status === "blocked"
                              ? "bg-danger"
                              : "bg-warning"
                        }`}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">{check.label}</span>
                        <span className="text-xs leading-5 text-default-500 line-clamp-2">{check.detail}</span>
                      </div>
                      <Chip
                        className="ml-auto"
                        color={
                          check.status === "pass"
                            ? "success"
                            : check.status === "blocked"
                              ? "danger"
                              : "warning"
                        }
                        radius="sm"
                        size="sm"
                        variant="flat"
                      >
                        {check.status === "pass"
                          ? "通过"
                          : check.status === "blocked"
                            ? "阻塞"
                            : "提醒"}
                      </Chip>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </ScrollShadow>
    </aside>
  );
}
