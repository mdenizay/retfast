import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiRequest } from "./lib/api";


Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForRetrievalNotifications() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("retrieval-offers", {
      name: "Retrieval offers",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted
    ? current
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;

  const projectId =
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
      ?.projectId;
  if (!projectId) return false;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await apiRequest("/v1/session/devices", {
    method: "POST",
    body: JSON.stringify({
      token: token.data,
      platform: Platform.OS === "ios" ? "ios" : "android",
    }),
  });
  return true;
}
