import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Inter } from "next/font/google";
import Script from "next/script";
import type { Locale } from "@retfast/core";
import { I18nProvider } from "@/lib/i18n";
import { SessionProvider } from "@/lib/session";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/lib/theme";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_WEB_URL ?? "https://retfast.com"),
  title: { default: "Retfast — live tracking & retrieve for paragliding events", template: "%s · Retfast" },
  description: "Live tracking, retrieve coordination and safety for paragliding competitions and XC events.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f2f2f7" }, { media: "(prefers-color-scheme: dark)", color: "#08080a" }], width: "device-width", initialScale: 1 };

async function initialLocale(): Promise<Locale> {
  const c = (await cookies()).get("rf_locale")?.value;
  if (c === "tr" || c === "en") return c;
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await initialLocale();
  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <body className="min-h-dvh">
        <Script id="theme-init" strategy="beforeInteractive">{THEME_INIT_SCRIPT}</Script>
        <ThemeProvider>
          <I18nProvider initial={locale}>
            <SessionProvider><TooltipProvider>{children}</TooltipProvider></SessionProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
