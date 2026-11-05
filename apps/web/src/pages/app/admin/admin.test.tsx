import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { auth, event, me } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import type { AdminUser } from "@/lib/api/types";

const admin = me({ id: "u-admin", full_name: "Deniz Admin", roles: ["platform_admin"] });

function layoutHandlers() {
  server.use(
    http.get(`${API()}/events`, () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get(`${API()}/notifications`, () => HttpResponse.json({ items: [] })),
  );
}

function user(over: Partial<AdminUser>): AdminUser {
  return {
    id: "u-x", email: "x@example.com", full_name: "X", is_platform_admin: false, disabled: false,
    email_verified: true, created_at: "2026-11-01T00:00:00.000Z", ...over,
  };
}

describe("admin users", () => {
  it("grants/revokes platform admin and disables accounts only after confirmation", async () => {
    layoutHandlers();
    const patches: { id: string; body: unknown }[] = [];
    server.use(
      http.get(`${API()}/admin/users`, () =>
        HttpResponse.json({
          items: [
            user({ id: "u-admin", email: "deniz@retfast.com", full_name: "Deniz Admin", is_platform_admin: true }),
            user({ id: "u-2", email: "altay@retfast.com", full_name: "Altay Alp", is_platform_admin: true }),
            user({ id: "u-3", email: "kubra@example.com", full_name: "Kübra Er", roles: [] }),
          ],
          next_cursor: null,
        }),
      ),
      http.patch(`${API()}/admin/users/:id`, async ({ params, request }) => {
        patches.push({ id: String(params.id), body: await request.json() });
        return HttpResponse.json(user({ id: String(params.id) }));
      }),
    );
    const u = userEvent.setup();
    renderApp("/app/admin/users", { session: auth(admin) });

    // own row is locked
    const selfSwitch = await screen.findByRole("switch", { name: "Deniz Admin için platform yöneticisi" });
    expect(selfSwitch).toBeDisabled();

    // revoke admin → confirm dialog → PATCH {is_platform_admin:false}
    await u.click(screen.getByRole("switch", { name: "Altay Alp için platform yöneticisi" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Yönetici yetkisi kaldırılsın mı?")).toBeInTheDocument();
    expect(patches).toHaveLength(0);
    await u.click(within(dlg).getByRole("button", { name: "Yetkiyi kaldır" }));
    await waitFor(() => expect(patches).toEqual([{ id: "u-2", body: { is_platform_admin: false } }]));

    // disable another user → confirm → PATCH {disabled:true}
    const row = screen.getByText("Kübra Er").closest("tr")!;
    await u.click(within(row).getByRole("button", { name: /Devre dışı bırak/ }));
    const dlg2 = await screen.findByRole("dialog");
    expect(within(dlg2).getByText("Hesap devre dışı bırakılsın mı?")).toBeInTheDocument();
    await u.click(within(dlg2).getByRole("button", { name: "Devre dışı bırak" }));
    await waitFor(() => expect(patches[1]).toEqual({ id: "u-3", body: { disabled: true } }));
  });

  it("cancelling the confirmation sends nothing", async () => {
    layoutHandlers();
    let patched = false;
    server.use(
      http.get(`${API()}/admin/users`, () => HttpResponse.json({ items: [user({ id: "u-3", full_name: "Kübra Er" })], next_cursor: null })),
      http.patch(`${API()}/admin/users/:id`, () => {
        patched = true;
        return HttpResponse.json({});
      }),
    );
    const u = userEvent.setup();
    renderApp("/app/admin/users", { session: auth(admin) });
    await u.click(await screen.findByRole("switch", { name: "Kübra Er için platform yöneticisi" }));
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patched).toBe(false);
  });
});

describe("admin system", () => {
  it("renders only the counters the server returned", async () => {
    layoutHandlers();
    server.use(
      http.get(`${API()}/admin/stats`, () =>
        HttpResponse.json({ active_events: 1, pilots_in_air: 4, open_retrievals: 2, system_status: { checks: { postgres: "ok", redis: "down" } } }),
      ),
    );
    renderApp("/app/admin", { session: auth(admin) });
    expect(await screen.findByText("Havadaki pilot")).toBeInTheDocument();
    const counter = (k: string) => document.querySelector(`[data-counter="${k}"]`);
    await waitFor(() => expect(counter("pilots_in_air")).toHaveTextContent("4"));
    expect(counter("open_retrievals")).toHaveTextContent("2");
    expect(counter("stale_sessions")).toBeNull();
    expect(counter("pending_applications")).toBeNull();
    expect(screen.getByText("redis").closest("li")).toHaveTextContent("down");
    expect(screen.getByText("postgres").closest("li")).toHaveTextContent("çalışıyor");
  });
});

describe("admin events", () => {
  it("flags events without an organizer and links to organizer assignment", async () => {
    layoutHandlers();
    server.use(
      http.get(`${API()}/events`, () =>
        HttpResponse.json({
          items: [event({ id: "e-1", name: "Çameli Demo" }), event({ id: "e-2", name: "Babadağ Kupası", organizers: [] })],
          next_cursor: null,
        }),
      ),
    );
    renderApp("/app/admin/events", { session: auth(admin) });
    const list = await screen.findByRole("list", { name: "Tüm etkinlikler" });
    const row = within(list).getByText("Babadağ Kupası").closest("li")!;
    expect(within(row).getByText("Organizatör atanmamış")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /Organizatörler/ })).toHaveAttribute("href", "/app/events/e-2/settings#organizers");
    expect(within(within(list).getByText("Çameli Demo").closest("li")!).getByText(/Org Kişi/)).toBeInTheDocument();
  });
});
