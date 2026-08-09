import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { BusinessToolResultContext } from "../../components/business-tool-result-context";
import { ContentOptimizationWorkbench } from "./content-optimization-workbench";


export default function ContentOptimizationPage() {
  return (
    <Layout height="fill">
      <LayoutContent padding={6}>
        <VStack gap={2}>
          
            <Text color="secondary" type="supporting">商业增长 · 内容中心</Text>
            <Heading level={1}>内容优化</Heading>
            <Text color="secondary">多平台改写、合规检查、发布准备——适配不同平台。</Text>
          </VStack>
        
      </LayoutContent>
      <div className="flex flex-col gap-4">
        <BusinessToolResultContext allowedTools={["multi-platform-copy"]} />
        <ContentOptimizationWorkbench />
      </div>
    </Layout>
  );
}