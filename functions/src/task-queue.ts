import { getFunctions } from "firebase-admin/functions";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onTaskDispatched } from "firebase-functions/v2/tasks";

import { db } from "./callable.js";
import { adminApp, REGION } from "./config.js";
import { nextLifecycleStatus, type LifecycleTransition } from "./lifecycle.js";

type LifecycleTask = {
  eventId: string;
  transition: LifecycleTransition;
  expectedBoundary: string;
};

export const syncEventLifecycle = onTaskDispatched<LifecycleTask>(
  {
    memory: "256MiB",
    minInstances: 0,
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: 60,
    retryConfig: {
      maxAttempts: 3,
      maxRetrySeconds: 3600,
      minBackoffSeconds: 30,
      maxBackoffSeconds: 300,
    },
    rateLimits: {
      maxConcurrentDispatches: 1,
      maxDispatchesPerSecond: 2,
    },
  },
  async (request) => {
    const { eventId, transition, expectedBoundary } = request.data;
    const eventReference = db.doc(`events/${eventId}`);

    await db.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(eventReference);
      if (!eventSnapshot.exists) return;
      const event = eventSnapshot.data();
      const startsAt = event?.startsAt as Timestamp | undefined;
      const endsAt = event?.endsAt as Timestamp | undefined;
      if (!startsAt || !endsAt) return;

      const currentBoundary =
        transition === "activate" ? startsAt.toDate() : endsAt.toDate();
      if (currentBoundary.toISOString() !== expectedBoundary) {
        logger.info("Ignoring stale event lifecycle task", { eventId, transition });
        return;
      }

      const nextStatus = nextLifecycleStatus(
        event?.status,
        startsAt.toDate(),
        endsAt.toDate(),
        new Date(),
      );
      if (nextStatus !== event?.status) {
        transaction.update(eventReference, {
          status: nextStatus,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  },
);

export async function enqueueLifecycleTasks(
  eventId: string,
  startsAt: Date,
  endsAt: Date,
) {
  const queue = getFunctions(adminApp).taskQueue<LifecycleTask>(
    `locations/${REGION}/functions/syncEventLifecycle`,
  );
  const now = Date.now() + 1000;
  const schedule = async (
    transition: LifecycleTransition,
    boundary: Date,
  ) => {
    await queue.enqueue(
      { eventId, transition, expectedBoundary: boundary.toISOString() },
      {
        scheduleTime: new Date(Math.max(boundary.getTime(), now)),
        dispatchDeadlineSeconds: 60,
      },
    );
  };

  const results = await Promise.allSettled([
    schedule("activate", startsAt),
    schedule("complete", endsAt),
  ]);
  const rejected = results.filter((result) => result.status === "rejected");
  if (rejected.length) {
    logger.warn("Some event lifecycle tasks could not be queued", {
      eventId,
      rejected: rejected.length,
    });
  }
  return rejected.length === 0;
}
