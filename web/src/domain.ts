export type EventRole = "manager" | "pilot" | "retriever" | "observer";

export type EventVisibility = "public" | "unlisted" | "private";

export type EventStatus =
  | "draft"
  | "published"
  | "active"
  | "completed"
  | "cancelled";

export type TrackingRole = Extract<EventRole, "pilot" | "retriever">;

export type Connectivity = "online" | "limited" | "offline" | "unknown";

export type CreateEventInput = {
  name: string;
  description: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  visibility: EventVisibility;
  status: "draft" | "published";
  managerEmail?: string;
};

export type UpdateEventInput = Partial<
  Omit<CreateEventInput, "managerEmail" | "status">
> & {
  eventId: string;
  status?: EventStatus;
};
