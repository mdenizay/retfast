import type { ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BatteryWarning, CloudOff, Database, Info, Satellite, ShieldOff, Smartphone } from "lucide-react";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { eventsApi } from "@/lib/api/endpoints";
import { APP_STORE_URL } from "@/lib/config";
import { useSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Loading } from "@/components/common";
import { FreshnessBadge, RetrievalStatusBadge, RoleBadge, SimBadge } from "@/components/status";
import { EventRow } from "@/features/events/EventBits";

const ROLES = ["pilot", "observer", "retriever", "organizer"] as const;
const FLOW: [MessageKey, MessageKey][] = [
  ["landing.flow1.title", "landing.flow1.body"],
  ["landing.flow2.title", "landing.flow2.body"],
  ["landing.flow3.title", "landing.flow3.body"],
  ["landing.flow4.title", "landing.flow4.body"],
  ["landing.flow5.title", "landing.flow5.body"],
];
const RETRIEVAL_STATES = ["requested", "accepted", "picked_up", "delivered"] as const;

export default function LandingPage() {
  const { t } = useI18n();
  const { status } = useSession();
  const events = useQuery({
    queryKey: ["public", "events", "landing"],
    queryFn: () => eventsApi.list({ status: "active,published", limit: 5 }),
  });

  return (
    <div>
      {/* Hero: statement left, the day's flow as a numbered instrument list right. */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <div>
            <p className="text-caption font-medium tracking-[0.12em] text-primary uppercase">{t("landing.eyebrow")}</p>
            <h1 className="mt-4 text-[34px] leading-[40px] font-semibold tracking-tight text-fg sm:text-display">{t("landing.title")}</h1>
            <p className="mt-5 max-w-xl text-callout text-fg-secondary">{t("landing.lead")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg"><Link to="/events">{t("landing.ctaEvents")} <ArrowRight /></Link></Button>
              {status === "authenticated" ? (
                <Button asChild size="lg" variant="outline"><Link to="/app">{t("nav.openApp")}</Link></Button>
              ) : (
                <Button asChild size="lg" variant="outline"><Link to="/register">{t("landing.ctaRegister")}</Link></Button>
              )}
            </div>
            <div className="mt-6 flex flex-col gap-2 text-footnote text-fg-secondary">
              <span className="inline-flex items-center gap-2">
                <Smartphone className="size-4" aria-hidden />
                {APP_STORE_URL ? (
                  <a href={APP_STORE_URL} className="text-primary hover:underline" rel="noopener">{t("landing.appStore")}</a>
                ) : (
                  <span>{t("landing.iosSoon")}</span>
                )}
              </span>
              <span className="inline-flex items-start gap-2">
                <ShieldOff className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{t("landing.notEmergency")}</span>
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface">
            <h2 className="border-b border-border px-5 py-3 text-caption font-medium tracking-wide text-fg-muted uppercase">{t("landing.flowTitle")}</h2>
            <ol>
              {FLOW.map(([title, body], i) => (
                <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-x-2 border-b border-border px-5 py-4 last:border-b-0">
                  <span className="telemetry pt-0.5 text-footnote text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="text-body font-semibold text-fg">{t(title)}</h3>
                    <p className="mt-1 text-footnote text-fg-secondary">{t(body)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-title2 font-semibold tracking-tight">{t("landing.rolesTitle")}</h2>
            <p className="mt-3 text-body text-fg-secondary">{t("landing.rolesLead")}</p>
          </div>
          <ul className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => (
              <li key={r} className="bg-surface p-5">
                <RoleBadge role={r} />
                <p className="mt-3 text-footnote text-fg-secondary">{t(`landing.role.${r}`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Visual-state legend (explains the screens; not live data) */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-title2 font-semibold tracking-tight">{t("landing.legendTitle")}</h2>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <LegendGroup title={t("landing.legendFreshness")}>
              <LegendRow badge={<FreshnessBadge freshness="live" />} text={t("landing.legend.live")} />
              <LegendRow badge={<FreshnessBadge freshness="stale" />} text={t("landing.legend.stale")} />
              <LegendRow badge={<FreshnessBadge freshness="lost" />} text={t("landing.legend.lost")} />
              <LegendRow badge={<SimBadge />} text={t("landing.legend.sim")} />
            </LegendGroup>
            <LegendGroup title={t("landing.legendRetrieval")}>
              {RETRIEVAL_STATES.map((s) => (
                <LegendRow key={s} badge={<RetrievalStatusBadge status={s} />} text={t(`landing.legend.${s}`)} />
              ))}
            </LegendGroup>
          </div>
          <p className="mt-4 inline-flex items-center gap-2 text-caption text-fg-muted">
            <Info className="size-3.5" aria-hidden />{t("landing.legendNote")}
          </p>
        </div>
      </section>

      {/* Honest limitations */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <h2 className="text-title2 font-semibold tracking-tight">{t("landing.limitsTitle")}</h2>
            <p className="mt-3 text-body text-fg-secondary">{t("landing.limitsLead")}</p>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {[
              { Icon: ShieldOff, title: t("landing.limit3.title"), body: t("landing.limit3.body"), strong: true },
              { Icon: Satellite, title: t("landing.limit1.title"), body: t("landing.limit1.body") },
              { Icon: CloudOff, title: t("landing.limit2.title"), body: t("landing.limit2.body") },
              { Icon: BatteryWarning, title: t("landing.limit4.title"), body: t("landing.limit4.body") },
              { Icon: Database, title: t("landing.limit5.title"), body: t("landing.limit5.body") },
            ].map(({ Icon, title, body, strong }) => (
              <li key={title} className="flex gap-4 p-5">
                <Icon className={strong ? "mt-0.5 size-5 shrink-0 text-warning" : "mt-0.5 size-5 shrink-0 text-fg-secondary"} aria-hidden />
                <div>
                  <h3 className="text-body font-semibold">{title}</h3>
                  <p className="mt-1 text-footnote text-fg-secondary">{body}</p>
                </div>
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

function LegendGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <h3 className="border-b border-border px-5 py-3 text-caption font-medium tracking-wide text-fg-muted uppercase">{title}</h3>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

function LegendRow({ badge, text }: { badge: ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-4 px-5 py-3.5">
      <div className="w-36 shrink-0">{badge}</div>
      <p className="text-footnote text-fg-secondary">{text}</p>
    </li>
  );
}
