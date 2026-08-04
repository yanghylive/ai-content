import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function requireText(source, marker, label) {
  if (!source.includes(marker)) {
    throw new Error(`${label}: missing ${marker}`);
  }
}

const packageJson = JSON.parse(read("package.json"));
const requiredVersions = {
  "@astryxdesign/core": "0.1.7",
  "@astryxdesign/theme-neutral": "0.1.7",
  "@stylexjs/stylex": "0.19.0",
};

for (const [name, version] of Object.entries(requiredVersions)) {
  if (packageJson.dependencies?.[name] !== version) {
    throw new Error(`package.json: ${name} must be pinned to ${version}`);
  }
}
if (packageJson.devDependencies?.["@astryxdesign/cli"] !== "0.1.7") {
  throw new Error("package.json: @astryxdesign/cli must be pinned to 0.1.7");
}
if (packageJson.astryx?.theme !== "neutral") {
  throw new Error("package.json: astryx.theme must be neutral");
}

const layout = read("src/app/layout.tsx");
for (const marker of [
  'import "./astryx-layers.css"',
  'import "@astryxdesign/core/reset.css"',
  'import "@astryxdesign/core/astryx.css"',
  'import "@astryxdesign/theme-neutral/theme.css"',
]) {
  requireText(layout, marker, "root layout");
}

const providers = read("src/app/providers.tsx");
for (const marker of [
  'from "@astryxdesign/core/theme"',
  'from "@astryxdesign/theme-neutral"',
  "neutralThemeWithPrebuiltCss",
  "__built: true",
  "useSyncExternalStore",
  "<AstryxTheme",
  "<HeroUIProvider",
  "<NextThemesProvider",
]) {
  requireText(providers, marker, "providers");
}

const login = read("src/app/login/page.tsx");
for (const component of [
  "AppShell",
  "Banner",
  "Button",
  "Card",
  "Center",
  "Grid",
  "Heading",
  "Spinner",
  "Stack",
  "Text",
]) {
  requireText(
    login,
    `from "@astryxdesign/core/${component}"`,
    "login migration",
  );
}
if (login.includes('from "@heroui/react"')) {
  throw new Error("login migration: HeroUI presentation imports remain");
}
for (const invariant of [
  "normalizeNextPath",
  "getKaypalDesktopDeviceMetadata",
  "startDeviceAuth",
  'phase === "waiting"',
  'phase === "expired"',
  'phase === "denied"',
]) {
  requireText(login, invariant, "login behavior");
}

const dashboardLayout = read("src/app/(dashboard)/layout.tsx");
requireText(
  dashboardLayout,
  'from "@/components/shell/app-shell"',
  "dashboard shell migration",
);
requireText(
  dashboardLayout,
  "<AppShell",
  "dashboard shell migration",
);
if (dashboardLayout.includes("Sidebar Responsive/ts/sidebar")) {
  throw new Error("dashboard shell migration: legacy Sidebar import returned");
}

const dashboardShell = read("src/components/shell/app-shell.tsx");
for (const invariant of [
  'e.key === "Escape"',
  'aria-label="主导航"',
  "<CommandPalette",
  "useNotificationItems()",
  'aria-current={activeScene === scene.key ? "page" : undefined}',
]) {
  requireText(dashboardShell, invariant, "dashboard shell behavior");
}

console.log("Astryx phase 1 and current dashboard shell guard passed.");
