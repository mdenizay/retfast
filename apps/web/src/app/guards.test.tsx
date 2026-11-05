import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { application, auth, eventAs, me, snapshot } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import { isAppHost } from "@/lib/config";
import { safeNext } from "@/layouts/guards";
import type { RfEvent } from "@/lib/api/types";

function baseHandlers(mine: RfEvent[] = []) {
  server.use(
    http.get(`${API()}/events`, () => HttpResponse.json({ items: mine, next_cursor: null })),
    http.get(`${API()}/flights`, () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get(`${API()}/notifications`, () => HttpResponse.json({ items: [] })),
    http.get(`${API()}/admin/stats`, () => HttpResponse.json({ active_events: 1, pilots_in_air: 0, open_retrievals: 0 })),
  );
}

/** The demo event as seen by `role`, plus everything its pages may request. */
function stubEvent(role: "organizer" | "pilot" | "observer" | "retriever" | null) {
  const ev = eventAs(role);
  baseHandlers(role ? [ev] : []);
  server.use(
    http.get(`${API()}/events/e-1`, () => HttpResponse.json(ev)),
    http.get(`${API()}/events/e-1/live`, () => HttpResponse.json(snapshot({ server_time: new Date().toISOString(), retrievals: [], retrievers: [] }))),
    http.get(`${API()}/events/e-1/members`, () => HttpResponse.json({ items: [] })),
    http.get(`${API()}/events/e-1/applications`, () => HttpResponse.json({ items: [application()] })),
    http.get(`${API()}/events/e-1/retrievals`, () => HttpResponse.json({ items: [] })),
    http.get(`${API()}/events/e-1/launch-sites`, () => HttpResponse.json({ items: [] })),
  );
  return ev;
}

describe("route guards", () => {
  it("sends anonymous users from /app to /login with a next parameter", async () => {
    const { router } = renderApp("/app/flights", { session: null });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toContain("next=%2Fapp%2Fflights");
    expect(await screen.findByRole("heading", { name: "Giriş yap" })).toBeInTheDocument();
  });

  it("forces /change-password before anything else when must_change_password is set", async () => {
    const { router } = renderApp("/app", { session: auth(me({ must_change_password: true })) });
    await waitFor(() => expect(router.state.location.pathname).toBe("/change-password"));
    expect(await screen.findByText(/yeni bir şifre belirlemeniz gerekiyor/)).toBeInTheDocument();
  });

  it("also blocks public pages while a password change is required", async () => {
    const { router } = renderApp("/events", { session: auth(me({ must_change_password: true })) });
    await waitFor(() => expect(router.state.location.pathname).toBe("/change-password"));
  });

  it("hides admin and retriever navigation from a user without those roles", async () => {
    baseHandlers();
    renderApp("/app", { session: auth(me()) });
    expect((await screen.findAllByRole("link", { name: /Etkinliklerim/ })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Kullanıcılar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Alımlarım/ })).not.toBeInTheDocument();
  });

  it("shows admin navigation and platform counters to platform admins", async () => {
    baseHandlers();
    renderApp("/app", { session: auth(me({ roles: ["platform_admin"] })) });
    expect((await screen.findAllByRole("link", { name: /Kullanıcılar/ })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Etkinlik yönetimi/ }).length).toBeGreaterThan(0);
    expect(await screen.findByText("Havadaki pilot")).toBeInTheDocument();
  });

  it("shows 'My retrievals' and 'live now' only for the matching event roles", async () => {
    baseHandlers([eventAs("retriever"), eventAs("observer", { id: "e-2", name: "Babadağ Cup" })]);
    renderApp("/app", { session: auth(me()) });
    expect((await screen.findAllByRole("link", { name: /Alımlarım/ })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Babadağ Cup/ }).length).toBeGreaterThan(0);
  });

  it("renders a no-access page for admin routes", async () => {
    baseHandlers();
    renderApp("/app/admin/users", { session: auth(me()) });
    expect(await screen.findByText("Bu sayfaya erişiminiz yok")).toBeInTheDocument();
  });
});

describe("event role guards", () => {
  it("organizer: applications inbox is reachable and shows the pending badge", async () => {
    stubEvent("organizer");
    renderApp("/app/events/e-1/applications", { session: auth(me()) });
    expect(await screen.findByText("Emre Can")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Başvurular/ })).toBeInTheDocument();
  });

  it("observer: applications/members are blocked, live opens the read-only operations room", async () => {
    stubEvent("observer");
    const { unmount } = renderApp("/app/events/e-1/applications", { session: auth(me()) });
    expect(await screen.findByText("Bu sayfaya erişiminiz yok")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Başvurular/ })).not.toBeInTheDocument();
    unmount();
    renderApp("/app/events/e-1/live", { session: auth(me()) });
    expect(await screen.findByText("Gözlemci · salt okunur")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alım panosu/ })).toBeInTheDocument();
  });

  it("retriever: live is redirected to My retrievals; manager pages are blocked", async () => {
    stubEvent("retriever");
    const { router, unmount } = renderApp("/app/events/e-1/live", { session: auth(me()) });
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/events/e-1/retrievals"));
    expect(await screen.findByRole("heading", { name: "Alımlarım" })).toBeInTheDocument();
    unmount();
    renderApp("/app/events/e-1/members", { session: auth(me()) });
    expect(await screen.findByText("Bu sayfaya erişiminiz yok")).toBeInTheDocument();
  });

  it("pilot: gets the pilot map (no retrieval board) and cannot open My retrievals", async () => {
    stubEvent("pilot");
    const { unmount } = renderApp("/app/events/e-1/live", { session: auth(me()) });
    expect(await screen.findByRole("region", { name: /canlı haritası/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Alım panosu/ })).not.toBeInTheDocument();
    unmount();
    renderApp("/app/events/e-1/retrievals", { session: auth(me()) });
    expect(await screen.findByText("Bu sayfaya erişiminiz yok")).toBeInTheDocument();
  });

  it("outsider: no live access", async () => {
    stubEvent(null);
    renderApp("/app/events/e-1/live", { session: auth(me()) });
    expect(await screen.findByText("Bu sayfaya erişiminiz yok")).toBeInTheDocument();
  });

  it("platform admin who is not organizer can still manage", async () => {
    stubEvent(null);
    renderApp("/app/events/e-1/applications", { session: auth(me({ roles: ["platform_admin"] })) });
    expect(await screen.findByText("Emre Can")).toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("detects the operations host", () => {
    expect(isAppHost("app.retfast.com")).toBe(true);
    expect(isAppHost("retfast.com")).toBe(false);
    expect(isAppHost("www.retfast.com")).toBe(false);
  });
  it("only accepts same-origin relative redirect targets", () => {
    expect(safeNext("/app/events")).toBe("/app/events");
    expect(safeNext("//evil.com")).toBe("/app");
    expect(safeNext("https://evil.com")).toBe("/app");
    expect(safeNext(null)).toBe("/app");
  });
});
