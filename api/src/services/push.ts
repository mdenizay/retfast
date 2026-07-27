import { pool } from "../db/pool.js";

type PushNotification = {
  title: string;
  body: string;
  data: Record<string, string>;
};

export async function sendPushToUser(userId: string, notification: PushNotification) {
  const result = await pool.query<{ token: string }>(
    "SELECT token FROM push_devices WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 20",
    [userId],
  );
  const messages = result.rows
    .map((row) => row.token)
    .filter((token) => /^(Exponent|Expo)PushToken\[.+\]$/.test(token))
    .map((to) => ({
      to,
      sound: "default",
      priority: "high",
      channelId: "retrieval-offers",
      ...notification,
    }));
  if (messages.length === 0) return false;
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.warn("Expo push request failed", { status: response.status, userId });
      return false;
    }
    return true;
  } catch (error) {
    console.warn("Expo push request could not be sent", { error, userId });
    return false;
  }
}
