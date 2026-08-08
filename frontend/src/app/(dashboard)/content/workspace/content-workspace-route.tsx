"use client";

import { useSearchParams } from "next/navigation";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { ContentWorkspaceClient } from "./content-workspace-client";
import { ContentWorkspaceIntentEntry } from "./content-workspace-intent-entry";
import { useContentWorkspaceRollout } from "@/lib/content-workspace/rollout";
import {
  parseWorkspaceIntent,
  shouldShowWorkspaceIntent,
} from "./workspace-intent";

export function ContentWorkspaceRoute() {
  const searchParams = useSearchParams();
  const intent = parseWorkspaceIntent(searchParams);
  const showIntent = Boolean(intent && shouldShowWorkspaceIntent(searchParams));
  const rollout = useContentWorkspaceRollout(showIntent);

  const content =
    intent && showIntent && rollout.status === "enabled" ? (
      <ContentWorkspaceIntentEntry intent={intent} rollout={rollout} />
    ) : (
      <ContentWorkspaceClient />
    );

  return (
    <Layout height="fill">
      <LayoutContent padding={6}>
        <VStack gap={2}>
          <Text color="secondary" type="supporting">
            商业增长 · 内容工作室
          </Text>
          <Heading level={1}>内容工作室</Heading>
          <Text color="secondary">
            从情报发现到内容生成、合规检查、发布管理——一体化创作中心。
          </Text>
          <div
            style={{
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              padding: "12px 14px",
              borderRadius: 12,
              background:
                "linear-gradient(135deg, rgba(47,109,180,.18), rgba(124,58,237,.14))",
              border: "1px solid rgba(120,150,200,.28)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#17325b" }}>
                新版「内容生成」已上线
              </div>
              <div style={{ fontSize: 12, color: "#5b6b7e", marginTop: 2 }}>
                常用创作、选题、草稿都在那里，入口更轻、加载更快。
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/content";
              }}
              style={{
                flexShrink: 0,
                fontSize: 13,
                fontWeight: 700,
                padding: "9px 16px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                color: "#17325b",
                background: "#f4bb67",
              }}
            >
              去内容生成 →
            </button>
          </div>
        </VStack>
      </LayoutContent>
      {content}
    </Layout>
  );
}