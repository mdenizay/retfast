import "dotenv/config";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: booleanString,
  FIREBASE_PROJECT_ID: z.string().min(1).default("retfast-ab7ca"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  SUPERADMIN_EMAILS: z.string().default(""),
  TRUST_PROXY: z.coerce.number().int().min(0).max(2).default(1),
  LOG_LEVEL: z.string().default("info"),
  WS_HEARTBEAT_MS: z.coerce.number().int().min(10_000).default(30_000),
});

const parsed = schema.parse(process.env);

export const config = {
  ...parsed,
  corsOrigins: new Set(
    parsed.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
  ),
  superadminEmails: new Set(
    parsed.SUPERADMIN_EMAILS.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ),
};
