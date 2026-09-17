import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth, RequireAdmin } from "./auth/RequireAuth";
import { ThemeProvider } from "./theme/ThemeContext";
import { NavBar } from "./components/common/NavBar";
import { LoginPage } from "./pages/LoginPage";
import { EmittersListPage } from "./pages/EmittersListPage";
import { EmitterEditorPage } from "./pages/EmitterEditorPage";
import { EmitterVersionHistoryPage } from "./pages/EmitterVersionHistoryPage";
import { PlatformsListPage } from "./pages/PlatformsListPage";
import { PlatformBuilderPage } from "./pages/PlatformBuilderPage";
import { PlatformVersionHistoryPage } from "./pages/PlatformVersionHistoryPage";
import { MdfsListPage } from "./pages/MdfsListPage";
import { MdfBuilderPage } from "./pages/MdfBuilderPage";
import { MdfVersionHistoryPage } from "./pages/MdfVersionHistoryPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SourceGroupsPage } from "./pages/SourceGroupsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { AmbiguityDashboardPage } from "./pages/AmbiguityDashboardPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { HelpPage } from "./pages/HelpPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminTrashPage } from "./pages/AdminTrashPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  // Every mutation in the app is a candidate for a new audit-log entry, and
  // the Audit tab stays mounted across tab switches (see EmitterEditorPage's
  // `hidden`-attribute tabs) rather than remounting, so it won't naturally
  // refetch on its own. A single global hook here keeps it current after any
  // mutation, instead of every mutation hook remembering to invalidate it
  // individually — easy to forget (and to silently drop, e.g. via a batch
  // edit, since audit entries are the one thing every mutation writes).
  mutationCache: new MutationCache({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auditLog"] });
    },
  }),
});

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <NavBar />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/emitters"
                element={
                  <RequireAuth>
                    <EmittersListPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/emitters/:emitterId"
                element={
                  <RequireAuth>
                    <EmitterEditorPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/emitters/:emitterId/versions"
                element={
                  <RequireAuth>
                    <EmitterVersionHistoryPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/platforms"
                element={
                  <RequireAuth>
                    <PlatformsListPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/platforms/:platformId"
                element={
                  <RequireAuth>
                    <PlatformBuilderPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/platforms/:platformId/versions"
                element={
                  <RequireAuth>
                    <PlatformVersionHistoryPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/mdfs"
                element={
                  <RequireAuth>
                    <MdfsListPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/mdfs/:mdfId"
                element={
                  <RequireAuth>
                    <MdfBuilderPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/mdfs/:mdfId/versions"
                element={
                  <RequireAuth>
                    <MdfVersionHistoryPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/source-groups"
                element={
                  <RequireAuth>
                    <SourceGroupsPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/customers"
                element={
                  <RequireAuth>
                    <CustomersPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <DashboardPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/ambiguity/:scopeType/:scopeId"
                element={
                  <RequireAuth>
                    <AmbiguityDashboardPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/audit-log"
                element={
                  <RequireAuth>
                    <AuditLogPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/help"
                element={
                  <RequireAuth>
                    <HelpPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminUsersPage />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/trash"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminTrashPage />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
