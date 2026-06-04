#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const backendRequire = createRequire(
  join(process.cwd(), "backend", "package.json"),
);
const { PrismaClient } = backendRequire("@prisma/client");

const backendEnvPath = join(process.cwd(), "backend", ".env");
loadEnvFile(backendEnvPath);

const prisma = new PrismaClient();

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main() {
  const relatedId =
    process.argv[2] ||
    process.env.RUNTIME_WRITE_SMOKE_TASK_ID ||
    "runtime-write-smoke";
  const executionId = `runtime_write_smoke_${Date.now()}`;
  const created = await prisma.runtimeExecution.create({
    data: {
      id: executionId,
      relatedId,
      relatedType: "interaction-task",
      executor: "local-runtime",
      platform: "douyin",
      taskType: "douyin-comment-reply",
      accountId: null,
      ok: false,
      status: "failed",
      reasonCode: "runtime_unavailable",
      userMessage: "Runtime write smoke: structured rejection persisted",
      technicalMessage: "No real platform action was executed.",
      runtimeJson: {
        mode: "local-runtime",
        executor: "browser-cdp",
        smoke: true,
      },
      evidenceJson: [
        {
          type: "text",
          label: "Runtime write smoke",
          value: "EvidenceService/Prisma persistence contract check",
          createdAt: new Date().toISOString(),
        },
      ],
      readbackJson: null,
      engineUrl: null,
    },
  });

  const fetched = await prisma.runtimeExecution.findUnique({
    where: { id: created.id },
  });
  if (!fetched) {
    throw new Error(`Smoke row was not readable after insert: ${created.id}`);
  }

  await prisma.runtimeExecution.delete({
    where: { id: created.id },
  });

  console.log(
    JSON.stringify(
      {
        status: "passed",
        insertedAndDeleted: created.id,
        relatedId,
      },
      null,
      2,
    ),
  );
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
