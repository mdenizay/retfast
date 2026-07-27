import { Router } from "express";
import { z } from "zod";

import { bootstrapUser } from "../auth.js";

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
