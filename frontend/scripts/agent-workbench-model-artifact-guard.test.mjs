import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relativePath) {
  return readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.notEqual(end, -1, `${endMarker} must follow ${startMarker}`);
  return source.slice(start, end);
}

const pageSource = read(
  "src/app/(dashboard)/agent-workbench/agent-conversation-workbench.tsx",
);
const hookSource = read("src/lib/ops-workbench/hooks/use-agent-s-state.ts");

test("Agent workbench blocks model runs and links to model configuration", () => {
  const sendMessage = block(
    pageSource,
    "const sendMessage = async () =>",
    "const uploadAttachments = async",
  );

  assert.match(sendMessage, /const availableModel = models\.find/);
  assert.match(sendMessage, /if \(!availableModel\)/);
  assert.match(sendMessage, /modelId: availableModel\.id/);
  assert.match(pageSource, /!selectedModel \|\|/);
  assert.match(pageSource, /href="\/capabilities\/models"/);
  assert.match(pageSource, /尚无可用文本模型，发送和重试已暂停/);
});

test("conversation refresh preserves real artifact API failures", () => {
  const refreshConversation = block(
    hookSource,
    "const refreshAgentSConversation = useCallback",
    "const createAgentSConversation = useCallback",
  );

  assert.match(refreshConversation, /agentSGetArtifacts\(sessionId\)/);
  assert.doesNotMatch(
    refreshConversation,
    /agentSGetArtifacts\(sessionId\)[\s\S]*?\.catch\(/,
  );
  assert.match(refreshConversation, /setAgentSError\(message\)/);
  assert.match(refreshConversation, /throw error/);
});
