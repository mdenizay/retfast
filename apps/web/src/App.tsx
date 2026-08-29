import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { I18nProvider, useI18n } from "@/i18n";
import Layout from "@/components/Layout";
import LoginPage from "@/pages/LoginPage";
import EventsPage from "@/pages/EventsPage";
import EventPage from "@/pages/event/EventPage";
import OpsConsole from "@/pages/event/OpsConsole";
import ReplayPage from "@/pages/ReplayPage";
import ProfilePage from "@/pages/ProfilePage";
import UsersPage from "@/pages/UsersPage";

function RequireAuth() {
  const { session, loading } = useAuth();
  const { m } = useI18n();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {m.common.loading}
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              {/* Full-bleed ops console lives outside the padded Layout chrome. */}
              <Route path="/events/:id/ops" element={<OpsConsole />} />
              <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/events" replace />} />
                <Route path="/events" element={<EventsPage />} />
                <Route path="/events/:id" element={<EventPage />} />
                <Route path="/replay/:taskId" element={<ReplayPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/users" element={<UsersPage />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="top-center" />
      </AuthProvider>
    </I18nProvider>
  );
}
