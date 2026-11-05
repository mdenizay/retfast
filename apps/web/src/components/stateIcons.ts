import { Car, CheckCircle2, CircleSlash, Eye, MapPin, Navigation2, ShieldCheck, UserCheck } from "lucide-react";
import type { RetrievalStatus } from "@/lib/api/types";

/** Icons that carry state meaning (paired with text labels everywhere — never color alone). */
export const ROLE_ICON = { organizer: ShieldCheck, pilot: Navigation2, observer: Eye, retriever: Car } as const;

export const RETRIEVAL_ICON: Record<RetrievalStatus, typeof MapPin> = {
  requested: MapPin,
  accepted: Car,
  picked_up: UserCheck,
  delivered: CheckCircle2,
  cancelled: CircleSlash,
};
