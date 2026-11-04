import { useCallback, useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Incident, Page } from "@/lib/api/types";
import { useRealtime } from "@/features/live/useRealtime";
import type { ServerMessage } from "@/features/live/realtime";

/** Merge a pushed incident into every cached incident list + its detail entry. */
export function applyIncidentUpdate(qc: QueryClient, inc: Incident) {
  qc.setQueryData<Incident>(["incident", inc.id], (prev) => (prev ? { ...prev, ...inc } : prev));
  qc.setQueriesData<Page<Incident>>({ queryKey: ["incidents"] }, (prev) => {
    if (!prev?.items) return prev;
    const idx = prev.items.findIndex((i) => i.id === inc.id);
    if (idx === -1) return prev; // list membership depends on filters → leave to refetch
    const items = prev.items.slice();
    items[idx] = { ...items[idx]!, ...inc };
    return { ...prev, items };
  });
}

/** Subscribes to the `incidents` channel (responders only; server scopes it). */
export function useIncidentStream(enabled: boolean) {
  const qc = useQueryClient();
  const onMessage = useCallback(
    (msg: ServerMessage) => {
      if (msg.type === "incident" && msg.data && typeof msg.data === "object") {
        const inc = msg.data as Incident;
        applyIncidentUpdate(qc, inc);
        void qc.invalidateQueries({ queryKey: ["incidents"] });
      }
    },
    [qc],
  );
  const channels = useMemo(() => [{ channel: "incidents" }], []);
  return useRealtime(channels, onMessage, enabled);
}
