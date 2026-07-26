import { createContext, useContext } from "react";

export type Locale = "tr" | "en";

const messages = {
  tr: {
    brandTagline: "Gökyüzünden teslim noktasına, tek operasyon akışı.",
    brandDescription:
      "Pilotları canlı izleyin, en uygun retriever'ı atayın ve her görevi güvenle tamamlayın.",
    liveStatus: "Canlı operasyon",
    connected: "Bağlı",
    pilot: "Pilot",
    retriever: "Retriever",
    altitude: "İrtifa",
    eta: "Tahmini varış",
    signInTitle: "Tekrar hoş geldiniz",
    signInDescription: "Etkinlik operasyonunuza güvenle devam edin.",
    registerTitle: "RETFAST'a katılın",
    registerDescription: "Hesabınızı oluşturun, etkinliğinize başvurun.",
    forgotTitle: "Şifrenizi yenileyin",
    forgotDescription: "Sıfırlama bağlantısını e-posta adresinize gönderelim.",
    changePasswordTitle: "Şifrenizi değiştirin",
    changePasswordDescription: "Hesabınız için güçlü ve benzersiz bir şifre seçin.",
    email: "E-posta",
    password: "Şifre",
    currentPassword: "Mevcut şifre",
    newPassword: "Yeni şifre",
    confirmPassword: "Yeni şifre tekrar",
    fullName: "Ad soyad",
    forgotPassword: "Şifremi unuttum",
    signIn: "Giriş yap",
    createAccount: "Hesap oluştur",
    sendResetLink: "Bağlantıyı gönder",
    updatePassword: "Şifreyi güncelle",
    continueWithGoogle: "Google ile devam et",
    or: "veya",
    noAccount: "Henüz hesabınız yok mu?",
    haveAccount: "Zaten hesabınız var mı?",
    backToSignIn: "Girişe dön",
    passwordHint: "En az 8 karakter kullanın.",
    passwordMismatch: "Şifreler eşleşmiyor.",
    resetSent: "Şifre sıfırlama bağlantısı gönderildi. Gelen kutunuzu kontrol edin.",
    passwordChanged: "Şifreniz güncellendi.",
    dashboardGreeting: "Hoş geldiniz",
    dashboardDescription:
      "Kimlik doğrulama hazır. Etkinlik yönetimi bir sonraki geliştirme fazında burada açılacak.",
    foundationReady: "Operasyon altyapısı hazır",
    foundationText:
      "Güvenli oturum, iki dil ve tema tercihleri bu hesap için etkin.",
    changePassword: "Şifre değiştir",
    signOut: "Çıkış yap",
    light: "Açık",
    dark: "Koyu",
    authError: "İşlem tamamlanamadı. Bilgilerinizi kontrol edip tekrar deneyin.",
    invalidCredentials: "E-posta veya şifre hatalı.",
    emailInUse: "Bu e-posta adresiyle daha önce hesap oluşturulmuş.",
    weakPassword: "Şifreniz en az 8 karakter olmalı.",
    invalidEmail: "Geçerli bir e-posta adresi girin.",
    tooManyRequests: "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.",
    popupClosed: "Google oturumu tamamlanmadan pencere kapatıldı.",
  },
  en: {
    brandTagline: "One operational flow, from sky to drop-off.",
    brandDescription:
      "Track pilots live, assign the right retriever, and bring every mission safely home.",
    liveStatus: "Live operation",
    connected: "Connected",
    pilot: "Pilot",
    retriever: "Retriever",
    altitude: "Altitude",
    eta: "Estimated arrival",
    signInTitle: "Welcome back",
    signInDescription: "Continue securely to your event operation.",
    registerTitle: "Join RETFAST",
    registerDescription: "Create your account and apply to your event.",
    forgotTitle: "Reset your password",
    forgotDescription: "We'll send a reset link to your email address.",
    changePasswordTitle: "Change your password",
    changePasswordDescription: "Choose a strong, unique password for your account.",
    email: "Email",
    password: "Password",
    currentPassword: "Current password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    fullName: "Full name",
    forgotPassword: "Forgot password",
    signIn: "Sign in",
    createAccount: "Create account",
    sendResetLink: "Send reset link",
    updatePassword: "Update password",
    continueWithGoogle: "Continue with Google",
    or: "or",
    noAccount: "Don't have an account?",
    haveAccount: "Already have an account?",
    backToSignIn: "Back to sign in",
    passwordHint: "Use at least 8 characters.",
    passwordMismatch: "Passwords do not match.",
    resetSent: "Password reset link sent. Check your inbox.",
    passwordChanged: "Your password has been updated.",
    dashboardGreeting: "Welcome",
    dashboardDescription:
      "Authentication is ready. Event management will open here in the next development phase.",
    foundationReady: "Operations foundation ready",
    foundationText:
      "Secure sign-in, two languages, and theme preferences are active for this account.",
    changePassword: "Change password",
    signOut: "Sign out",
    light: "Light",
    dark: "Dark",
    authError: "We couldn't complete that action. Check your details and try again.",
    invalidCredentials: "The email or password is incorrect.",
    emailInUse: "An account already exists for this email address.",
    weakPassword: "Your password must be at least 8 characters.",
    invalidEmail: "Enter a valid email address.",
    tooManyRequests: "Too many attempts. Please try again later.",
    popupClosed: "The Google sign-in window closed before completing.",
  },
} as const;

export type Copy = (typeof messages)[Locale];

export const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  copy: Copy;
} | null>(null);

export function getMessages(locale: Locale): Copy {
  return messages[locale];
}

export function useLocale() {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error("useLocale must be used inside PreferencesProvider");
  }

  return context;
}
