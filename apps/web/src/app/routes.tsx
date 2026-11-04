import { Navigate, Outlet, ScrollRestoration, type RouteObject } from "react-router";
import { isAppHost } from "@/lib/config";
import { ForcePasswordChange, FullScreenLoading, RequireAuth, RequireRole } from "@/layouts/guards";
import { PublicLayout } from "@/layouts/PublicLayout";
import { AppLayout } from "@/layouts/AppLayout";
import { NotFoundPage, RouteErrorPage } from "@/pages/NotFound";
import LandingPage from "@/pages/public/Landing";
import LoginPage from "@/pages/auth/Login";
import ChangePasswordPage from "@/pages/auth/ChangePassword";

type Mod = { default: React.ComponentType };
const lazyPage = (load: () => Promise<Mod>) => async () => ({ Component: (await load()).default });

function RootLayout() {
  return (
    <ForcePasswordChange>
      <ScrollRestoration />
      <Outlet />
    </ForcePasswordChange>
  );
}

/** retfast.com/ → landing; app.retfast.com/ → /app */
function HostIndex() {
  if (isAppHost()) return <Navigate to="/app" replace />;
  return <LandingPage />;
}

export function createRoutes(): RouteObject[] {
  return [
    {
      element: <RootLayout />,
      errorElement: <RouteErrorPage />,
      hydrateFallbackElement: <FullScreenLoading />,
      children: [
        {
          element: <PublicLayout />,
          children: [
            { index: true, element: <HostIndex /> },
            { path: "events", lazy: lazyPage(() => import("@/pages/public/Events")) },
            { path: "events/:slug", lazy: lazyPage(() => import("@/pages/public/EventDetail")) },
            { path: "pilots/:publicId", lazy: lazyPage(() => import("@/pages/public/PilotProfile")) },
            { path: "flights/:publicId", lazy: lazyPage(() => import("@/pages/public/PublicFlight")) },
            { path: "privacy", lazy: lazyPage(() => import("@/pages/public/Privacy")) },
            { path: "login", element: <LoginPage /> },
            { path: "register", lazy: lazyPage(() => import("@/pages/auth/Register")) },
            { path: "forgot-password", lazy: lazyPage(() => import("@/pages/auth/Forgot")) },
            { path: "reset-password", lazy: lazyPage(() => import("@/pages/auth/Reset")) },
            { path: "verify-email", lazy: lazyPage(() => import("@/pages/auth/Verify")) },
            { path: "change-password", element: <ChangePasswordPage /> },
            { path: "*", element: <NotFoundPage /> },
          ],
        },
        { path: "events/:slug/live", lazy: lazyPage(() => import("@/pages/public/PublicLive")) },
        {
          path: "app",
          element: <RequireAuth />,
          children: [
            { path: "events/:id/live", lazy: lazyPage(() => import("@/pages/app/AppLive")) },
            {
              element: <AppLayout />,
              children: [
                { index: true, lazy: lazyPage(() => import("@/pages/app/Dashboard")) },
                { path: "events", lazy: lazyPage(() => import("@/pages/app/Events")) },
                {
                  path: "events/new",
                  element: <RequireRole roles={["event_organizer", "platform_admin"]} />,
                  children: [{ index: true, lazy: lazyPage(() => import("@/pages/app/EventNew")) }],
                },
                { path: "events/:id", lazy: lazyPage(() => import("@/pages/app/EventEdit")) },
                { path: "events/:id/participants", lazy: lazyPage(() => import("@/pages/app/Participants")) },
                {
                  element: <RequireRole roles={["event_organizer", "platform_admin"]} />,
                  children: [
                    { path: "pilots", lazy: lazyPage(() => import("@/pages/app/Pilots")) },
                    { path: "reports", lazy: lazyPage(() => import("@/pages/app/Reports")) },
                  ],
                },
                { path: "flights", lazy: lazyPage(() => import("@/pages/app/Flights")) },
                { path: "flights/:id", lazy: lazyPage(() => import("@/pages/app/FlightDetail")) },
                { path: "incidents", lazy: lazyPage(() => import("@/pages/app/Incidents")) },
                { path: "incidents/:id", lazy: lazyPage(() => import("@/pages/app/IncidentDetail")) },
                {
                  element: <RequireRole roles={["rescue_operator", "platform_admin"]} />,
                  children: [{ path: "rescue", lazy: lazyPage(() => import("@/pages/app/Rescue")) }],
                },
                { path: "settings", lazy: lazyPage(() => import("@/pages/app/Settings")) },
                {
                  path: "admin",
                  element: <RequireRole roles={["platform_admin"]} />,
                  children: [
                    { index: true, element: <Navigate to="users" replace /> },
                    { path: "users", lazy: lazyPage(() => import("@/pages/app/AdminUsers")) },
                    { path: "audit", lazy: lazyPage(() => import("@/pages/app/AdminAudit")) },
                  ],
                },
                { path: "*", element: <NotFoundPage /> },
              ],
            },
          ],
        },
      ],
    },
  ];
}
