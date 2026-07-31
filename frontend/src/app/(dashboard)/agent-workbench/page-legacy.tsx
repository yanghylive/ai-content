import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { AgentConsolePage } from "./agent-workbench-client";


export default function Page() {
  return (
    <Layout height="fill">
      <LayoutContent padding={6}>
        <VStack gap={2}>
          
            <Text color="secondary" type="supporting">商业增长 · 智能体工作台</Text>
            <Heading level={1}>AI 工作台</Heading>
            <Text color="secondary">AI 对话、任务编排、证据查看——从指令到结果。</Text>
          </VStack>
        
      </LayoutContent>
      <AgentConsolePage />
    </Layout>
  );
}