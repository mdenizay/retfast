export type RetrievalStatus =
  | "searching"
  | "offered"
  | "assigned"
  | "picked_up"
  | "delivered"
  | "cancelled";

export function haversineKilometres(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function canTransitionRetrieval(
  current: RetrievalStatus,
  next: RetrievalStatus,
) {
  const transitions: Record<RetrievalStatus, RetrievalStatus[]> = {
    searching: ["offered", "assigned", "cancelled"],
    offered: ["searching", "assigned", "cancelled"],
    assigned: ["picked_up", "cancelled"],
    picked_up: ["delivered", "cancelled"],
    delivered: [],
    cancelled: [],
  };
  return transitions[current].includes(next);
}
