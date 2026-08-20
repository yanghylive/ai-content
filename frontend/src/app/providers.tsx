"use client";

import { Theme as AstryxTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";
import { HeroUIProvider, ToastProvider } from "@heroui/react";
import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
} from "next-themes";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import { ClientConfigProvider } from "@/lib/hooks/use-client-config";
import { ErrorReportBridge } from "@/lib/error-report-bridge";

const neutralThemeWithPrebuiltCss = {
  ...neutralTheme,
  __built: true as const,
};

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

function AstryxThemeBridge({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useNextTheme();
  const isMounted = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const mode = isMounted && resolvedTheme === "light" ? "light" : "dark";

  // 0.1.7's built JS entry has a broken extensionless icon import. The source
  // object is equivalent, and __built tells Astryx to use the imported CSS.
  return (
    <AstryxTheme theme={neutralThemeWithPrebuiltCss} mode={mode}>
      {children}
    </AstryxTheme>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <HeroUIProvider navigate={router.push}>
      <NextThemesProvider attribute="class" defaultTheme="light">
        <ClientConfigProvider>
          <AstryxThemeBridge>
            <ToastProvider placement="top-right" />
            <GlobalErrorBoundary />
            <ErrorReportBridge />
            {children}
          </AstryxThemeBridge>
        </ClientConfigProvider>
      </NextThemesProvider>
    </HeroUIProvider>
  );
}
