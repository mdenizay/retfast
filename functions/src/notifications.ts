import { createHash } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onCall } from "firebase-functions/v2/https";

import { db, parseInput, requireAuth } from "./callable.js";
import { CALLABLE_OPTIONS } from "./config.js";
import { registerPushTokenInputSchema } from "./domain.js";

export const registerPushToken = onCall(CALLABLE_OPTIONS, async (request) => {
  const actor = requireAuth(request);
  const input = parseInput(registerPushTokenInputSchema, request.data);
  const tokenId = createHash("sha256").update(input.token).digest("hex");
  await db.doc(`users/${actor.uid}/devices/${tokenId}`).set(
    {
      token: input.token,
      platform: input.platform,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { registered: true };
});

export async function sendPushToUser(
  userId: string,
  notification: {
    title: string;
    body: string;
    data: Record<string, string>;
  },
) {
  const devices = await db.collection(`users/${userId}/devices`).limit(20).get();
  if (devices.empty) return false;
  const messages = devices.docs
    .map((device) => String(device.data().token ?? ""))
    .filter((token) => /^(Exponent|Expo)PushToken\[.+\]$/.test(token))
    .map((to) => ({
      to,
      sound: "default",
      priority: "high",
      channelId: "retrieval-offers",
      ...notification,
    }));
  if (!messages.length) return false;
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      logger.warn("Expo push request failed", {
        status: response.status,
        userId,
      });
      return false;
    }
    return true;
  } catch (error) {
    logger.warn("Expo push request could not be sent", { error, userId });
    return false;
  }
}
