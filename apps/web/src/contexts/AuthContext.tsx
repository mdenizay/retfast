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
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  updatePassword,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "../lib/firebase";

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  locale: "tr" | "en";
  globalRole: "user" | "superadmin";
  radioCallsign: string | null;
};

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  profileLoading: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function ensureProfile(user: User, fallbackName?: string) {
  const profileReference = doc(db, "users", user.uid);
  const profile = await getDoc(profileReference);
  const commonFields = {
    email: user.email ?? "",
    displayName: user.displayName || fallbackName || user.email?.split("@")[0] || "RETFAST User",
    locale: document.documentElement.lang === "en" ? "en" : "tr",
    updatedAt: serverTimestamp(),
  };

  await setDoc(
    profileReference,
    profile.exists()
      ? commonFields
      : {
          ...commonFields,
          id: user.uid,
          globalRole: "user",
          radioCallsign: null,
          createdAt: serverTimestamp(),
        },
    { merge: true },
  );
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getRedirectResult(auth).then(async (result) => {
      if (result?.user) {
        await ensureProfile(result.user);
      }
    });

    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        setProfileLoading(true);
        try {
          const bootstrap = httpsCallable<
            { locale: "tr" | "en" },
            { globalRole: "user" | "superadmin"; refreshToken: boolean }
          >(functions, "bootstrapSession");
          const result = await bootstrap({
            locale: document.documentElement.lang === "en" ? "en" : "tr",
          });
          if (result.data.refreshToken) await nextUser.getIdToken(true);
        } catch (error) {
          console.warn("Session bootstrap is temporarily unavailable.", error);
        }
      } else {
        setProfile(null);
        setProfileLoading(false);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, "users", user.uid),
      (snapshot) => {
        setProfile(snapshot.exists() ? (snapshot.data() as UserProfile) : null);
        setProfileLoading(false);
      },
      () => setProfileLoading(false),
    );
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      profileLoading,
      loading,
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
        await ensureProfile(credential.user, name.trim());
      },
      signInWithGoogle: async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });

        try {
          const credential = await signInWithPopup(auth, provider);
          await ensureProfile(credential.user);
        } catch (error) {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? String(error.code)
              : "";
          if (code === "auth/popup-blocked") {
            await signInWithRedirect(auth, provider);
            return;
          }
          throw error;
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
        await firebaseSignOut(auth);
      },
    }),
    [loading, profile, profileLoading, user],
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
