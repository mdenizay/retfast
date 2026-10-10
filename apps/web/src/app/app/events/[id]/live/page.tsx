"use client";
import { useParams } from "next/navigation";
import { LiveConsole } from "@/components/events/live-console";

export default function LivePage() {
  const { id } = useParams<{ id: string }>();
  return <LiveConsole eventId={id} />;
}
