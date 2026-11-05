import { describe, expect, it } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { application, auth, eventAs, me, member, retrieval } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import { FakeSocket } from "@/test/fakeSocket";
import type { Application, Member, Retrieval } from "@/lib/api/types";

function common(role: "organizer" | "retriever") {
  server.use(
    http.get(`${API()}/events`, () => HttpResponse.json({ items: [eventAs(role)], next_cursor: null })),
    http.get(`${API()}/notifications`, () => HttpResponse.json({ items: [] })),
    http.get(`${API()}/events/e-1`, () => HttpResponse.json(eventAs(role))),
  );
}

describe("applications inbox", () => {
  it("approves with a role different from the requested one and rejects with a note", async () => {
    common("organizer");
    let apps: Application[] = [
      application(),
      application({ id: "a-2", user: { user_id: "u-8", full_name: "Zeynep Ok", email: "z@example.com", public_id: null }, message: "" }),
    ];
    const calls: { path: string; body: unknown }[] = [];
    server.use(
      http.get(`${API()}/events/e-1/applications`, () => HttpResponse.json({ items: apps })),
      http.post(`${API()}/events/e-1/applications/:id/approve`, async ({ params, request }) => {
        const body = (await request.json()) as { role: NonNullable<Application["granted_role"]> };
        calls.push({ path: `approve ${params.id}`, body });
        apps = apps.map((a) => (a.id === params.id ? { ...a, status: "approved", granted_role: body.role, decided_at: new Date().toISOString() } : a));
        return HttpResponse.json({});
      }),
      http.post(`${API()}/events/e-1/applications/:id/reject`, async ({ params, request }) => {
        calls.push({ path: `reject ${params.id}`, body: await request.json() });
        apps = apps.map((a) => (a.id === params.id ? { ...a, status: "rejected", decision_note: "Kontenjan doldu" } : a));
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    renderApp("/app/events/e-1/applications", { session: auth(me()) });

    const emre = await screen.findByRole("listitem", { name: "Emre Can" });
    // no default role: approving is impossible until the organizer picks one
    expect(within(emre).getByRole("radio", { name: /Alıcı/ })).not.toBeChecked();
    expect(within(emre).getByRole("button", { name: "Rol seçmeden onaylanamaz" })).toBeDisabled();
    await user.click(within(emre).getByRole("radio", { name: /Gözlemci/ }));
    await user.click(within(emre).getByRole("button", { name: "Gözlemci olarak onayla" }));
    expect(await screen.findByText("Emre Can · Gözlemci olarak onaylandı.")).toBeInTheDocument();
    expect(calls[0]).toEqual({ path: "approve a-1", body: { role: "observer" } });
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Emre Can" })).not.toBeInTheDocument());

    const zeynep = screen.getByRole("listitem", { name: "Zeynep Ok" });
    await user.click(within(zeynep).getByRole("button", { name: /Reddet/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Gerekçe/), "Kontenjan doldu");
    await user.click(within(dialog).getByRole("button", { name: "Başvuruyu reddet" }));
    await waitFor(() => expect(calls[1]).toEqual({ path: "reject a-2", body: { note: "Kontenjan doldu" } }));
    expect(await screen.findByText("Bekleyen başvuru yok")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Reddedilen/ }));
    expect(await screen.findByText("“Kontenjan doldu”")).toBeInTheDocument();
  });

  it("shows a conflict message when another organizer decided first", async () => {
    common("organizer");
    server.use(
      http.get(`${API()}/events/e-1/applications`, () => HttpResponse.json({ items: [application()] })),
      http.post(`${API()}/events/e-1/applications/a-1/approve`, () =>
        HttpResponse.json({ error: { code: "conflict", message: "already decided" } }, { status: 409 })),
    );
    const user = userEvent.setup();
    renderApp("/app/events/e-1/applications", { session: auth(me()) });
    const row = await screen.findByRole("listitem", { name: "Emre Can" });
    await user.click(within(row).getByRole("radio", { name: /Alıcı/ }));
    await user.click(within(row).getByRole("button", { name: "Alıcı olarak onayla" }));
    expect(await screen.findByText(/başka bir organizatör tarafından karara bağlandı/)).toBeInTheDocument();
  });
});

describe("members", () => {
  it("groups by role, changes a role and removes a member after confirmation", async () => {
    common("organizer");
    let members: Member[] = [member(), member({ user_id: "u-5", full_name: "Kübra Alıcı", role: "retriever", phone: "" })];
    const calls: string[] = [];
    server.use(
      http.get(`${API()}/events/e-1/members`, () => HttpResponse.json({ items: members })),
      http.patch(`${API()}/events/e-1/members/:uid`, async ({ params, request }) => {
        const { role } = (await request.json()) as { role: Member["role"] };
        calls.push(`patch ${params.uid} ${role}`);
        members = members.map((m) => (m.user_id === params.uid ? { ...m, role } : m));
        return HttpResponse.json(members.find((m) => m.user_id === params.uid));
      }),
      http.delete(`${API()}/events/e-1/members/:uid`, ({ params }) => {
        calls.push(`delete ${params.uid}`);
        members = members.map((m) => (m.user_id === params.uid ? { ...m, status: "removed" } : m));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp("/app/events/e-1/members", { session: auth(me()) });
    const pilots = await screen.findByRole("list", { name: "Pilotlar" });
    expect(within(pilots).getByText("Ayşe Kaya")).toBeInTheDocument();
    expect(within(pilots).getByRole("link", { name: /\+90 555 111 22 33/ })).toHaveAttribute("href", "tel:+905551112233");
    expect(within(screen.getByRole("list", { name: "Alıcılar" })).getByText("Telefon yok")).toBeInTheDocument();

    await user.click(within(pilots).getByRole("combobox", { name: "Ayşe Kaya için rol" }));
    await user.click(await screen.findByRole("option", { name: "Alıcı" }));
    await waitFor(() => expect(calls).toContain("patch u-2 retriever"));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Alıcılar" })).getByText("Ayşe Kaya")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Kübra Alıcı kişisini çıkar" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Etkinlikten çıkar" }));
    await waitFor(() => expect(calls).toContain("delete u-5"));
    expect(await screen.findByText("Çıkarılanlar (1)")).toBeInTheDocument();
  });
});

describe("my retrievals (retriever on web)", () => {
  it("accepts (losing one race with 409), marks picked up and delivered", async () => {
    common("retriever");
    const now = Date.now();
    const iso = (min: number) => new Date(now - min * 60_000).toISOString();
    const r1 = retrieval({ requested_at: iso(8), updates: [], pilot: { user_id: "u-2", full_name: "Ayşe Kaya", public_id: "ayse", phone: null } });
    const r2 = retrieval({ id: "r-2", requested_at: iso(4), updates: [], pilot: { user_id: "u-3", full_name: "Burak Er", public_id: null, phone: null } });
    const mine = (r: Retrieval, over: Partial<Retrieval>): Retrieval => ({ ...r, retriever: { user_id: "u-1", full_name: "Deniz Ay" }, ...over });
    const calls: string[] = [];
    server.use(
      http.get(`${API()}/events/e-1/retrievals`, () => HttpResponse.json({ items: [r1, r2] })),
      http.post(`${API()}/retrievals/r-2/accept`, () => {
        calls.push("accept r-2");
        return HttpResponse.json({ error: { code: "conflict", message: "taken" } }, { status: 409 });
      }),
      http.get(`${API()}/retrievals/r-2`, () => HttpResponse.json({ ...r2, status: "accepted", accepted_at: iso(0), retriever: { user_id: "u-9", full_name: "Başkası" } })),
      http.post(`${API()}/retrievals/r-1/accept`, () => {
        calls.push("accept r-1");
        return HttpResponse.json(mine(r1, { status: "accepted", accepted_at: iso(0), pilot: { ...r1.pilot, phone: "+90 555 111 22 33" } }));
      }),
      http.post(`${API()}/retrievals/r-1/picked-up`, () => {
        calls.push("picked r-1");
        return HttpResponse.json(mine(r1, { status: "picked_up", accepted_at: iso(0), picked_up_at: iso(0), pilot: { ...r1.pilot, phone: "+90 555 111 22 33" } }));
      }),
      http.post(`${API()}/retrievals/r-1/delivered`, async ({ request }) => {
        calls.push(`delivered r-1 ${JSON.stringify(await request.json())}`);
        return HttpResponse.json(mine(r1, { status: "delivered", accepted_at: iso(0), picked_up_at: iso(0), delivered_at: iso(0) }));
      }),
    );
    const user = userEvent.setup();
    renderApp("/app/events/e-1/retrievals", { session: auth(me()) });
    const open = await screen.findByRole("list", { name: "Açık talepler" });
    expect(await within(open).findByText("Ayşe Kaya")).toBeInTheDocument();
    expect(within(open).getByText(/8 dk 0\d sn bekliyor/)).toBeInTheDocument();

    // retriever subscribes to the retrievals channel only (no general map)
    const ws = FakeSocket.last();
    act(() => ws.open());
    act(() => ws.receive({ type: "auth_ok", user_id: "u-1" }));
    expect(ws.sent).toContainEqual({ type: "subscribe", channel: "retrievals:e-1" });
    expect(ws.sent.some((m) => (m as { channel?: string }).channel === "event:e-1")).toBe(false);

    // lose the race on Burak
    const burak = within(open).getByText("Burak Er").closest("li")!;
    await user.click(within(burak).getByRole("button", { name: /Kabul et/ }));
    expect(await screen.findByText("Bu talebi az önce başka bir alıcı kabul etti.")).toBeInTheDocument();
    await waitFor(() => expect(within(open).queryByText("Burak Er")).not.toBeInTheDocument());

    // win Ayşe
    await user.click(within(within(open).getByText("Ayşe Kaya").closest("li")!).getByRole("button", { name: /Kabul et/ }));
    const active = await screen.findByRole("heading", { name: /Üzerimdeki alımlar/ });
    const section = active.closest("section")!;
    expect(await within(section).findByText("Ayşe Kaya")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: /Ara/ })).toHaveAttribute("href", "tel:+905551112233");

    await user.click(within(section).getByRole("button", { name: /Pilotu aldım/ }));
    await user.click(await within(section).findByRole("button", { name: /Teslim ettim/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Teslim notu/), "Kalkışa bırakıldı");
    await user.click(within(dialog).getByRole("button", { name: "Teslim edildi olarak işaretle" }));
    await waitFor(() => expect(calls).toEqual(["accept r-2", "accept r-1", "picked r-1", 'delivered r-1 {"note":"Kalkışa bırakıldı"}']));
    await waitFor(() => expect(within(section).queryByText("Ayşe Kaya")).not.toBeInTheDocument());
  });
});
