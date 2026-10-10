import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { Locale } from "@retfast/core";
import { I18nProvider } from "@/lib/i18n";
import { SessionProvider } from "@/lib/session";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_WEB_URL ?? "https://retfast.com"),
  title: { default: "Retfast — live tracking & retrieve for paragliding events", template: "%s · Retfast" },
  description: "Live tracking, retrieve coordination and safety for paragliding competitions and XC events.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#0d0e10", width: "device-width", initialScale: 1 };

async function initialLocale(): Promise<Locale> {
  const c = (await cookies()).get("rf_locale")?.value;
  if (c === "tr" || c === "en") return c;
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await initialLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        <I18nProvider initial={locale}>
          <SessionProvider>{children}</SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
