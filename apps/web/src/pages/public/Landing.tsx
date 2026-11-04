import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BatteryWarning, CloudOff, Database, MapPinned, Satellite, ShieldAlert, Siren, Smartphone } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi } from "@/lib/api/endpoints";
import { APP_STORE_URL } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Loading } from "@/components/common";
import { FreshnessBadge, SimBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { EventRow } from "@/features/events/EventBits";

export default function LandingPage() {
  const { t } = useI18n();
  const events = useQuery({
    queryKey: ["public", "events", "landing"],
    queryFn: () => eventsApi.list({ status: "active,published", limit: 5 }),
  });

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:py-24">
          <div>
            <p className="text-caption font-medium tracking-[0.12em] text-primary uppercase">{t("landing.eyebrow")}</p>
            <h1 className="mt-4 text-[34px] leading-[40px] font-semibold tracking-tight text-fg sm:text-display">{t("landing.title")}</h1>
            <p className="mt-5 max-w-xl text-callout text-fg-secondary">{t("landing.lead")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg"><Link to="/events">{t("landing.ctaEvents")} <ArrowRight /></Link></Button>
              <Button asChild size="lg" variant="outline"><Link to="/login">{t("landing.ctaOps")}</Link></Button>
            </div>
            <div className="mt-6 inline-flex items-center gap-2 text-footnote text-fg-secondary">
              <Smartphone className="size-4" aria-hidden />
              {APP_STORE_URL ? (
                <a href={APP_STORE_URL} className="text-primary hover:underline" rel="noopener">{t("landing.appStore")}</a>
              ) : (
                <span>{t("landing.iosSoon")}</span>
              )}
            </div>
          </div>

          {/* Visual language legend — explains what users will see; not live data. */}
          <div className="rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-5 py-3 text-caption font-medium tracking-wide text-fg-muted uppercase">{t("landing.legendTitle")}</div>
            <ul className="divide-y divide-border">
              <LegendRow badge={<FreshnessBadge freshness="live" />} text={t("landing.legend.live")} />
              <LegendRow badge={<FreshnessBadge freshness="stale" />} text={t("landing.legend.stale")} />
              <LegendRow badge={<FreshnessBadge freshness="lost" />} text={t("landing.legend.lost")} />
              <LegendRow badge={<SimBadge />} text={t("landing.legend.sim")} />
              <LegendRow badge={<Badge variant="emergency"><Siren aria-hidden />SOS</Badge>} text={t("landing.legend.sos")} />
            </ul>
            <p className="border-t border-border px-5 py-3 text-caption text-fg-muted">{t("landing.legendNote")}</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-title2 font-semibold tracking-tight">{t("landing.howTitle")}</h2>
          <ol className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
            {[
              { Icon: Satellite, title: t("landing.how1.title"), body: t("landing.how1.body") },
              { Icon: MapPinned, title: t("landing.how2.title"), body: t("landing.how2.body") },
              { Icon: Siren, title: t("landing.how3.title"), body: t("landing.how3.body") },
            ].map(({ Icon, title, body }, i) => (
              <li key={i} className="bg-surface p-6">
                <div className="flex items-center gap-3">
                  <span className="telemetry text-caption text-fg-muted">0{i + 1}</span>
                  <Icon className="size-5 text-primary" aria-hidden />
                </div>
                <h3 className="mt-4 text-headline font-semibold">{title}</h3>
                <p className="mt-2 text-footnote text-fg-secondary">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Honest limitations */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-title2 font-semibold tracking-tight">{t("landing.limitsTitle")}</h2>
            <p className="mt-3 text-body text-fg-secondary">{t("landing.limitsLead")}</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {[
              { Icon: Satellite, title: t("landing.limit1.title"), body: t("landing.limit1.body") },
              { Icon: CloudOff, title: t("landing.limit2.title"), body: t("landing.limit2.body") },
              { Icon: ShieldAlert, title: t("landing.limit3.title"), body: t("landing.limit3.body"), strong: true },
              { Icon: BatteryWarning, title: t("landing.limit4.title"), body: t("landing.limit4.body") },
              { Icon: Database, title: t("landing.limit5.title"), body: t("landing.limit5.body") },
            ].map(({ Icon, title, body, strong }, i) => (
              <li key={i} className={strong ? "rounded-lg border border-emergency/50 bg-emergency/5 p-5 sm:col-span-2" : "rounded-lg border border-border bg-surface p-5"}>
                <div className="flex items-center gap-2">
                  <Icon className={strong ? "size-5 text-emergency-text" : "size-5 text-fg-secondary"} aria-hidden />
                  <h3 className="text-body font-semibold">{title}</h3>
                </div>
                <p className="mt-2 text-footnote text-fg-secondary">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Events */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-title2 font-semibold tracking-tight">{t("landing.eventsTitle")}</h2>
            <Link to="/events" className="text-footnote font-medium text-primary hover:underline">{t("common.seeAll")}</Link>
          </div>
          <div className="mt-6">
            {events.isLoading ? <Loading /> : events.error ? <ErrorState error={events.error} onRetry={() => void events.refetch()} /> :
              (events.data?.items.length ?? 0) === 0 ? <EmptyState title={t("events.emptyTitle")} body={t("events.emptyPublic")} /> : (
                <ul className="overflow-hidden rounded-lg border border-border bg-surface [&>li:last-child>a]:border-b-0">
                  {events.data!.items.map((e) => <EventRow key={e.id} event={e} to={`/events/${e.slug}`} />)}
                </ul>
              )}
          </div>
        </div>
      </section>
    </div>
  );
}

function LegendRow({ badge, text }: { badge: React.ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-4 px-5 py-3.5">
      <div className="w-32 shrink-0">{badge}</div>
      <p className="text-footnote text-fg-secondary">{text}</p>
    </li>
  );
}
