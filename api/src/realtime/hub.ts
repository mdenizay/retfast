import type { Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

import { requireEventMembership } from "../access.js";
import { verifyBearerToken } from "../auth.js";
import { config } from "../config.js";
import { pool } from "../db/pool.js";

type Client = WebSocket & {
  alive: boolean;
  userId?: string;
  subscriptions: Set<string>;
};

const clients = new Set<Client>();

export function publishEvent(eventId: string, type: string, data: unknown) {
  const message = JSON.stringify({ type, eventId, data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN && client.subscriptions.has(eventId)) {
      client.send(message);
    }
  }
}

export function attachRealtimeServer(server: Server) {
  const socketServer = new WebSocketServer({ server, path: "/v1/ws" });
  socketServer.on("connection", (socket) => {
    const client = socket as Client;
    client.alive = true;
    client.subscriptions = new Set();
    clients.add(client);
    client.on("pong", () => { client.alive = true; });
    client.on("close", () => clients.delete(client));
    client.on("message", async (raw) => {
      try {
        const message = z.discriminatedUnion("type", [
          z.object({ type: z.literal("authenticate"), token: z.string().min(1) }),
          z.object({ type: z.literal("subscribe"), eventId: z.string().min(1).max(128) }),
          z.object({ type: z.literal("unsubscribe"), eventId: z.string().min(1).max(128) }),
        ]).parse(JSON.parse(raw.toString()));
        if (message.type === "authenticate") {
          const token = await verifyBearerToken(`Bearer ${message.token}`);
          client.userId = token.uid;
          client.send(JSON.stringify({ type: "authenticated" }));
          return;
        }
        if (!client.userId) throw new Error("Unauthenticated socket.");
        if (message.type === "subscribe") {
          await requireEventMembership(pool, { uid: client.userId }, message.eventId);
          client.subscriptions.add(message.eventId);
          client.send(JSON.stringify({ type: "subscribed", eventId: message.eventId }));
        } else {
          client.subscriptions.delete(message.eventId);
        }
      } catch {
        client.send(JSON.stringify({ type: "error", code: "invalid_message" }));
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.terminate();
        continue;
      }
      client.alive = false;
      client.ping();
    }
  }, config.WS_HEARTBEAT_MS);
  socketServer.on("close", () => clearInterval(heartbeat));
  return socketServer;
}
