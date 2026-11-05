import { describe, expect, it } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { auth, event, eventAs, livePilot, liveRetriever, me, member, position, retrieval, snapshot } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import { FakeSocket } from "@/test/fakeSocket";
import type { Retrieval } from "@/lib/api/types";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

describe("public live map", () => {
  it("renders pilots with freshness labels, SIM badge, filters and live updates", async () => {
    const now = new Date();
    server.use(
      http.get(`${API()}/events/cameli-paragliding-demo`, () => HttpResponse.json(event())),
      http.get(`${API()}/events/e-1/live`, () =>
        HttpResponse.json(
          snapshot({
            server_time: now.toISOString(),
            pilots: [
              livePilot({ flight_id: "f-1", age_s: 3 }),
              livePilot({ flight_id: "f-2", pilot: { user_id: "u-3", full_name: "Burak Er", public_id: "burak" }, age_s: 90, freshness: "stale", is_simulated: true }),
              livePilot({ flight_id: "f-3", pilot: { user_id: "u-4", full_name: "Cem Su", public_id: "cem" }, age_s: 900, freshness: "lost" }),
            ],
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp("/events/cameli-paragliding-demo/live", { session: null });
    // narrow viewport (jsdom): the pilot list lives in the bottom sheet
    await user.click(await screen.findByRole("button", { name: /Pilotlar · 3/ }));
    const list = await screen.findByRole("list", { name: "Pilotlar" });
    expect(await within(list).findByText("Ayşe Kaya")).toBeInTheDocument();
    const burak = within(list).getByText("Burak Er").closest("button")!;
    expect(within(burak).getByText("Gecikmeli")).toBeInTheDocument();
    expect(within(burak).getByText("SIM")).toBeInTheDocument();
    expect(within(within(list).getByText("Cem Su").closest("button")!).getByText("Sinyal yok")).toBeInTheDocument();
    // guests never see the retrieval board
    expect(screen.queryByRole("button", { name: /Alım panosu/ })).not.toBeInTheDocument();

    // filter: signal problems only (stale + lost)
    await user.click(screen.getAllByRole("button", { name: /Sinyal sorunu/ })[0]!);
    expect(within(list).queryByText("Ayşe Kaya")).not.toBeInTheDocument();
    expect(within(list).getByText("Cem Su")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Tümü/ })[0]!);

    // guest socket: only the event channel, no auth
    const ws = FakeSocket.last();
    act(() => ws.open());
    expect(ws.sent).toEqual([{ type: "subscribe", channel: "event:e-1", since: "100-0" }]);
    act(() => ws.receive({ type: "subscribed", channel: "event:e-1", cursor: "100-0" }));
    expect(await screen.findByText("Canlı bağlantı")).toBeInTheDocument();
    await act(async () => {
      ws.receive({
        type: "position", channel: "event:e-1", cursor: "101-0",
        data: { flight_id: "f-3", pilot: { user_id: "u-4", full_name: "Cem Su", public_id: "cem" }, is_simulated: false, position: position({ seq: 9, gps_alt_m: 1850, received_at: now.toISOString() }) },
      });
      await new Promise((r) => setTimeout(r, 30));
    });
    const cem = within(list).getByText("Cem Su").closest("button")!;
    expect(within(cem).getByText("Canlı")).toBeInTheDocument();

    await user.click(cem);
    expect(screen.getAllByText("GPS irtifa").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/tahmini/).length).toBeGreaterThan(0);

    act(() => ws.serverClose(1012));
    expect(await screen.findByText("Bağlantı koptu – yeniden bağlanılıyor (1)")).toBeInTheDocument();
  });

  it("shows an honest empty state when nothing is visible", async () => {
    server.use(
      http.get(`${API()}/events/cameli-paragliding-demo`, () => HttpResponse.json(event())),
      http.get(`${API()}/events/e-1/live`, () => HttpResponse.json(snapshot({ pilots: [] }))),
    );
    renderApp("/events/cameli-paragliding-demo/live", { session: null });
    expect((await screen.findAllByText("Şu anda görünen pilot yok")).length).toBeGreaterThan(0);
  });
});

function opsHandlers(role: "organizer" | "observer", retrievals: Retrieval[]) {
  const calls: { path: string; body: unknown }[] = [];
  server.use(
    http.get(`${API()}/events/e-1`, () => HttpResponse.json(eventAs(role))),
    http.get(`${API()}/notifications`, () => HttpResponse.json({ items: [] })),
    http.get(`${API()}/events/e-1/live`, () =>
      HttpResponse.json(snapshot({ server_time: new Date().toISOString(), retrievals, retrievers: [liveRetriever(), liveRetriever({ user_id: "u-6", full_name: "Tecelli Yol", on_duty: false, position: null, age_s: null })] })),
    ),
    http.get(`${API()}/events/e-1/members`, () =>
      HttpResponse.json({ items: [member(), member({ user_id: "u-5", full_name: "Kübra Alıcı", role: "retriever" }), member({ user_id: "u-6", full_name: "Tecelli Yol", role: "retriever" })] }),
    ),
  );
  return calls;
}

describe("operations room: retrieval board", () => {
  it("organizer assigns a retriever; a 409 race shows the conflict and loads the current state; then cancels", async () => {
    const requested = retrieval({ requested_at: ago(12), updates: [] });
    const calls = opsHandlers("organizer", [requested]);
    const takenByOther = retrieval({
      status: "accepted", requested_at: requested.requested_at, accepted_at: ago(1), updates: [],
      retriever: { user_id: "u-6", full_name: "Tecelli Yol" },
    });
    server.use(
      http.post(`${API()}/retrievals/r-1/assign`, async ({ request }) => {
        calls.push({ path: "assign", body: await request.json() });
        return HttpResponse.json({ error: { code: "conflict", message: "already accepted" } }, { status: 409 });
      }),
      http.get(`${API()}/retrievals/r-1`, () => HttpResponse.json(takenByOther)),
      http.post(`${API()}/retrievals/r-1/cancel`, async ({ request }) => {
        calls.push({ path: "cancel", body: await request.json() });
        return HttpResponse.json({ ...takenByOther, status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "kendisi döndü", cancelled_by: { user_id: "u-1", full_name: "Deniz Ay" } });
      }),
    );
    const user = userEvent.setup();
    renderApp("/app/events/e-1/live?view=board", { session: auth(me()) });

    const requestedCol = await screen.findByRole("list", { name: "Talep" });
    const card = await within(requestedCol).findByText("Ayşe Kaya");
    expect(within(requestedCol).getByText("12 dk 00 sn bekliyor", { exact: false })).toBeInTheDocument();

    // WS: both channels after auth
    const ws = FakeSocket.last();
    act(() => ws.open());
    act(() => ws.receive({ type: "auth_ok", user_id: "u-1" }));
    expect(ws.sent).toContainEqual({ type: "subscribe", channel: "retrievals:e-1" });
    expect(ws.sent).toContainEqual(expect.objectContaining({ type: "subscribe", channel: "event:e-1" }));

    await user.click(card);
    const detail = await screen.findByLabelText("Ayşe Kaya alım talebi");
    await user.click(within(detail).getByRole("combobox", { name: "Alıcı seçin" }));
    await user.click(await screen.findByRole("option", { name: /Kübra Alıcı · görevde/ }));
    await user.click(within(detail).getByRole("button", { name: "Ata" }));

    expect(await within(detail).findByText(/başka biri tarafından güncellendi/)).toBeInTheDocument();
    expect(calls[0]).toEqual({ path: "assign", body: { retriever_user_id: "u-5" } });
    // fresh state from GET /retrievals/r-1 moved it to "Accepted"
    const acceptedCol = screen.getByRole("list", { name: "Kabul" });
    await waitFor(() => expect(within(acceptedCol).getByText("Ayşe Kaya")).toBeInTheDocument());
    expect(within(detail).getByText("Tecelli Yol")).toBeInTheDocument();

    await user.click(within(detail).getByRole("button", { name: /İptal et/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Gerekçe/), "kendisi döndü");
    await user.click(within(dialog).getByRole("button", { name: "Talebi iptal et" }));
    await waitFor(() => expect(calls[1]).toEqual({ path: "cancel", body: { reason: "kendisi döndü" } }));
    const cancelledCol = screen.getByRole("list", { name: "İptal" });
    await waitFor(() => expect(within(cancelledCol).getByText("Ayşe Kaya")).toBeInTheDocument());
  });

  it("a `retrieval` push moves the card between columns live", async () => {
    opsHandlers("observer", [retrieval({ requested_at: ago(3), updates: [] })]);
    renderApp("/app/events/e-1/live?view=board", { session: auth(me()) });
    await within(await screen.findByRole("list", { name: "Talep" })).findByText("Ayşe Kaya");
    const ws = FakeSocket.last();
    act(() => ws.open());
    act(() => ws.receive({ type: "auth_ok", user_id: "u-1" }));
    await act(async () => {
      ws.receive({
        type: "retrieval", channel: "retrievals:e-1", cursor: "9-0",
        data: retrieval({ status: "picked_up", requested_at: ago(3), accepted_at: ago(2), picked_up_at: ago(0), retriever: { user_id: "u-5", full_name: "Kübra Alıcı" }, updates: [] }),
      });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(within(screen.getByRole("list", { name: "Alındı" })).getByText("Ayşe Kaya")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Talep" })).queryByText("Ayşe Kaya")).not.toBeInTheDocument();
  });

  it("observers see details read-only (no assign / cancel)", async () => {
    opsHandlers("observer", [retrieval({ requested_at: ago(20), updates: [] })]);
    const user = userEvent.setup();
    renderApp("/app/events/e-1/live?view=board", { session: auth(me()) });
    const col = await screen.findByRole("list", { name: "Talep" });
    // over 15 min → explicit "long wait" label, not color only
    expect(await within(col).findByText("uzun bekleme")).toBeInTheDocument();
    await user.click(within(col).getByText("Ayşe Kaya"));
    const detail = await screen.findByLabelText("Ayşe Kaya alım talebi");
    expect(within(detail).getByText(/Gözlemci görünümü/)).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Ata" })).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: /İptal et/ })).not.toBeInTheDocument();
  });
});
