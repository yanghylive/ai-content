"use client";

import { HeroUIProvider, ToastProvider } from "@heroui/react";
import {
  ThemeProvider as NextThemesProvider,
} from "next-themes";
import { useRouter } from "next/navigation";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import { ClientConfigProvider } from "@/lib/hooks/use-client-config";
import { ErrorReportBridge } from "@/lib/error-report-bridge";
import { MotionProvider } from "@/components/providers/motion-provider";
import { SWRProvider } from "@/lib/swr-config";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <HeroUIProvider navigate={router.push}>
      <NextThemesProvider attribute="class" defaultTheme="light">
        <ClientConfigProvider>
          <SWRProvider>
            <MotionProvider>
              <ToastProvider placement="top-right" />
              <GlobalErrorBoundary />
              <ErrorReportBridge />
              {children}
            </MotionProvider>
          </SWRProvider>
        </ClientConfigProvider>
      </NextThemesProvider>
    </HeroUIProvider>
  );
}
