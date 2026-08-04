import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function source(relativePath) {
  return readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

test("publish content choices collapse to one column on narrow screens", () => {
  const publishFlow = source("src/app/(dashboard)/distribution/publish-flow.tsx");
  assert.match(publishFlow, /<V2Section title="发什么内容？">\s*<div className="grid gap-3 sm:grid-cols-2">/);
  assert.doesNotMatch(
    publishFlow,
    /<V2Section title="发什么内容？">\s*<div className="grid grid-cols-2 gap-3">/,
  );
});
