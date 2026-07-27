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

export const trackingRoleSchema = eventRoleSchema.extract([
  "pilot",
  "retriever",
]);
export type TrackingRole = z.infer<typeof trackingRoleSchema>;

export const trackingSessionStatusSchema = z.enum([
  "active",
  "completed",
  "cancelled",
  "interrupted",
]);
export type TrackingSessionStatus = z.infer<
  typeof trackingSessionStatusSchema
>;

export const connectivitySchema = z.enum([
  "online",
  "limited",
  "offline",
  "unknown",
]);
export type Connectivity = z.infer<typeof connectivitySchema>;

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

export const startTrackingSessionInputSchema = eventIdInputSchema.extend({
  deviceId: z.string().trim().min(8).max(128),
});

export const ingestTrackBatchInputSchema = eventIdInputSchema.extend({
  sessionId: z.string().trim().min(1).max(128),
  batchId: z.string().trim().regex(/^[a-zA-Z0-9_-]{8,128}$/),
  points: z.array(trackPointSchema).min(1).max(100),
}).superRefine((value, context) => {
  for (let index = 1; index < value.points.length; index += 1) {
    const previous = value.points[index - 1]!;
    const current = value.points[index]!;
    if (current.sequence <= previous.sequence) {
      context.addIssue({
        code: "custom",
        message: "points must be ordered by increasing sequence",
        path: ["points", index, "sequence"],
      });
    }
    if (current.recordedAt < previous.recordedAt) {
      context.addIssue({
        code: "custom",
        message: "points must be ordered by recordedAt",
        path: ["points", index, "recordedAt"],
      });
    }
  }
});

export const stopTrackingSessionInputSchema = eventIdInputSchema.extend({
  sessionId: z.string().trim().min(1).max(128),
  outcome: trackingSessionStatusSchema.exclude(["active"]),
});

export const configureRetrieverInputSchema = eventIdInputSchema.extend({
  capacity: z.number().int().min(1).max(12),
  availability: retrieverAvailabilitySchema.extract([
    "inactive",
    "available",
    "busy",
  ]),
});

export const nearbyRetrieversInputSchema = eventIdInputSchema.extend({
  sessionId: z.string().trim().min(1).max(128),
});

export const requestRetrievalInputSchema = nearbyRetrieversInputSchema.extend({
  retrieverId: z.string().trim().min(1).max(128),
  urgency: z.enum(["normal", "emergency"]).default("normal"),
});

export const respondRetrievalInputSchema = eventIdInputSchema.extend({
  jobId: z.string().trim().min(1).max(128),
  accept: z.boolean(),
});

export const updateRetrievalInputSchema = eventIdInputSchema.extend({
  jobId: z.string().trim().min(1).max(128),
  action: z.enum(["picked_up", "delivered", "cancelled"]),
});

export const managerAssignRetrievalInputSchema = eventIdInputSchema.extend({
  jobId: z.string().trim().min(1).max(128),
  retrieverId: z.string().trim().min(1).max(128),
});

export const managerDispatchRetrievalInputSchema = eventIdInputSchema.extend({
  sessionId: z.string().trim().min(1).max(128),
  retrieverId: z.string().trim().min(1).max(128),
  urgency: z.enum(["normal", "emergency"]).default("normal"),
});

export const registerPushTokenInputSchema = z.object({
  token: z.string().trim().min(20).max(256),
  platform: z.enum(["android", "ios"]),
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

export type TrackingSessionRecord = {
  id: string;
  eventId: string;
  userId: string;
  role: TrackingRole;
  status: TrackingSessionStatus;
  deviceId: string;
  startedAt: Date;
  stoppedAt: Date | null;
  pointCount: number;
  latestPoint: TrackPoint | null;
};
