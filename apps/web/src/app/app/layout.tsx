"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/header";
import { Spinner } from "@/components/ui";
import { useSession } from "@/lib/session";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const path = usePathname();
  const fullscreen = path.endsWith("/live");

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, user, router, path]);

  if (!user) return <div className="flex h-dvh items-center justify-center"><Spinner /></div>;
  return fullscreen ? <>{children}</> : <><Header /><main className="mx-auto max-w-6xl px-4 py-8">{children}</main></>;
}
