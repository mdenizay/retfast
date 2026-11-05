import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient, backoffDelay } from "./realtime";
import { FakeSocket } from "@/test/fakeSocket";

function make(opts: Partial<ConstructorParameters<typeof RealtimeClient>[0]> = {}) {
  const messages: unknown[] = [];
  const statuses: [string, number][] = [];
  const client = new RealtimeClient({
    url: "ws://test/api/v1/realtime",
    getToken: () => "tok",
    onMessage: (m) => messages.push(m),
    onStatus: (s, n) => statuses.push([s, n]),
    createSocket: (u) => new FakeSocket(u),
    random: () => 0.5,
    ...opts,
  });
  return { client, messages, statuses };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
});
afterEach(() => vi.useRealTimers());

describe("backoffDelay", () => {
  it("grows exponentially from 1 s and caps at 30 s, with jitter within [base/2, base]", () => {
    expect(backoffDelay(1, () => 0)).toBe(500);
    expect(backoffDelay(1, () => 1)).toBe(1000);
    expect(backoffDelay(3, () => 1)).toBe(4000);
    expect(backoffDelay(10, () => 1)).toBe(30000);
    expect(backoffDelay(10, () => 0)).toBe(15000);
  });
});

describe("RealtimeClient", () => {
  it("authenticates first, subscribes after auth_ok with the latest cursor, and answers ping", () => {
    let cursor: string | null = "10-0";
    const { client, messages } = make();
    client.subscribe("event:e-1", () => cursor);
    client.start();
    const ws = FakeSocket.last();
    ws.open();
    expect(ws.sent).toEqual([{ type: "auth", access_token: "tok" }]);
    ws.receive({ type: "auth_ok", user_id: "u" });
    expect(ws.sent[1]).toEqual({ type: "subscribe", channel: "event:e-1", since: "10-0" });
    ws.receive({ type: "ping" });
    expect(ws.sent[2]).toEqual({ type: "pong" });
    ws.receive({ type: "position", channel: "event:e-1", cursor: "11-0", data: {} });
    expect(messages).toHaveLength(1);
    cursor = "11-0";
    client.stop();
  });

  it("guests skip auth and subscribe immediately", () => {
    const { client } = make({ getToken: () => null });
    client.subscribe("event:e-1");
    client.start();
    const ws = FakeSocket.last();
    ws.open();
    expect(ws.sent).toEqual([{ type: "subscribe", channel: "event:e-1" }]);
    client.stop();
  });

  it("reconnects with exponential backoff and resubscribes with the last cursor", () => {
    let cursor = "1-0";
    const { client, statuses } = make();
    client.subscribe("event:e-1", () => cursor);
    client.start();
    FakeSocket.last().open();
    FakeSocket.last().receive({ type: "auth_ok" });
    cursor = "42-0";

    FakeSocket.last().serverClose(1012);
    expect(statuses.at(-1)).toEqual(["reconnecting", 1]);
    vi.advanceTimersByTime(749); // attempt 1: base 1000, random 0.5 → 750 ms
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    // second failure before open → attempt 2 → 1500 ms
    FakeSocket.last().serverClose(1006);
    vi.advanceTimersByTime(1499);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);

    const ws = FakeSocket.last();
    ws.open();
    ws.receive({ type: "auth_ok" });
    expect(ws.sent).toContainEqual({ type: "subscribe", channel: "event:e-1", since: "42-0" });
    expect(statuses.at(-1)).toEqual(["open", 0]);
    client.stop();
  });

  it("refreshes the token on close 4001 before reconnecting", async () => {
    const onUnauthorized = vi.fn(async () => true);
    const { client } = make({ onUnauthorized });
    client.subscribe("retrievals:e-1");
    client.start();
    FakeSocket.last().open();
    FakeSocket.last().serverClose(4001);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    client.stop();
  });

  it("closes a connection that has been silent for 60 s", () => {
    const { client } = make();
    client.start();
    const ws = FakeSocket.last();
    ws.open();
    vi.advanceTimersByTime(59_999);
    expect(ws.closedWith).toBeNull();
    vi.advanceTimersByTime(1);
    expect(ws.closedWith).toBe(4000);
    client.stop();
  });

  it("stop() prevents any further reconnects", () => {
    const { client } = make();
    client.start();
    FakeSocket.last().open();
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
