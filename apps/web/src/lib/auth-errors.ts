import type { Copy } from "../i18n";

export function getAuthErrorMessage(error: unknown, copy: Copy): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return copy.invalidCredentials;
    case "auth/email-already-in-use":
      return copy.emailInUse;
    case "auth/weak-password":
      return copy.weakPassword;
    case "auth/invalid-email":
      return copy.invalidEmail;
    case "auth/too-many-requests":
      return copy.tooManyRequests;
    case "auth/popup-closed-by-user":
      return copy.popupClosed;
    default:
      return copy.authError;
  }
}
