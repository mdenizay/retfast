import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { isApiError } from "@/lib/api/client";
import { retrievalsApi } from "@/lib/api/endpoints";
import type { Retrieval } from "@/lib/api/types";
import type { LiveStore } from "./store";

export type RetrievalActionKind = "accept" | "release" | "assign" | "picked_up" | "delivered" | "cancel" | "note";

export interface RetrievalActionInput {
  kind: RetrievalActionKind;
  id: string;
  retrieverUserId?: string;
  text?: string;
}

function isRetrieval(x: unknown): x is Retrieval {
  return Boolean(x && typeof x === "object" && "status" in (x as object) && "pickup" in (x as object));
}

/**
 * Runs one retrieval command against the API. The UI is updated only from the server's answer
 * (never optimistically): the returned Retrieval — or, on 409 (someone else got there first),
 * a fresh GET of that retrieval — is dispatched into the live store.
 */
export function useRetrievalAction(store: LiveStore | null) {
  const [conflict, setConflict] = useState<{ id: string; kind: RetrievalActionKind } | null>(null);
  const m = useMutation({
    mutationFn: async (input: RetrievalActionInput): Promise<unknown> => {
      setConflict(null);
      switch (input.kind) {
        case "accept": return retrievalsApi.accept(input.id);
        case "release": return retrievalsApi.release(input.id);
        case "assign": return retrievalsApi.assign(input.id, input.retrieverUserId!);
        case "picked_up": return retrievalsApi.pickedUp(input.id);
        case "delivered": return retrievalsApi.delivered(input.id, input.text);
        case "cancel": return retrievalsApi.cancel(input.id, input.text);
        case "note": {
          await retrievalsApi.addNote(input.id, input.text ?? "");
          return retrievalsApi.get(input.id).catch(() => undefined);
        }
      }
    },
    onSuccess: (res) => {
      if (isRetrieval(res)) store?.dispatch({ type: "retrieval", data: res });
    },
    onError: async (err, input) => {
      if (isApiError(err) && err.status === 409) {
        setConflict({ id: input.id, kind: input.kind });
        const fresh = await retrievalsApi.get(input.id).catch(() => null);
        if (fresh) store?.dispatch({ type: "retrieval", data: fresh });
      }
    },
  });
  const isConflict = isApiError(m.error) && m.error.status === 409;
  return {
    run: (input: RetrievalActionInput, opts?: { onSuccess?: () => void }) => m.mutate(input, { onSuccess: () => opts?.onSuccess?.() }),
    pending: m.isPending ? m.variables : null,
    /** Non-409 error (409 is reported through `conflict`). */
    error: isConflict ? null : m.error,
    conflict,
    reset: () => {
      m.reset();
      setConflict(null);
    },
  };
}

export type RetrievalActions = ReturnType<typeof useRetrievalAction>;
