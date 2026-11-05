import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { auth, event, eventAs, me } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import type { RfEvent } from "@/lib/api/types";

const SLUG = "cameli-paragliding-demo";

function serveEvent(get: () => RfEvent) {
  server.use(
    http.get(`${API()}/events/${SLUG}`, () => HttpResponse.json(get())),
    http.get(`${API()}/events/e-1/launch-sites`, () => HttpResponse.json({ items: [] })),
  );
}

describe("public event detail", () => {
  it("asks guests to sign in to apply", async () => {
    serveEvent(() => event());
    renderApp(`/events/${SLUG}`, { session: null });
    const link = await screen.findByRole("link", { name: "Başvurmak için giriş yapın" });
    expect(link).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/events/${SLUG}`)}`);
    expect(screen.queryByRole("button", { name: "Başvuruyu gönder" })).not.toBeInTheDocument();
  });

  it("says applications are closed when they are", async () => {
    serveEvent(() => event({ settings: { ...event().settings, applications_open: false } }));
    renderApp(`/events/${SLUG}`, { session: null });
    expect(await screen.findByText("Bu etkinlik şu anda başvuru kabul etmiyor.")).toBeInTheDocument();
  });

  it("lets a signed-in non-member apply without choosing a role, then shows pending and withdraws", async () => {
    let current: RfEvent = event({ me: { is_organizer: false, role: null, application: null } });
    let applyBody: unknown = null;
    let withdrawn = false;
    serveEvent(() => current);
    server.use(
      http.post(`${API()}/events/e-1/applications`, async ({ request }) => {
        applyBody = await request.json();
        current = event({ me: { is_organizer: false, role: null, application: { id: "a-9", status: "pending"} } });
        return HttpResponse.json({ id: "a-9" }, { status: 201 });
      }),
      http.post(`${API()}/events/e-1/applications/a-9/withdraw`, () => {
        withdrawn = true;
        current = event({ me: { is_organizer: false, role: null, application: { id: "a-9", status: "withdrawn"} } });
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    renderApp(`/events/${SLUG}`, { session: auth(me()) });

    // no role choice for applicants (the organizer decides)
    await user.type(await screen.findByLabelText("Mesaj (isteğe bağlı)"), "Pikap var");
    expect(screen.queryByRole("radio", { name: /^(Pilot|Gözlemci|Alıcı)/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Başvuruyu gönder" }));

    await waitFor(() => expect(applyBody).toEqual({ message: "Pikap var" }));
    expect(await screen.findByText("Başvurunuz organizatör onayı bekliyor.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Başvuruyu geri çek" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Başvuruyu geri çek" }));
    await waitFor(() => expect(withdrawn).toBe(true));
    expect(await screen.findByRole("button", { name: "Yeniden başvur" })).toBeInTheDocument();
  });

  it("shows the server message when the application conflicts", async () => {
    serveEvent(() => event({ me: { is_organizer: false, role: null, application: null } }));
    server.use(
      http.post(`${API()}/events/e-1/applications`, () =>
        HttpResponse.json({ error: { code: "conflict", message: "Zaten bekleyen bir başvurunuz var." } }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderApp(`/events/${SLUG}`, { session: auth(me()) });
    await user.click(await screen.findByRole("button", { name: "Başvuruyu gönder" }));
    expect(await screen.findByText("Zaten bekleyen bir başvurunuz var.")).toBeInTheDocument();
  });

  it("shows a retriever their role and the retrievals link, not the ops room", async () => {
    serveEvent(() => eventAs("retriever"));
    renderApp(`/events/${SLUG}`, { session: auth(me()) });
    expect(await screen.findByRole("link", { name: /Alımlarım/ })).toHaveAttribute("href", "/app/events/e-1/retrievals");
    expect(screen.getAllByText("Alıcı").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Operasyon ekranını aç/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Etkinlikten ayrıl" })).toBeInTheDocument();
  });

  it("points observers to the ops room and pilots to the iOS app", async () => {
    serveEvent(() => eventAs("observer"));
    const first = renderApp(`/events/${SLUG}`, { session: auth(me()) });
    expect(await screen.findByRole("link", { name: /Operasyon ekranını aç/ })).toHaveAttribute("href", "/app/events/e-1/live");
    first.unmount();

    serveEvent(() => eventAs("pilot"));
    renderApp(`/events/${SLUG}`, { session: auth(me()) });
    expect(await screen.findByText(/Uçuşu iOS uygulamasından başlatın/)).toBeInTheDocument();
    expect(screen.getByText(/organizatörler ve gözlemcilerle paylaşmak/)).toBeInTheDocument();
  });

  it("offers organizers the ops room and management, without leave", async () => {
    serveEvent(() => eventAs("organizer"));
    renderApp(`/events/${SLUG}`, { session: auth(me()) });
    expect(await screen.findByRole("link", { name: /Etkinliği yönet/ })).toHaveAttribute("href", "/app/events/e-1");
    expect(screen.getByRole("link", { name: /Operasyon ekranını aç/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Etkinlikten ayrıl" })).not.toBeInTheDocument();
  });

  it("links the live map only when the event has a public live map", async () => {
    serveEvent(() => event({ settings: { ...event().settings, public_live_map: false } }));
    const first = renderApp(`/events/${SLUG}`, { session: null });
    await screen.findByRole("heading", { name: "Çameli Demo" });
    expect(screen.queryByRole("link", { name: /Canlı haritayı aç/ })).not.toBeInTheDocument();
    first.unmount();

    serveEvent(() => event());
    renderApp(`/events/${SLUG}`, { session: null });
    expect(await screen.findByRole("link", { name: /Canlı haritayı aç/ })).toHaveAttribute("href", `/events/${SLUG}/live`);
  });
});

describe("event weather", () => {
  it("shows the flyability verdict, reasons and the attribution", async () => {
    serveEvent(() => event({ center: { lat: 37.7, lon: 29.13 } }));
    server.use(
      http.get(`${API()}/events/e-1/weather`, () =>
        HttpResponse.json({
          source: "open-meteo", attribution: "Weather data by Open-Meteo.com (CC BY 4.0)", lat: 37.7, lon: 29.13, elevation_m: 1250,
          fetched_at: "2026-11-05T10:00:00Z",
          current: { t: "2026-11-05T10:00:00Z", temp_c: 14, wind_ms: 6, wind_dir_deg: 250, gust_ms: 9, cloud_cover_pct: 20, precip_mm: 0 },
          hourly: [{ t: "2026-11-05T10:00:00Z", temp_c: 14, dew_point_c: 6, wind_ms: 6, wind_dir_deg: 250, gust_ms: 9, wind_850_ms: 7,
            wind_850_dir_deg: 240, cape_jkg: 100, precip_prob_pct: 0, cloud_cover_pct: 20, cloud_base_m: 2250, flyability: "marginal", fly_reasons: ["strong_wind", "gusty"] }],
          flyability: "marginal", fly_reasons: ["strong_wind", "gusty"],
        })),
    );
    renderApp(`/events/${SLUG}`, { session: null });
    expect(await screen.findByText("Sınırda")).toBeInTheDocument();
    expect(screen.getByText("Kuvvetli rüzgâr")).toBeInTheDocument();
    expect(screen.getByText("Hamleli")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open-Meteo.com" })).toHaveAttribute("href", "https://open-meteo.com/");
  });

  it("degrades quietly when weather is unavailable", async () => {
    serveEvent(() => event({ center: { lat: 37.7, lon: 29.13 } }));
    server.use(http.get(`${API()}/events/e-1/weather`, () => HttpResponse.json({ error: { code: "unavailable", message: "x" } }, { status: 503 })));
    renderApp(`/events/${SLUG}`, { session: null });
    expect(await screen.findByText("Hava durumu şu an alınamıyor.", {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
