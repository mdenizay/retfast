import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { ApiError } from "@/lib/api/client";
import { event } from "@/test/fixtures";
import { EventForm, validateEventForm } from "./EventForm";

function renderForm(props: Partial<Parameters<typeof EventForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <I18nProvider initialLang="tr">
      <ThemeProvider>
        <EventForm onSubmit={onSubmit} submitLabel="Etkinliği oluştur" {...props} />
      </ThemeProvider>
    </I18nProvider>,
  );
  return { onSubmit };
}

describe("EventForm", () => {
  it("validates required fields and date order before submitting", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await user.click(screen.getByRole("button", { name: "Etkinliği oluştur" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText("Zorunlu alan").length).toBeGreaterThanOrEqual(3);

    await user.type(screen.getByLabelText("Etkinlik adı"), "Babadağ Open");
    await user.type(screen.getByLabelText("Başlangıç"), "2026-11-10T10:00");
    await user.type(screen.getByLabelText("Bitiş"), "2026-11-09T10:00");
    await user.click(screen.getByRole("button", { name: "Etkinliği oluştur" }));
    expect(screen.getByText("Bitiş başlangıçtan sonra olmalı.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a contract-shaped payload with ISO dates and settings toggles", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await user.type(screen.getByLabelText("Etkinlik adı"), "  Babadağ Open ");
    await user.type(screen.getByLabelText("Adres (slug)"), "babadag-open");
    await user.type(screen.getByLabelText("Konum"), "Fethiye");
    await user.type(screen.getByLabelText("Başlangıç"), "2026-11-10T10:00");
    await user.type(screen.getByLabelText("Bitiş"), "2026-11-12T18:00");
    await user.type(screen.getByLabelText("Enlem"), "36.55");
    await user.type(screen.getByLabelText("Boylam"), "29.18");
    await user.click(screen.getByRole("switch", { name: "Herkese açık canlı harita" }));
    await user.click(screen.getByRole("button", { name: "Etkinliği oluştur" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const input = onSubmit.mock.calls[0]![0];
    expect(input).toMatchObject({
      name: "Babadağ Open",
      slug: "babadag-open",
      location_name: "Fethiye",
      visibility: "public",
      center: { lat: 36.55, lon: 29.18 },
      center_is_approximate: true,
      settings: { public_live_map: true, live_tracking: true, applications_open: true, pilots_see_each_other: true, landing_prompt: true },
    });
    expect(input.starts_at).toBe(new Date("2026-11-10T10:00").toISOString());
    expect(input.status).toBeUndefined(); // status only sent when editing
  });

  it("rejects invalid slugs", () => {
    const errs = validateEventForm({
      name: "x", slug: "Bad Slug", description: "", location_name: "", starts_at: "2026-01-01T00:00", ends_at: "2026-01-02T00:00",
      visibility: "public", status: "draft", lat: "95", lon: "29", center_is_approximate: true,
      settings: { applications_open: true, live_tracking: true, public_live_map: false, pilots_see_each_other: true, landing_prompt: true },
    });
    expect(errs.slug).toBe("eventForm.slugInvalid");
    expect(errs.lat).toBe("eventForm.coordInvalid");
  });

  it("prefills when editing and shows server field errors", () => {
    const err = new ApiError({ status: 422, code: "validation_failed", message: "Doğrulama hatası", details: { slug: "Bu adres kullanımda." } });
    renderForm({ event: event({ name: "Çameli Demo", slug: "cameli" }), error: err, submitLabel: "Kaydet" });
    expect(screen.getByLabelText("Etkinlik adı")).toHaveValue("Çameli Demo");
    expect(screen.getByText("Bu adres kullanımda.")).toBeInTheDocument();
    expect(screen.getByText("Doğrulama hatası")).toBeInTheDocument();
    expect(screen.getByLabelText("Durum")).toBeInTheDocument();
  });
});
