#!/usr/bin/env node
const path = require("path");
const {
  assertPrismaReleaseAssets,
  createGuardContext,
  printFailuresAndExit,
} = require("./release-guards");

const desktopRoot = path.resolve(__dirname, "..");
const prismaRoot = path.resolve(desktopRoot, "..", "backend", "prisma");
const guard = createGuardContext();

assertPrismaReleaseAssets(guard, prismaRoot, "backend Prisma assets");
printFailuresAndExit(guard, "Prisma release asset check failed:");

console.log("Prisma release asset check passed.");
