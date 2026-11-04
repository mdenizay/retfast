import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { auth, me } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import { isAppHost } from "@/lib/config";
import { safeNext } from "@/layouts/guards";

function emptyLists() {
  server.use(
    http.get(`${API()}/events`, () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get(`${API()}/flights`, () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get(`${API()}/incidents`, () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get(`${API()}/admin/stats`, () => HttpResponse.json({ active_events: 1, tracking_pilots: 0, stale_sessions: 0, open_incidents: 0, recent_flights: 2 })),
  );
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

  it("hides navigation the user cannot use (pilot)", async () => {
    emptyLists();
    renderApp("/app", { session: auth(me({ roles: ["pilot"] })) });
    expect((await screen.findAllByRole("link", { name: /Uçuşlar/ })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Kurtarma ekibi/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Kullanıcılar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Yeni etkinlik/ })).not.toBeInTheDocument();
  });

  it("shows admin navigation to platform admins", async () => {
    emptyLists();
    renderApp("/app", { session: auth(me({ roles: ["pilot", "platform_admin"] })) });
    expect((await screen.findAllByRole("link", { name: /Kullanıcılar/ })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Kurtarma ekibi/ }).length).toBeGreaterThan(0);
    expect(await screen.findByText("Takipteki pilot")).toBeInTheDocument();
  });

  it("renders a no-access page for role-restricted routes", async () => {
    emptyLists();
    renderApp("/app/admin/users", { session: auth(me({ roles: ["pilot"] })) });
    expect(await screen.findByText("Bu sayfaya erişiminiz yok")).toBeInTheDocument();
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
