import type { ConfigContext, ExpoConfig } from "expo/config";

import appJson from "./app.json";

type AppEnvironment = "development" | "production";

const environments = {
  development: {
    firebaseProjectId: "retfast-3279f",
    googleServicesFile: "./firebase/development/google-services.json",
    googleServiceInfoFile:
      "./firebase/development/GoogleService-Info.plist",
    googleWebClientId:
      "303883341213-9a1gqdvcpbue29bodf8m4qe0pn9bfgok.apps.googleusercontent.com",
  },
  production: {
    firebaseProjectId: "retfast-ab7ca",
    googleServicesFile: "./firebase/production/google-services.json",
    googleServiceInfoFile: "./firebase/production/GoogleService-Info.plist",
    googleWebClientId:
      "81048089421-eq7l6lm5jp1hruebcfgii6ohuvv38n1s.apps.googleusercontent.com",
  },
} as const;

function getEnvironment(): AppEnvironment {
  return process.env.APP_ENV === "production" ? "production" : "development";
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = getEnvironment();
  const environmentConfig = environments[environment];
  const baseConfig = appJson.expo as ExpoConfig;

  return {
    ...config,
    ...baseConfig,
    android: {
      ...baseConfig.android,
      googleServicesFile: environmentConfig.googleServicesFile,
    },
    ios: {
      ...baseConfig.ios,
      googleServicesFile: environmentConfig.googleServiceInfoFile,
    },
    extra: {
      ...baseConfig.extra,
      environment,
      firebaseProjectId: environmentConfig.firebaseProjectId,
      googleWebClientId: environmentConfig.googleWebClientId,
    },
  };
};
