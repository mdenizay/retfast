import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { server } from "./server";
import { FakeSocket } from "./fakeSocket";
import { setSocketFactory } from "@/features/live/realtime";
import { session } from "@/lib/auth/session";
import { __resetRefreshForTests } from "@/lib/api/client";
import { __resetBootForTests } from "@/lib/auth";

// Route-level tests do real lazy imports + MSW round-trips; 1 s is too tight on a loaded machine.
configure({ asyncUtilTimeout: 3000 });

// MapLibre needs WebGL; map rendering is covered manually / e2e. Replace the canvas with a stub.
vi.mock("@/components/map/MapCanvas", async () => {
  const React = await import("react");
  return {
    MapCanvas: ({ label }: { label: string }) =>
      React.createElement("div", { role: "region", "aria-label": label, "data-testid": "map" }),
  };
});

setSocketFactory((url) => new FakeSocket(url));

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }),
  });
}
window.scrollTo = () => undefined;
// Radix primitives use these in jsdom.
window.HTMLElement.prototype.scrollIntoView ??= function () {};
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
window.HTMLElement.prototype.releasePointerCapture ??= () => undefined;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  session.reset();
  __resetRefreshForTests();
  __resetBootForTests();
  FakeSocket.reset();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterAll(() => server.close());
