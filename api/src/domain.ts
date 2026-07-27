import { z } from "zod";

export const eventRoleSchema = z.enum(["manager", "pilot", "retriever", "observer"]);
export const trackingRoleSchema = z.enum(["pilot", "retriever"]);
export const eventVisibilitySchema = z.enum(["public", "unlisted", "private"]);
export const eventStatusSchema = z.enum(["draft", "published", "active", "completed", "cancelled"]);
export const trackingStatusSchema = z.enum(["completed", "cancelled", "interrupted"]);
export const connectivitySchema = z.enum(["online", "limited", "offline", "unknown"]);

export const eventInputSchema = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().max(1200).default(""),
  venue: z.string().trim().min(2).max(120),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  timezone: z.string().trim().min(3).max(64).default("Europe/Istanbul"),
  visibility: eventVisibilitySchema.default("public"),
  status: z.enum(["draft", "published"]).default("draft"),
  managerEmail: z.email().optional(),
}).refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
  path: ["endsAt"],
  message: "Event end must be after its start.",
});

export const trackPointSchema = z.object({
  sequence: z.number().int().nonnegative(),
  recordedAt: z.number().int().positive(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().max(5_000).nullable(),
  altitude: z.number().min(-1_000).max(20_000).nullable(),
  altitudeAccuracy: z.number().nonnegative().max(5_000).nullable(),
  speed: z.number().nonnegative().max(200).nullable(),
  heading: z.number().min(0).max(360).nullable(),
  batteryLevel: z.number().min(0).max(1).nullable(),
  isCharging: z.boolean().nullable(),
  connectivity: connectivitySchema,
});

export type TrackPoint = z.infer<typeof trackPointSchema>;
