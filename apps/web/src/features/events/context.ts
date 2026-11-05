import { createContext, useContext } from "react";
import type { RfEvent } from "@/lib/api/types";
import type { EventAccess } from "@/lib/roles";

export interface EventContextValue {
  event: RfEvent;
  access: EventAccess;
  refetch: () => void;
}

export const EventContext = createContext<EventContextValue | null>(null);

/** Event loaded by the /app/events/:id layout. */
export function useEventContext(): EventContextValue {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error("useEventContext outside EventLayout");
  return ctx;
}

export function useOptionalEventContext(): EventContextValue | null {
  return useContext(EventContext);
}
