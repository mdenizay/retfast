import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { bootstrapUser } from "../auth.js";
import { pool } from "../db/pool.js";

export const sessionRouter = Router();

sessionRouter.post("/bootstrap", async (request, response) => {
  const { locale } = z.object({ locale: z.enum(["tr", "en"]).default("tr") })
    .parse(request.body ?? {});
  const profile = await bootstrapUser(request.auth, locale);
  response.json({ data: { profile } });
});

sessionRouter.get("/me", async (request, response) => {
  const profile = await bootstrapUser(request.auth, "tr");
  response.json({ data: { profile } });
});

sessionRouter.post("/devices", async (request, response) => {
  const input = z.object({
    token: z.string().min(10).max(512),
    platform: z.enum(["ios", "android", "web"]),
  }).parse(request.body);
  await pool.query(
    `INSERT INTO push_devices(id,user_id,token,platform)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(token) DO UPDATE SET user_id=$2,platform=$4,updated_at=now()`,
    [randomUUID(), request.auth.uid, input.token, input.platform],
  );
  response.json({ data: { registered: true } });
});
