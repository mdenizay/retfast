import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { auth, incident, me } from "@/test/fixtures";
import { renderApp } from "@/test/render";

const responder = () => auth(me({ id: "u-r", roles: ["rescue_operator"], full_name: "Rıza Kurtaran" }));

function baseHandlers(current: { value: ReturnType<typeof incident> }) {
  server.use(
    http.get(`${API()}/incidents/i-1`, () => HttpResponse.json(current.value)),
    http.get(`${API()}/incidents`, () => HttpResponse.json({ items: [current.value], next_cursor: null })),
    http.get(`${API()}/rescue/team`, () =>
      HttpResponse.json({ items: [{ user_id: "u-t", full_name: "Tuna Ekip", availability: "available", last_position: null, active_assignment: null }] }),
    ),
  );
}

describe("bestIncidentPosition", () => {
  it("uses the most recent fix regardless of its source", async () => {
    const { bestIncidentPosition } = await import("./IncidentDetail");
    const older = { id: "p", seq: 1, t: "2026-11-04T10:00:00.000Z", received_at: "2026-11-04T10:00:01.000Z", lat: 1, lon: 1, gps_alt_m: 1, h_acc_m: 5, v_acc_m: null, speed_ms: null, course_deg: null };
    const inc = incident({ last_known_position: older, position: { lat: 2, lon: 2, gps_alt_m: 2, h_acc_m: 9, t: "2026-11-04T10:01:00.000Z" } });
    expect(bestIncidentPosition(inc)).toMatchObject({ lat: 2, source: "sos" });
    const inc2 = incident({ last_known_position: { ...older, t: "2026-11-04T10:05:00.000Z" }, position: { lat: 2, lon: 2, gps_alt_m: 2, h_acc_m: 9, t: "2026-11-04T10:01:00.000Z" } });
    expect(bestIncidentPosition(inc2)).toMatchObject({ lat: 1, source: "flight" });
  });
});

describe("incident detail", () => {
  it("shows the disclaimer, emergency contact and never claims acknowledgement before the server does", async () => {
    const current = { value: incident() };
    baseHandlers(current);
    renderApp("/app/incidents/i-1", { session: responder() });
    expect(await screen.findByRole("heading", { name: "Ayşe Kaya" })).toBeInTheDocument();
    expect(screen.getAllByText(/otomatik bildirim yapmaz/).length).toBeGreaterThan(0);
    expect(screen.getByText("Mehmet Kaya")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\+90 555/ })).toHaveAttribute("href", "tel:+905550000000");
    expect(screen.getByText("Henüz kimse onaylamadı.")).toBeInTheDocument();
    expect(screen.queryByText(/tarafından .* onaylandı/)).not.toBeInTheDocument();
  });

  it("acknowledges via the API and only then shows who acknowledged", async () => {
    const current = { value: incident() };
    baseHandlers(current);
    let ackCalls = 0;
    server.use(
      http.post(`${API()}/incidents/i-1/acknowledge`, () => {
        ackCalls++;
        current.value = incident({ status: "acknowledged", acknowledged_at: "2026-11-04T10:01:00.000Z", acknowledged_by: { user_id: "u-r", full_name: "Rıza Kurtaran" } });
        return HttpResponse.json(current.value);
      }),
    );
    const user = userEvent.setup();
    renderApp("/app/incidents/i-1", { session: responder() });
    await user.click(await screen.findByRole("button", { name: "Bildirimi onayla" }));
    expect(await screen.findByText(/Rıza Kurtaran tarafından .* onaylandı/)).toBeInTheDocument();
    expect(ackCalls).toBe(1);
    expect(screen.queryByRole("button", { name: "Bildirimi onayla" })).not.toBeInTheDocument();
  });

  it("surfaces server errors from actions", async () => {
    const current = { value: incident() };
    baseHandlers(current);
    server.use(
      http.post(`${API()}/incidents/i-1/acknowledge`, () => HttpResponse.json({ error: { code: "forbidden", message: "nope" } }, { status: 403 })),
    );
    const user = userEvent.setup();
    renderApp("/app/incidents/i-1", { session: responder() });
    await user.click(await screen.findByRole("button", { name: "Bildirimi onayla" }));
    expect(await screen.findByText("Bu işlem için yetkiniz yok.")).toBeInTheDocument();
    expect(screen.getByText("Henüz kimse onaylamadı.")).toBeInTheDocument();
  });

  it("adds notes, assigns a responder and resolves with a note", async () => {
    const current = { value: incident({ status: "acknowledged", acknowledged_at: "2026-11-04T10:01:00.000Z", acknowledged_by: { user_id: "u-r", full_name: "Rıza" } }) };
    baseHandlers(current);
    const calls: Record<string, unknown> = {};
    server.use(
      http.post(`${API()}/incidents/i-1/notes`, async ({ request }) => { calls.note = await request.json(); return HttpResponse.json({}, { status: 201 }); }),
      http.post(`${API()}/incidents/i-1/assignments`, async ({ request }) => { calls.assign = await request.json(); return HttpResponse.json({}, { status: 201 }); }),
      http.post(`${API()}/incidents/i-1/status`, async ({ request }) => {
        calls.status = await request.json();
        current.value = { ...current.value, status: "resolved" };
        return HttpResponse.json(current.value);
      }),
    );
    const user = userEvent.setup();
    renderApp("/app/incidents/i-1", { session: responder() });
    await user.type(await screen.findByLabelText("Not ekle"), "Ekip yola çıktı");
    await user.click(screen.getByRole("button", { name: "Notu kaydet" }));
    await waitFor(() => expect(calls.note).toEqual({ body: "Ekip yola çıktı" }));

    await user.click(screen.getByRole("combobox", { name: "Görevli ata" }));
    await user.click(await screen.findByRole("option", { name: /Tuna Ekip/ }));
    await user.click(screen.getByRole("button", { name: "Ata" }));
    await waitFor(() => expect(calls.assign).toEqual({ responder_user_id: "u-t" }));

    await user.click(screen.getByRole("button", { name: "Çözüldü olarak kapat" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Kapanış notu"), "Pilot güvende");
    await user.click(within(dialog).getByRole("button", { name: "Olayı kapat" }));
    await waitFor(() => expect(calls.status).toEqual({ status: "resolved", note: "Pilot güvende" }));
    expect(await screen.findAllByText("Çözüldü")).not.toHaveLength(0);
  });

  it("labels test incidents clearly", async () => {
    const current = { value: incident({ is_test: true }) };
    baseHandlers(current);
    renderApp("/app/incidents", { session: responder() });
    const list = await screen.findByRole("list");
    expect(within(list).getByText("TEST")).toBeInTheDocument();
    // TEST incidents never use the emergency fill
    expect(within(list).getByText("Açık").closest("[data-slot=badge]")).toHaveAttribute("data-variant", "warning");
  });
});
