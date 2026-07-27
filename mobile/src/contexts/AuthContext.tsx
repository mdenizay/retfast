import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  AppleAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  updateProfile,
  type User,
} from "@react-native-firebase/auth";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { apiRequest } from "../lib/api";
import { recoverTrackingSync } from "../tracking/service";

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  locale: "tr" | "en";
  globalRole: "user" | "superadmin";
  radioCallsign: string | null;
};

type AuthValue = {
  user: User | null;
  profile: UserProfile | null;
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);
const auth = getAuth();

const googleWebClientId = Constants.expoConfig?.extra?.googleWebClientId;
if (typeof googleWebClientId === "string") {
  GoogleSignin.configure({ webClientId: googleWebClientId });
}

async function bootstrapProfile() {
  return (await apiRequest<{ profile: UserProfile }>("/v1/session/bootstrap", {
    method: "POST",
    body: JSON.stringify({ locale: "tr" }),
  })).profile;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (nextUser) => {
        setUser(nextUser);
        if (nextUser) {
          try {
            setProfile(await bootstrapProfile());
          } catch (error) {
            console.warn("Session bootstrap is temporarily unavailable.", error);
          }
          void recoverTrackingSync().catch(() => undefined);
        } else {
          setProfile(null);
        }
        setInitializing(false);
      }),
    [],
  );

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      initializing,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      register: async (name, email, password) => {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        await updateProfile(credential.user, { displayName: name.trim() });
        await credential.user.getIdToken(true);
        setProfile(await bootstrapProfile());
      },
      signInWithGoogle: async () => {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const response = await GoogleSignin.signIn();
        if (response.type !== "success" || !response.data.idToken) {
          return;
        }
        const credential = GoogleAuthProvider.credential(response.data.idToken);
        await signInWithCredential(auth, credential);
      },
      signInWithApple: async () => {
        const rawNonce = Crypto.randomUUID();
        const hashedNonce = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          rawNonce,
        );
        const appleCredential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: hashedNonce,
        });
        if (!appleCredential.identityToken) {
          throw new Error("auth/missing-apple-identity-token");
        }
        const firebaseCredential = AppleAuthProvider.credential(
          appleCredential.identityToken,
          rawNonce,
        );
        const result = await signInWithCredential(auth, firebaseCredential);
        const name = appleCredential.fullName
          ? AppleAuthentication.formatFullName(appleCredential.fullName)
          : "";
        if (name && !result.user.displayName) {
          await updateProfile(result.user, { displayName: name });
        }
      },
      sendReset: async (email) => {
        await sendPasswordResetEmail(auth, email.trim());
      },
      changePassword: async (currentPassword, nextPassword) => {
        if (!auth.currentUser?.email) {
          throw new Error("auth/requires-recent-login");
        }
        const credential = EmailAuthProvider.credential(
          auth.currentUser.email,
          currentPassword,
        );
        await reauthenticateWithCredential(auth.currentUser, credential);
        await updatePassword(auth.currentUser, nextPassword);
      },
      signOut: async () => {
        await Promise.allSettled([GoogleSignin.signOut(), firebaseSignOut(auth)]);
      },
    }),
    [initializing, profile, user],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
