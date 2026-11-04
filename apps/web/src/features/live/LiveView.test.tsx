import { describe, expect, it } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { event, livePilot, position, snapshot } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import { FakeSocket } from "@/test/fakeSocket";

describe("public live map", () => {
  it("renders pilots from the snapshot with freshness labels, SIM badge, filters and live updates", async () => {
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
    const list = await screen.findByRole("list", { name: "Pilotlar" });
    expect(await within(list).findByText("Ayşe Kaya")).toBeInTheDocument();
    const burak = within(list).getByText("Burak Er").closest("button")!;
    expect(within(burak).getByText("Gecikmeli")).toBeInTheDocument();
    expect(within(burak).getByText("SIM")).toBeInTheDocument();
    expect(within(within(list).getByText("Cem Su").closest("button")!).getByText("Sinyal yok")).toBeInTheDocument();

    // filter: lost only
    await user.click(screen.getAllByRole("button", { name: /Sinyal yok/ })[0]!);
    expect(within(list).queryByText("Ayşe Kaya")).not.toBeInTheDocument();
    expect(within(list).getByText("Cem Su")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Tümü/ })[0]!);

    // guest socket: subscribes without auth, applies position deltas
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

    // select → detail pane with labelled telemetry
    await user.click(cem);
    expect(screen.getAllByText("GPS irtifa").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/tahmini/).length).toBeGreaterThan(0);

    // connection loss shows the reconnect banner with the attempt count
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
    expect(screen.getByText(/herkese açık paylaştığı/)).toBeInTheDocument();
  });
});
