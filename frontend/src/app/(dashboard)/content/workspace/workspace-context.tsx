"use client";

import { Chip, Input, ScrollShadow } from "@heroui/react";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Item } from "@astryxdesign/core/Item";
import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Tab, TabList } from "@astryxdesign/core/TabList";
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
        className="h-5 px-1 text-[10px]"
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

        <Card padding={4} variant="muted">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">当前上下文</h3>
              <p className="mt-0.5 text-xs leading-5 text-default-500">
                先补依据和表达，再把可交接内容送到审核页。
              </p>
            </div>
            <MetadataList columns="single" label={{ position: "start", width: 96 }}>
              <MetadataListItem label="当前表达">
                {activeBrandVoice.label}
              </MetadataListItem>
              <MetadataListItem label="下一步">
                {contextNextAction}
              </MetadataListItem>
              <MetadataListItem label="交接结果">
                {contextHandoffLabel}
              </MetadataListItem>
              <MetadataListItem label="素材可插入">
                {materials.length} 条
              </MetadataListItem>
              <MetadataListItem label="知识可引用">
                {knowledge.length} 条
              </MetadataListItem>
            </MetadataList>
          </div>
        </Card>

        <div className="mt-3">
          <TabList
            hasDivider
            layout="fill"
            size="sm"
            value={activeTab}
            onChange={(value) => setActiveTab(value as ContextTab)}
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <Tab
                  key={tab.id}
                  aria-controls={`${idPrefix}-${tab.id}`}
                  endContent={renderTabCount(tab.id)}
                  icon={<Icon aria-hidden="true" className="h-4 w-4" />}
                  id={`${idPrefix}-tab-${tab.id}`}
                  label={tab.label}
                  value={tab.id}
                />
              );
            })}
          </TabList>
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
            <Card padding={4}>
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
                      <Item
                        key={material.id}
                        align="start"
                        density="compact"
                        description={material.summary || "暂无摘要"}
                        descriptionLines={2}
                        endContent={
                          <Chip className="h-5 px-1 text-[10px]" radius="sm" size="sm" variant="flat">
                            {material.platformLabel}
                          </Chip>
                        }
                        label={material.title}
                        startContent={
                          <Library aria-hidden="true" className="mt-0.5 h-4 w-4 text-primary" />
                        }
                        onClick={() => onInsertMaterial(material)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    description="可先到素材库采集或整理内容。"
                    headingLevel={3}
                    icon={<Library aria-hidden="true" className="h-6 w-6" />}
                    isCompact
                    title="暂无可用素材"
                  />
                )}
              </div>
            </Card>
          </section>
        ) : null}

        {activeTab === "brand" ? (
          <section
            aria-labelledby={`${idPrefix}-tab-brand`}
            className="p-3"
            id={`${idPrefix}-brand`}
            role="tabpanel"
          >
            <Card padding={4}>
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">品牌表达</h3>
                  <p className="mt-0.5 text-xs leading-5 text-default-500">
                    用于本地规则预览和人工复核，不会在未确认时改写正文。
                  </p>
                </div>
                <Grid columns={{ minWidth: 180, max: 2 }} gap={2}>
                  {BRAND_VOICES.map((voice) => {
                    const selected = brandVoice === voice.id;
                    return (
                      <SelectableCard
                        key={voice.id}
                        label={voice.label}
                        isSelected={selected}
                        padding={3}
                        onChange={(isSelected) => {
                          if (isSelected) onBrandVoiceChange(voice.id);
                        }}
                      >
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">{voice.label}</p>
                          <p className="text-xs leading-5 text-default-500">{voice.detail}</p>
                        </div>
                      </SelectableCard>
                    );
                  })}
                </Grid>
              </div>
            </Card>
          </section>
        ) : null}

        {activeTab === "knowledge" ? (
          <section
            aria-labelledby={`${idPrefix}-tab-knowledge`}
            className="p-3"
            id={`${idPrefix}-knowledge`}
            role="tabpanel"
          >
            <Card padding={4}>
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
                      <Item
                        key={item.id}
                        align="start"
                        density="compact"
                        description={item.excerpt}
                        descriptionLines={2}
                        endContent={
                          <Chip className="h-5 px-1 text-[10px]" radius="sm" size="sm" variant="flat">
                            {item.sourceLabel}
                          </Chip>
                        }
                        label={item.title}
                        startContent={
                          <BookOpen aria-hidden="true" className="mt-0.5 h-4 w-4 text-primary" />
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    description={
                      knowledgeKeyword
                        ? "换个关键词再试，或清空搜索回到全部知识。"
                        : "当前还没有可引用的知识片段。"
                    }
                    headingLevel={3}
                    icon={<BookOpen aria-hidden="true" className="h-6 w-6" />}
                    isCompact
                    title={knowledgeKeyword ? "没有匹配的知识引用" : "暂无可引用知识"}
                  />
                )}
              </div>
            </Card>
          </section>
        ) : null}

        {activeTab === "checks" ? (
          <section
            aria-labelledby={`${idPrefix}-tab-checks`}
            className="p-3"
            id={`${idPrefix}-checks`}
            role="tabpanel"
          >
            <Card padding={4}>
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
                    <Item
                      key={check.id}
                      align="start"
                      density="compact"
                      description={check.detail}
                      descriptionLines={2}
                      endContent={
                        <Chip
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
                      }
                      label={check.label}
                      startContent={
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
                      }
                    />
                  ))}
                </div>
              </div>
            </Card>
          </section>
        ) : null}
      </ScrollShadow>
    </aside>
  );
}
