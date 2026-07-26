import { Navigate, Route, Routes } from "react-router-dom";

import { AuthLayout } from "./components/AuthLayout";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./contexts/AuthContext";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { CreateEventPage } from "./pages/CreateEventPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EventDetailsPage } from "./pages/EventDetailsPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import "./App.css";

function PublicAuthRoute({ children }: { children: React.ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}

function SuperadminRoute({ children }: { children: React.ReactNode }) {
  const { profile, profileLoading } = useAuth();
  if (profileLoading) return <div className="app-loader"><span /></div>;
  return profile?.globalRole === "superadmin" ? children : <Navigate to="/app" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicAuthRoute><LoginPage /></PublicAuthRoute>} />
      <Route path="/register" element={<PublicAuthRoute><RegisterPage /></PublicAuthRoute>} />
      <Route path="/forgot-password" element={<PublicAuthRoute><ForgotPasswordPage /></PublicAuthRoute>} />
      <Route path="/change-password" element={<ProtectedRoute><AuthLayout><ChangePasswordPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/app" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="events/new" element={<SuperadminRoute><CreateEventPage /></SuperadminRoute>} />
        <Route path="events/:eventId" element={<EventDetailsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
