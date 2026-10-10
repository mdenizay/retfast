import Link from "next/link";
import { cookies } from "next/headers";
import { translate, type EventSummary, type Locale, type MessageKey } from "@retfast/core";

export const revalidate = 60;

async function publicEvents(): Promise<EventSummary[]> {
  try {
    const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
    const res = await fetch(`${api}/v1/events`, { next: { revalidate: 60 } });
    return res.ok ? ((await res.json()) as { data: EventSummary[] }).data : [];
  } catch {
    return [];
  }
}

function fmt(locale: Locale, iso: string) {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export default async function Landing() {
  const c = (await cookies()).get("rf_locale")?.value;
  const locale: Locale = c === "tr" ? "tr" : "en";
  const t = (k: MessageKey) => translate(locale, k);
  const events = await publicEvents();
  const now = Date.now();
  const groups: [MessageKey, EventSummary[]][] = [
    ["events.current", events.filter((e) => Date.parse(e.starts_at) <= now && Date.parse(e.ends_at) >= now)],
    ["events.upcoming", events.filter((e) => Date.parse(e.starts_at) > now)],
    ["events.past", events.filter((e) => Date.parse(e.ends_at) < now).reverse()],
  ];
  const features: [MessageKey, MessageKey][] = [
    ["landing.f1.title", "landing.f1.body"],
    ["landing.f2.title", "landing.f2.body"],
    ["landing.f3.title", "landing.f3.body"],
    ["landing.f4.title", "landing.f4.body"],
  ];

  return (
    <main>
      <section className="relative overflow-hidden border-b border-line/60">
        <div className="pointer-events-none absolute inset-0 opacity-30 [background:radial-gradient(60rem_30rem_at_80%_-10%,#f3a71240,transparent),radial-gradient(40rem_20rem_at_0%_110%,#5ab8ff22,transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <p className="kicker">{t("landing.kicker")}</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-light leading-[1.05] tracking-tight sm:text-6xl">{t("landing.title")}</h1>
          <p className="mt-6 max-w-2xl text-lg text-muted">{t("landing.lead")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="inline-flex h-12 items-center rounded-full bg-amber px-7 font-semibold text-ink hover:brightness-110">{t("landing.cta")}</Link>
            <Link href="#events" className="inline-flex h-12 items-center rounded-full bg-white/[0.07] px-7 hover:bg-white/[0.12]">{t("landing.cta_events")}</Link>
          </div>
          <p className="mt-6 text-sm text-muted">{t("landing.apps")}</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:grid-cols-2">
        {features.map(([title, body]) => (
          <div key={title} className="rounded-[28px] border border-white/[0.06] bg-surface/90 p-6">
            <h2 className="text-lg font-bold">{t(title)}</h2>
            <p className="mt-2 text-muted">{t(body)}</p>
          </div>
        ))}
      </section>

      <section id="events" className="mx-auto max-w-6xl scroll-mt-20 px-4">
        <h2 className="text-3xl font-light tracking-tight">{t("landing.events")}</h2>
        {events.length === 0 && <p className="mt-6 text-muted">{t("landing.no_events")}</p>}
        {groups.filter(([, list]) => list.length > 0).map(([label, list]) => (
          <div key={label} className="mt-8">
            <p className="kicker">{t(label)}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((e) => (
                <Link key={e.id} href={`/events/${e.id}`} className="group rounded-[28px] border border-white/[0.06] bg-surface/90 p-5 transition hover:border-amber/60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">{[e.city, e.country].filter(Boolean).join(", ")}</span>
                    {e.status === "active" && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber">{t("status.active")}</span>}
                  </div>
                  <h3 className="mt-2 text-lg font-bold group-hover:text-amber">{e.name}</h3>
                  <p className="num mt-1 text-sm text-muted">{fmt(locale, e.starts_at)} – {fmt(locale, e.ends_at)}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
