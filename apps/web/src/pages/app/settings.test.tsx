import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { auth, me } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import type { PilotProfile } from "@/lib/api/types";

const pilot: PilotProfile = {
  public_id: "deniz", display_name: "Deniz", bio: "", wing: "", license_no: "", nationality: "TR", phone: "",
  emergency_contact_name: "", emergency_contact_phone: "",
};

describe("settings", () => {
  it("saves the phone via PATCH /me/pilot and explains who can see it", async () => {
    const user = me({ pilot });
    let body: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API()}/events`, () => HttpResponse.json({ items: [], next_cursor: null })),
      http.get(`${API()}/notifications`, () => HttpResponse.json({ items: [] })),
      http.patch(`${API()}/me/pilot`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...pilot, ...body });
      }),
      http.get(`${API()}/me`, () => HttpResponse.json(me({ pilot: { ...pilot, phone: "+90 555 123 45 67" } }))),
    );
    const u = userEvent.setup();
    renderApp("/app/settings", { session: auth(user) });
    const phone = await screen.findByLabelText("Telefon", { selector: "#pilot-phone" });
    expect(screen.getByText(/sizi almayı kabul eden alıcı \(yalnızca o alım sürerken\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Kan grubu/)).not.toBeInTheDocument();
    expect(screen.queryByText(/görünürlüğü/)).not.toBeInTheDocument();
    await u.type(phone, "+90 555 123 45 67");
    await u.click(screen.getAllByRole("button", { name: "Kaydet" })[1]!);
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.phone).toBe("+90 555 123 45 67");
    expect(body).not.toHaveProperty("blood_type");
    expect(await screen.findAllByText("Kaydedildi")).not.toHaveLength(0);
  });
});
