import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { handleBackgroundLocations, LOCATION_TASK_NAME } from "./service";

if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    LOCATION_TASK_NAME,
    async ({ data, error }) => {
      if (error || !data?.locations?.length) return;
      await handleBackgroundLocations(data.locations);
    },
  );
}
