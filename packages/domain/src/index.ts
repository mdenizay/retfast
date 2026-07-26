import { z } from "zod";

export const globalRoleSchema = z.enum(["user", "superadmin"]);
export type GlobalRole = z.infer<typeof globalRoleSchema>;

export const eventRoleSchema = z.enum([
  "manager",
  "pilot",
  "retriever",
  "observer",
]);
export type EventRole = z.infer<typeof eventRoleSchema>;

export const eventVisibilitySchema = z.enum([
  "public",
  "unlisted",
  "private",
]);
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;

export const membershipStatusSchema = z.enum([
  "pending",
  "invited",
  "approved",
  "rejected",
  "declined",
]);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const flightStatusSchema = z.enum([
  "ready",
  "tracking",
  "landed",
  "emergency",
  "cancelled",
  "completed",
]);
export type FlightStatus = z.infer<typeof flightStatusSchema>;

export const retrievalStatusSchema = z.enum([
  "not_requested",
  "searching",
  "queued",
  "offered",
  "assigned",
  "picked_up",
  "delivered",
  "cancelled",
]);
export type RetrievalStatus = z.infer<typeof retrievalStatusSchema>;

export const retrieverAvailabilitySchema = z.enum([
  "inactive",
  "available",
  "busy",
  "offline",
]);
export type RetrieverAvailability = z.infer<
  typeof retrieverAvailabilitySchema
>;

export const supportedLocaleSchema = z.enum(["tr", "en"]);
export type SupportedLocale = z.infer<typeof supportedLocaleSchema>;

export const userProfileSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  displayName: z.string().min(2).max(80),
  locale: supportedLocaleSchema.default("tr"),
  globalRole: globalRoleSchema.default("user"),
  radioCallsign: z.string().max(24).nullable().default(null),
});
export type UserProfile = z.infer<typeof userProfileSchema>;
