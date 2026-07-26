import Constants from "expo-constants";
import {
  getDatabase,
  setPersistenceCacheSizeBytes,
  setPersistenceEnabled,
} from "@react-native-firebase/database";

const databaseUrl = Constants.expoConfig?.extra?.firebaseDatabaseUrl;

if (typeof databaseUrl !== "string") {
  throw new Error("Firebase Realtime Database URL is missing from Expo config.");
}

export const realtime = getDatabase(undefined, databaseUrl);

export const realtimeReady = (async () => {
  await setPersistenceCacheSizeBytes(realtime, 10 * 1024 * 1024);
  await setPersistenceEnabled(realtime, true);
})().catch(() => {
  // Native persistence may already be initialized by a background task.
});
