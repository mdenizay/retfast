import { Navigate, Outlet, ScrollRestoration, type RouteObject } from "react-router";
import { isAppHost } from "@/lib/config";
import { ForcePasswordChange, FullScreenLoading, RequireAuth, RequireEventAccess, RequireRole } from "@/layouts/guards";
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
            // Full-screen operations room (organizers, observers, admins; pilots get their own map view).
            { path: "events/:id/live", lazy: lazyPage(() => import("@/pages/app/event/Live")) },
            {
              element: <AppLayout />,
              children: [
                { index: true, lazy: lazyPage(() => import("@/pages/app/Home")) },
                { path: "events", lazy: lazyPage(() => import("@/pages/app/Events")) },
                {
                  path: "events/new",
                  element: <RequireRole roles={["platform_admin"]} />,
                  children: [{ index: true, lazy: lazyPage(() => import("@/pages/app/EventNew")) }],
                },
                {
                  path: "events/:id",
                  lazy: lazyPage(() => import("@/pages/app/event/EventLayout")),
                  children: [
                    { index: true, lazy: lazyPage(() => import("@/pages/app/event/Overview")) },
                    {
                      element: <RequireEventAccess need="manage" />,
                      children: [
                        { path: "applications", element: <Navigate to="../members" replace /> },
                        { path: "members", lazy: lazyPage(() => import("@/pages/app/event/Members")) },
                        { path: "settings", lazy: lazyPage(() => import("@/pages/app/event/Settings")) },
                        { path: "report", lazy: lazyPage(() => import("@/pages/app/event/Report")) },
                      ],
                    },
                    {
                      element: <RequireEventAccess need="retriever" />,
                      children: [{ path: "retrievals", lazy: lazyPage(() => import("@/pages/app/event/MyRetrievals")) }],
                    },
                  ],
                },
                { path: "retrievals", lazy: lazyPage(() => import("@/pages/app/Retrievals")) },
                { path: "flights", lazy: lazyPage(() => import("@/pages/app/Flights")) },
                { path: "flights/:id", lazy: lazyPage(() => import("@/pages/app/FlightDetail")) },
                { path: "settings", lazy: lazyPage(() => import("@/pages/app/Settings")) },
                {
                  path: "admin",
                  element: <RequireRole roles={["platform_admin"]} />,
                  children: [
                    { index: true, lazy: lazyPage(() => import("@/pages/app/admin/System")) },
                    { path: "events", lazy: lazyPage(() => import("@/pages/app/admin/Events")) },
                    { path: "users", lazy: lazyPage(() => import("@/pages/app/admin/Users")) },
                    { path: "audit", lazy: lazyPage(() => import("@/pages/app/admin/Audit")) },
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
