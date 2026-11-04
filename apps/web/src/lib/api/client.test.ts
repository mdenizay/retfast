import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server, API } from "@/test/server";
import { auth, me } from "@/test/fixtures";
import { session } from "@/lib/auth/session";
import { api, isApiError, refreshSession } from "./client";

describe("api client", () => {
  it("refreshes once (single-flight) for concurrent token_expired responses and retries each request", async () => {
    session.setAuth(auth(me(), "old"));
    let refreshCalls = 0;
    server.use(
      http.post(`${API()}/auth/refresh`, async ({ request }) => {
        refreshCalls++;
        expect(request.headers.get("Authorization")).toBeNull();
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json(auth(me(), "new"));
      }),
      http.get(`${API()}/things/:n`, ({ request, params }) => {
        if (request.headers.get("Authorization") === "Bearer new") return HttpResponse.json({ n: params.n });
        return HttpResponse.json({ error: { code: "token_expired", message: "expired" } }, { status: 401 });
      }),
    );
    const results = await Promise.all([1, 2, 3].map((n) => api<{ n: string }>(`/things/${n}`)));
    expect(results.map((r) => r.n)).toEqual(["1", "2", "3"]);
    expect(refreshCalls).toBe(1);
    expect(session.token()).toBe("new");
  });

  it("clears the session when refresh is rejected", async () => {
    session.setAuth(auth());
    server.use(
      http.post(`${API()}/auth/refresh`, () => HttpResponse.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 })),
      http.get(`${API()}/me`, () => HttpResponse.json({ error: { code: "token_expired", message: "x" } }, { status: 401 })),
    );
    await expect(api("/me")).rejects.toMatchObject({ status: 401 });
    expect(session.get().status).toBe("anonymous");
  });

  it("flags password_change_required globally", async () => {
    session.setAuth(auth(me({ must_change_password: false })));
    server.use(http.get(`${API()}/events`, () => HttpResponse.json({ error: { code: "password_change_required", message: "x" } }, { status: 403 })));
    await expect(api("/events")).rejects.toMatchObject({ code: "password_change_required" });
    expect(session.get().user?.must_change_password).toBe(true);
  });

  it("parses rate limits with Retry-After and exposes the request id", async () => {
    server.use(
      http.post(`${API()}/auth/login`, () =>
        HttpResponse.json({ error: { code: "rate_limited", message: "slow down" } }, { status: 429, headers: { "Retry-After": "42", "X-Request-Id": "req-9" } }),
      ),
    );
    const err = await api("/auth/login", { method: "POST", body: {} }).catch((e: unknown) => e);
    if (!isApiError(err)) throw new Error("expected ApiError");
    expect(isApiError(err)).toBe(true);
    expect(err.retryAfter).toBe(42);
    expect(err.requestId).toBe("req-9");
  });

  it("refreshSession resolves null (no throw) when offline", async () => {
    server.use(http.post(`${API()}/auth/refresh`, () => HttpResponse.error()));
    await expect(refreshSession()).resolves.toBeNull();
  });
});
