import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { auth, me } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import { session } from "@/lib/auth/session";

function stubDashboard() {
  server.use(
    http.get(`${API()}/events`, () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get(`${API()}/flights`, () => HttpResponse.json({ items: [], next_cursor: null })),
  );
}

describe("login flow", () => {
  it("signs in and lands on the requested page", async () => {
    stubDashboard();
    let body: unknown;
    server.use(
      http.post(`${API()}/auth/login`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(auth(me({ full_name: "Deniz Ay" })));
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp("/login?next=%2Fapp", { session: null });
    await user.type(await screen.findByLabelText("E-posta"), "deniz@retfast.com");
    await user.type(screen.getByLabelText("Şifre"), "password");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(body).toMatchObject({ email: "deniz@retfast.com", password: "password", client: "web" });
    expect(await screen.findByRole("heading", { name: "Merhaba Deniz" })).toBeInTheDocument();
    // token lives in memory only
    expect(JSON.stringify(localStorage)).not.toContain("access-1");
  });

  it("shows a wrong-credentials message", async () => {
    server.use(http.post(`${API()}/auth/login`, () => HttpResponse.json({ error: { code: "unauthorized", message: "bad" } }, { status: 401 })));
    const user = userEvent.setup();
    renderApp("/login", { session: null });
    await user.type(await screen.findByLabelText("E-posta"), "x@y.z");
    await user.type(screen.getByLabelText("Şifre"), "nope");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(await screen.findByText("E-posta veya şifre hatalı.")).toBeInTheDocument();
  });

  it("shows the rate-limit message with Retry-After and disables submit", async () => {
    server.use(http.post(`${API()}/auth/login`, () => HttpResponse.json({ error: { code: "rate_limited", message: "x" } }, { status: 429, headers: { "Retry-After": "30" } })));
    const user = userEvent.setup();
    renderApp("/login", { session: null });
    await user.type(await screen.findByLabelText("E-posta"), "x@y.z");
    await user.type(screen.getByLabelText("Şifre"), "nope");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(await screen.findByText(/30 saniye sonra/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Giriş yap" })).toBeDisabled();
  });

  it("forced first-login: login → change password → app", async () => {
    stubDashboard();
    let changeBody: unknown;
    server.use(
      http.post(`${API()}/auth/login`, () => HttpResponse.json(auth(me({ must_change_password: true }), "boot"))),
      http.post(`${API()}/auth/password/change`, async ({ request }) => {
        changeBody = await request.json();
        expect(request.headers.get("Authorization")).toBe("Bearer boot");
        return HttpResponse.json(auth(me({ must_change_password: false }), "fresh"));
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp("/login", { session: null });
    await user.type(await screen.findByLabelText("E-posta"), "deniz@retfast.com");
    await user.type(screen.getByLabelText("Şifre"), "password");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/change-password"));

    await user.type(await screen.findByLabelText("Mevcut şifre", {}, { timeout: 3000 }), "password");
    await user.type(screen.getByLabelText("Yeni şifre"), "short");
    await user.type(screen.getByLabelText("Yeni şifre (tekrar)"), "short");
    expect(screen.getByRole("button", { name: "Şifreyi güncelle" })).toBeDisabled();

    await user.clear(screen.getByLabelText("Yeni şifre"));
    await user.clear(screen.getByLabelText("Yeni şifre (tekrar)"));
    await user.type(screen.getByLabelText("Yeni şifre"), "Yamac-Parasutu-2026");
    await user.type(screen.getByLabelText("Yeni şifre (tekrar)"), "Yamac-Parasutu-2026");
    await user.click(screen.getByRole("button", { name: "Şifreyi güncelle" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(changeBody).toEqual({ current_password: "password", new_password: "Yamac-Parasutu-2026" });
    expect(session.token()).toBe("fresh");
  });

  it("shows the server's password policy error on the field", async () => {
    server.use(
      http.post(`${API()}/auth/password/change`, () =>
        HttpResponse.json({ error: { code: "validation_failed", message: "weak", details: { new_password: "Bu şifre çok yaygın." } } }, { status: 422 }),
      ),
    );
    const user = userEvent.setup();
    renderApp("/change-password", { session: auth(me({ must_change_password: true })) });
    await user.type(await screen.findByLabelText("Mevcut şifre"), "password");
    await user.type(screen.getByLabelText("Yeni şifre"), "password123");
    await user.type(screen.getByLabelText("Yeni şifre (tekrar)"), "password123");
    await user.click(screen.getByRole("button", { name: "Şifreyi güncelle" }));
    expect(await screen.findByText("Bu şifre çok yaygın.")).toBeInTheDocument();
  });

  it("restores the session from the refresh cookie on boot", async () => {
    stubDashboard();
    let calls = 0;
    server.use(http.post(`${API()}/auth/refresh`, () => { calls++; return HttpResponse.json(auth(me({ full_name: "Ece Yıldız" }))); }));
    renderApp("/app");
    expect(await screen.findByRole("heading", { name: "Merhaba Ece" })).toBeInTheDocument();
    expect(calls).toBe(1);
  });
});
