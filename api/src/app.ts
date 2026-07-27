import { randomUUID } from "node:crypto";

import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { errorHandler, notFound } from "./http/error.js";
import { eventsRouter } from "./routes/events.js";
import { messagesRouter } from "./routes/messages.js";
import { retrievalRouter } from "./routes/retrieval.js";
import { sessionRouter } from "./routes/session.js";
import { trackingRouter } from "./routes/tracking.js";

export const app = express();

app.set("trust proxy", config.TRUST_PROXY);
app.disable("x-powered-by");
app.use(helmet());
app.use(pinoHttp({
  level: config.LOG_LEVEL,
  genReqId: (request, response) => {
    const incoming = request.headers["cf-ray"] ?? request.headers["x-request-id"];
    const id = typeof incoming === "string" ? incoming : randomUUID();
    response.setHeader("x-request-id", id);
    return id;
  },
  redact: ["req.headers.authorization", "req.body.password", "req.body.token"],
}));
app.use(cors({
  credentials: false,
  origin(origin, callback) {
    if (!origin || config.corsOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_request, response) => {
  response.json({ status: "ok" });
});
app.get("/readyz", async (_request, response) => {
  await pool.query("SELECT 1");
  response.json({ status: "ready" });
});

app.use("/v1", requireAuth);
app.use("/v1/session", sessionRouter);
app.use("/v1/events", eventsRouter);
app.use("/v1", trackingRouter);
app.use("/v1", retrievalRouter);
app.use("/v1", messagesRouter);

app.use(notFound);
app.use(errorHandler);
