import { z } from "zod";
export declare const globalRoleSchema: z.ZodEnum<{
    user: "user";
    superadmin: "superadmin";
}>;
export type GlobalRole = z.infer<typeof globalRoleSchema>;
export declare const eventRoleSchema: z.ZodEnum<{
    manager: "manager";
    pilot: "pilot";
    retriever: "retriever";
    observer: "observer";
}>;
export type EventRole = z.infer<typeof eventRoleSchema>;
export declare const eventVisibilitySchema: z.ZodEnum<{
    public: "public";
    unlisted: "unlisted";
    private: "private";
}>;
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;
export declare const eventStatusSchema: z.ZodEnum<{
    draft: "draft";
    published: "published";
    active: "active";
    completed: "completed";
    cancelled: "cancelled";
}>;
export type EventStatus = z.infer<typeof eventStatusSchema>;
export declare const membershipStatusSchema: z.ZodEnum<{
    pending: "pending";
    invited: "invited";
    approved: "approved";
    rejected: "rejected";
    declined: "declined";
}>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;
export declare const flightStatusSchema: z.ZodEnum<{
    completed: "completed";
    cancelled: "cancelled";
    ready: "ready";
    tracking: "tracking";
    landed: "landed";
    emergency: "emergency";
}>;
export type FlightStatus = z.infer<typeof flightStatusSchema>;
export declare const retrievalStatusSchema: z.ZodEnum<{
    cancelled: "cancelled";
    not_requested: "not_requested";
    searching: "searching";
    queued: "queued";
    offered: "offered";
    assigned: "assigned";
    picked_up: "picked_up";
    delivered: "delivered";
}>;
export type RetrievalStatus = z.infer<typeof retrievalStatusSchema>;
export declare const retrieverAvailabilitySchema: z.ZodEnum<{
    inactive: "inactive";
    available: "available";
    busy: "busy";
    offline: "offline";
}>;
export type RetrieverAvailability = z.infer<typeof retrieverAvailabilitySchema>;
export declare const supportedLocaleSchema: z.ZodEnum<{
    tr: "tr";
    en: "en";
}>;
export type SupportedLocale = z.infer<typeof supportedLocaleSchema>;
export declare const userProfileSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodEmail;
    displayName: z.ZodString;
    locale: z.ZodDefault<z.ZodEnum<{
        tr: "tr";
        en: "en";
    }>>;
    globalRole: z.ZodDefault<z.ZodEnum<{
        user: "user";
        superadmin: "superadmin";
    }>>;
    radioCallsign: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export declare const createEventInputSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    venue: z.ZodString;
    startsAt: z.ZodISODateTime;
    endsAt: z.ZodISODateTime;
    timezone: z.ZodDefault<z.ZodString>;
    visibility: z.ZodDefault<z.ZodEnum<{
        public: "public";
        unlisted: "unlisted";
        private: "private";
    }>>;
    status: z.ZodDefault<z.ZodEnum<{
        draft: "draft";
        published: "published";
    }>>;
    managerEmail: z.ZodOptional<z.ZodEmail>;
}, z.core.$strip>;
export type CreateEventInput = z.infer<typeof createEventInputSchema>;
export declare const updateEventInputSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    venue: z.ZodOptional<z.ZodString>;
    startsAt: z.ZodOptional<z.ZodISODateTime>;
    endsAt: z.ZodOptional<z.ZodISODateTime>;
    timezone: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    visibility: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        public: "public";
        unlisted: "unlisted";
        private: "private";
    }>>>;
    eventId: z.ZodString;
    status: z.ZodOptional<z.ZodEnum<{
        draft: "draft";
        published: "published";
        active: "active";
        completed: "completed";
        cancelled: "cancelled";
    }>>;
}, z.core.$strip>;
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;
export declare const eventIdInputSchema: z.ZodObject<{
    eventId: z.ZodString;
}, z.core.$strip>;
export declare const applyToEventInputSchema: z.ZodObject<{
    eventId: z.ZodString;
}, z.core.$strip>;
export declare const setEventManagerInputSchema: z.ZodObject<{
    eventId: z.ZodString;
    email: z.ZodEmail;
}, z.core.$strip>;
export declare const inviteMemberInputSchema: z.ZodObject<{
    eventId: z.ZodString;
    email: z.ZodEmail;
    role: z.ZodEnum<{
        pilot: "pilot";
        retriever: "retriever";
        observer: "observer";
    }>;
}, z.core.$strip>;
export declare const reviewMembershipInputSchema: z.ZodObject<{
    eventId: z.ZodString;
    userId: z.ZodString;
    decision: z.ZodEnum<{
        approved: "approved";
        rejected: "rejected";
    }>;
    role: z.ZodOptional<z.ZodEnum<{
        pilot: "pilot";
        retriever: "retriever";
        observer: "observer";
    }>>;
}, z.core.$strip>;
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
//# sourceMappingURL=index.d.ts.map