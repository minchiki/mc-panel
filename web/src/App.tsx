import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ChannelPrompt } from "./components/ChannelPrompt";
import { EmailPrompt } from "./components/EmailPrompt";
import { LogoLoader } from "./components/LogoLoader";
import { useAuth } from "./hooks/auth";
import { LoginPage, RegisterPage } from "./pages/Login";
import { ConfirmEmailPage, ForgotPage, ResetPasswordPage } from "./pages/Recovery";
import { ServersPage } from "./pages/Servers";

const CreateServerPage = lazy(() => import("./pages/CreateServer"));
const ServerLayout = lazy(() => import("./pages/server/ServerLayout"));
const ConsoleTab = lazy(() => import("./pages/server/ConsoleTab"));
const FilesTab = lazy(() => import("./pages/server/FilesTab"));
const AddonsTab = lazy(() => import("./pages/server/AddonsTab"));
const PlayersTab = lazy(() => import("./pages/server/PlayersTab"));
const SettingsTab = lazy(() => import("./pages/server/SettingsTab"));
const BackupsTab = lazy(() => import("./pages/server/BackupsTab"));
const SchedulesTab = lazy(() => import("./pages/server/SchedulesTab"));
const MonitoringTab = lazy(() => import("./pages/server/MonitoringTab"));
const DatabasesTab = lazy(() => import("./pages/server/DatabasesTab"));
const NetworkTab = lazy(() => import("./pages/server/NetworkTab"));
const AccessTab = lazy(() => import("./pages/server/AccessTab"));
const AccountPage = lazy(() => import("./pages/Account"));
const AdminOverview = lazy(() => import("./pages/admin/Overview"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminAudit = lazy(() => import("./pages/admin/Audit"));
const AdminLogs = lazy(() => import("./pages/admin/Logs"));
const AdminSettings = lazy(() => import("./pages/admin/Settings"));

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LogoLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<LogoLoader />}>
      <ChannelPrompt />
      <EmailPrompt />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot" element={<ForgotPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/confirm-email" element={<ConfirmEmailPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<ServersPage />} />
          <Route path="servers/new" element={<CreateServerPage />} />
          <Route path="servers/:id" element={<ServerLayout />}>
            <Route index element={<ConsoleTab />} />
            <Route path="files" element={<FilesTab />} />
            <Route path="addons" element={<AddonsTab />} />
            <Route path="players" element={<PlayersTab />} />
            <Route path="settings" element={<SettingsTab />} />
            <Route path="backups" element={<BackupsTab />} />
            <Route path="schedules" element={<SchedulesTab />} />
            <Route path="monitoring" element={<MonitoringTab />} />
            <Route path="databases" element={<DatabasesTab />} />
            <Route path="network" element={<NetworkTab />} />
            <Route path="access" element={<AccessTab />} />
          </Route>
          <Route path="account" element={<AccountPage />} />
          <Route
            path="admin"
            element={
              <RequireAuth admin>
                <AdminOverview />
              </RequireAuth>
            }
          />
          <Route path="admin/users" element={<RequireAuth admin><AdminUsers /></RequireAuth>} />
          <Route path="admin/audit" element={<RequireAuth admin><AdminAudit /></RequireAuth>} />
          <Route path="admin/logs" element={<RequireAuth admin><AdminLogs /></RequireAuth>} />
          <Route path="admin/settings" element={<RequireAuth admin><AdminSettings /></RequireAuth>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
