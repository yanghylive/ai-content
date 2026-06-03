import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "react-hot-toast";

const useGoogleFonts = process.env.KAYPAL_USE_GOOGLE_FONTS === "1";

const geistSans = useGoogleFonts
  ? require("next/font/google").Geist({
      variable: "--font-geist-sans",
      subsets: ["latin"],
    })
  : null;

const geistMono = useGoogleFonts
  ? require("next/font/google").Geist_Mono({
      variable: "--font-geist-mono",
      subsets: ["latin"],
    })
  : null;

export const metadata: Metadata = {
  title: "My Hero Dashboard",
  description: "Generated with HeroUI Pro",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <body
        className={`${geistSans?.variable ?? ""} ${geistMono?.variable ?? ""} antialiased`}
      >
        <Providers>
          {children}
          <Toaster position="top-center" />
        </Providers>
      </body>
    </html>
  );
}
