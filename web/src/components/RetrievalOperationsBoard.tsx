import {
  AlertTriangle,
  ArrowRightLeft,
  Car,
  CheckCircle2,
  MapPin,
  Radio,
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useLocale } from "../i18n";
import type { LiveParticipant } from "../lib/live";
import {
  managerAssignRetrievalCommand,
  managerDispatchRetrievalCommand,
  updateRetrievalCommand,
  useRetrievalOperations,
} from "../lib/retrieval";

export function RetrievalOperationsBoard({
  eventId,
  participants,
}: {
  eventId: string;
  participants: LiveParticipant[];
}) {
  const { copy } = useLocale();
  const { jobs, retrievers } = useRetrievalOperations(eventId);
  const [vehiclesByJob, setVehiclesByJob] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const activeJobs = useMemo(
    () => jobs.filter((job) => !["delivered", "cancelled"].includes(job.status)),
    [jobs],
  );
  const openVehicles = retrievers.filter(
    (retriever) =>
      retriever.availability === "available" &&
      retriever.assignedCount < retriever.capacity,
  );
  const pilotsWithoutJob = participants.filter(
    (participant) =>
      participant.role === "pilot" &&
      participant.online &&
      !activeJobs.some((job) => job.sessionId === participant.sessionId),
  );

  async function run(key: string, command: () => Promise<unknown>) {
    setBusy(key);
    setMessage(null);
    try {
      await command();
      setMessage(copy.commandCompleted);
    } catch {
      setMessage(copy.commandFailed);
    } finally {
      setBusy(null);
    }
  }

  function selectedVehicle(key: string) {
    return vehiclesByJob[key] ?? openVehicles[0]?.userId ?? "";
  }

  return (
    <section className="retrieval-board">
      <div className="retrieval-board-heading">
        <div>
          <span className="section-kicker">{copy.retrievalDesk}</span>
          <h3>{copy.activeRetrievals}</h3>
          <p>{copy.retrievalDeskHint}</p>
        </div>
        <div className="vehicle-capacity-summary">
          <Car />
          <strong>{openVehicles.length}</strong>
          <span>{copy.available}</span>
        </div>
      </div>

      {message && <div className={`inline-alert ${message === copy.commandCompleted ? "success" : "error"}`}>{message}</div>}

      <div className="retrieval-columns">
        <div className="retrieval-column">
          <div className="retrieval-column-title"><Radio /><span>{copy.awaitingDispatch}</span><strong>{pilotsWithoutJob.length}</strong></div>
          {pilotsWithoutJob.length === 0 && <p className="retrieval-empty">{copy.noRetrievals}</p>}
          {pilotsWithoutJob.map((pilot) => {
            const vehicle = selectedVehicle(pilot.sessionId);
            return (
              <article className="dispatch-card" key={pilot.sessionId}>
                <div className="dispatch-identity"><span className="dispatch-avatar pilot">{pilot.displayName.slice(0, 2).toUpperCase()}</span><div><strong>{pilot.displayName}</strong><small><MapPin />{pilot.latitude.toFixed(4)}, {pilot.longitude.toFixed(4)}</small></div></div>
                <div className="dispatch-controls">
                  <select value={vehicle} onChange={(event) => setVehiclesByJob((current) => ({ ...current, [pilot.sessionId]: event.target.value }))}>
                    {openVehicles.length === 0 && <option value="">{copy.noAvailableVehicles}</option>}
                    {openVehicles.map((retriever) => <option key={retriever.userId} value={retriever.userId}>{retriever.displayName} · {retriever.assignedCount}/{retriever.capacity}</option>)}
                  </select>
                  <button className="primary-button" disabled={!vehicle || busy === pilot.sessionId} type="button" onClick={() => void run(pilot.sessionId, () => managerDispatchRetrievalCommand(eventId, pilot.sessionId, vehicle))}><UserRoundCheck />{copy.dispatch}</button>
                </div>
              </article>
            );
          })}
        </div>

        <div className="retrieval-column">
          <div className="retrieval-column-title"><Car /><span>{copy.activeRetrievals}</span><strong>{activeJobs.length}</strong></div>
          {activeJobs.length === 0 && <p className="retrieval-empty">{copy.noRetrievals}</p>}
          {activeJobs.map((job) => {
            const vehicle = selectedVehicle(job.id);
            return (
              <article className={`retrieval-job-card urgency-${job.urgency}`} key={job.id}>
                <div className="retrieval-job-top">
                  <span className="retrieval-job-icon">{job.urgency === "emergency" ? <AlertTriangle /> : <Car />}</span>
                  <div><strong>{job.pilotName}</strong><small>{job.pilotRadioCallsign || copy.pilot}</small></div>
                  <span className={`retrieval-status status-${job.status}`}>{copy[job.status]}</span>
                </div>
                <div className="retrieval-assignee"><span>{job.assignedRetrieverName ?? job.offeredRetrieverName ?? copy.noAvailableVehicles}</span>{job.urgency === "emergency" && <b>{copy.emergency}</b>}</div>
                <div className="dispatch-controls compact-dispatch-controls">
                  <select value={vehicle} onChange={(event) => setVehiclesByJob((current) => ({ ...current, [job.id]: event.target.value }))}>
                    {openVehicles.length === 0 && <option value="">{copy.noAvailableVehicles}</option>}
                    {openVehicles.map((retriever) => <option key={retriever.userId} value={retriever.userId}>{retriever.displayName} · {retriever.assignedCount}/{retriever.capacity}</option>)}
                  </select>
                  <button className="secondary-button" disabled={!vehicle || busy === job.id} type="button" onClick={() => void run(job.id, () => managerAssignRetrievalCommand(eventId, job.id, vehicle))}><ArrowRightLeft />{copy.transfer}</button>
                </div>
                <div className="retrieval-job-actions">
                  {job.status === "assigned" && <button type="button" disabled={busy === job.id} onClick={() => void run(job.id, () => updateRetrievalCommand(eventId, job.id, "picked_up"))}><CheckCircle2 />{copy.markPickedUp}</button>}
                  {job.status === "picked_up" && <button type="button" disabled={busy === job.id} onClick={() => void run(job.id, () => updateRetrievalCommand(eventId, job.id, "delivered"))}><UserRoundCheck />{copy.markDelivered}</button>}
                  <button className="cancel-job" type="button" disabled={busy === job.id} onClick={() => void run(job.id, () => updateRetrievalCommand(eventId, job.id, "cancelled"))}><XCircle />{copy.cancelRetrieval}</button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
