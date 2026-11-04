import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { Providers, makeQueryClient } from "@/app/Providers";
import { createRoutes } from "@/app/routes";
import type { AuthResponse } from "@/lib/api/types";
import { server, API } from "./server";

/** Render the real route tree at `path`. `session` controls what POST /auth/refresh returns on boot. */
export function renderApp(path: string, opts: { session?: AuthResponse | null } = {}) {
  if (opts.session !== undefined) {
    server.use(
      http.post(`${API()}/auth/refresh`, () =>
        opts.session ? HttpResponse.json(opts.session) : HttpResponse.json({ error: { code: "unauthorized", message: "no session" } }, { status: 401 }),
      ),
    );
  }
  const router = createMemoryRouter(createRoutes(), { initialEntries: [path] });
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false } });
  const utils = render(
    <Providers client={client} lang="tr">
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, router, client };
}
