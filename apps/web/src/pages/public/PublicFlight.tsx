import { useParams } from "react-router";
import { FlightView } from "@/features/flights/FlightView";

export default function PublicFlightPage() {
  const { publicId = "" } = useParams();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <FlightView idOrPublicId={publicId} mode="public" />
    </div>
  );
}
