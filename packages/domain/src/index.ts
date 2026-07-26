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

export const eventStatusSchema = z.enum([
  "draft",
  "published",
  "active",
  "completed",
  "cancelled",
]);
export type EventStatus = z.infer<typeof eventStatusSchema>;

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

const dateTimeSchema = z.iso.datetime({ offset: true });

const eventDetailsSchema = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().max(1200).default(""),
  venue: z.string().trim().min(2).max(120),
  startsAt: dateTimeSchema,
  endsAt: dateTimeSchema,
  timezone: z.string().trim().min(3).max(64).default("Europe/Istanbul"),
  visibility: eventVisibilitySchema.default("public"),
  status: z.enum(["draft", "published"]).default("draft"),
});

export const createEventInputSchema = eventDetailsSchema
  .extend({ managerEmail: z.email().optional() })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
export type CreateEventInput = z.infer<typeof createEventInputSchema>;

export const updateEventInputSchema = eventDetailsSchema
  .partial()
  .extend({
    eventId: z.string().trim().min(1).max(128),
    status: eventStatusSchema.optional(),
  });
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;

export const eventIdInputSchema = z.object({
  eventId: z.string().trim().min(1).max(128),
});

export const applyToEventInputSchema = eventIdInputSchema;

export const setEventManagerInputSchema = eventIdInputSchema.extend({
  email: z.email(),
});

export const inviteMemberInputSchema = eventIdInputSchema.extend({
  email: z.email(),
  role: eventRoleSchema.exclude(["manager"]),
});

export const reviewMembershipInputSchema = eventIdInputSchema.extend({
  userId: z.string().trim().min(1).max(128),
  decision: z.enum(["approved", "rejected"]),
  role: eventRoleSchema.exclude(["manager"]).optional(),
}).refine((value) => value.decision !== "approved" || value.role != null, {
  message: "role is required when approving a membership",
  path: ["role"],
});

export type EventRecord = {
  id: string;
  name: string;
  slug: string;
  description: string;
  venue: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  visibility: EventVisibility;
  status: EventStatus;
  managerIds: string[];
  participantCount: number;
  createdBy: string;
};

export type EventMembershipRecord = {
  id: string;
  eventId: string;
  eventName: string;
  userId: string;
  email: string;
  displayName: string;
  radioCallsign: string | null;
  status: z.infer<typeof membershipStatusSchema>;
  role: EventRole | null;
  eventStartsAt: Date;
  eventEndsAt: Date;
};
