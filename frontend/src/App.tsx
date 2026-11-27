import { NearMissLimitSync } from "./components/intercepts/NearMissLimitSync";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth, RequireAdmin } from "./auth/RequireAuth";
import { STANDALONE } from "./api/offline";
import { ThemeProvider } from "./theme/ThemeContext";
import { AutoRefresh } from "./state/AutoRefresh";
import { NavBar } from "./components/common/NavBar";
import { ChatWidget } from "./components/ai/ChatWidget";
import { BackupWarning } from "./components/common/BackupWarning";
import { LoginPage } from "./pages/LoginPage";
import { CheckoutReminder } from "./components/common/CheckoutReminder";
import { NotFoundPage } from "./pages/NotFoundPage";
import { lazyPage, preloadPages } from "./lazyPage";
import { LoadingState } from "./components/common/LoadingState";
import { Suspense, useEffect } from "react";

// Each page's code is fetched when it's first opened (then the rest in the background).
const OfflineSyncPage = lazyPage(() => import("./pages/OfflineSyncPage"), "OfflineSyncPage");
const EmittersListPage = lazyPage(() => import("./pages/EmittersListPage"), "EmittersListPage");
const EmitterEditorPage = lazyPage(() => import("./pages/EmitterEditorPage"), "EmitterEditorPage");
const EmitterVersionHistoryPage = lazyPage(() => import("./pages/EmitterVersionHistoryPage"), "EmitterVersionHistoryPage");
const TestRunNewPage = lazyPage(() => import("./pages/TestRunNewPage"), "TestRunNewPage");
const EmitterComparePage = lazyPage(() => import("./pages/EmitterComparePage"), "EmitterComparePage");
const PlatformTestRunPage = lazyPage(() => import("./pages/PlatformTestRunPage"), "PlatformTestRunPage");
const PlatformTestDetailPage = lazyPage(() => import("./pages/PlatformTestDetailPage"), "PlatformTestDetailPage");
const TestRunDetailPage = lazyPage(() => import("./pages/TestRunDetailPage"), "TestRunDetailPage");
const InterceptImportPage = lazyPage(() => import("./pages/InterceptImportPage"), "InterceptImportPage");
const AdminCheckoutsPage = lazyPage(() => import("./pages/AdminCheckoutsPage"), "AdminCheckoutsPage");
const AdminBackupsPage = lazyPage(() => import("./pages/AdminBackupsPage"), "AdminBackupsPage");
const PlatformsListPage = lazyPage(() => import("./pages/PlatformsListPage"), "PlatformsListPage");
const PlatformBuilderPage = lazyPage(() => import("./pages/PlatformBuilderPage"), "PlatformBuilderPage");
const PlatformVersionHistoryPage = lazyPage(() => import("./pages/PlatformVersionHistoryPage"), "PlatformVersionHistoryPage");
const MdfsListPage = lazyPage(() => import("./pages/MdfsListPage"), "MdfsListPage");
const MdfBuilderPage = lazyPage(() => import("./pages/MdfBuilderPage"), "MdfBuilderPage");
const MdfVersionHistoryPage = lazyPage(() => import("./pages/MdfVersionHistoryPage"), "MdfVersionHistoryPage");
const MdfComparePage = lazyPage(() => import("./pages/MdfComparePage"), "MdfComparePage");
const PlatformConfidencePage = lazyPage(() => import("./pages/PlatformConfidencePage"), "PlatformConfidencePage");
const DashboardPage = lazyPage(() => import("./pages/DashboardPage"), "DashboardPage");
const SourceGroupsPage = lazyPage(() => import("./pages/SourceGroupsPage"), "SourceGroupsPage");
const CustomersPage = lazyPage(() => import("./pages/CustomersPage"), "CustomersPage");
const DwellsListPage = lazyPage(() => import("./pages/DwellsListPage"), "DwellsListPage");
const DwellFilePage = lazyPage(() => import("./pages/DwellFilePage"), "DwellFilePage");
const DwellStrategyPage = lazyPage(() => import("./pages/DwellStrategyPage"), "DwellStrategyPage");
const DwellVersionHistoryPage = lazyPage(() => import("./pages/DwellVersionHistoryPage"), "DwellVersionHistoryPage");
const AdminSettingsPage = lazyPage(() => import("./pages/AdminSettingsPage"), "AdminSettingsPage");
const AdminDefaultsPage = lazyPage(() => import("./pages/AdminDefaultsPage"), "AdminDefaultsPage");
const AdminFunctionCodesPage = lazyPage(() => import("./pages/AdminFunctionCodesPage"), "AdminFunctionCodesPage");
const AdminStatusesPage = lazyPage(() => import("./pages/AdminStatusesPage"), "AdminStatusesPage");
const InterceptsPage = lazyPage(() => import("./pages/InterceptsPage"), "InterceptsPage");
const RecordingPage = lazyPage(() => import("./pages/RecordingPage"), "RecordingPage");
const ReportsPage = lazyPage(() => import("./pages/ReportsPage"), "ReportsPage");
const InterceptDetailPage = lazyPage(() => import("./pages/InterceptDetailPage"), "InterceptDetailPage");
const InterceptModePlanPage = lazyPage(() => import("./pages/InterceptModePlanPage"), "InterceptModePlanPage");
const InterceptRegroupPage = lazyPage(() => import("./pages/InterceptRegroupPage"), "InterceptRegroupPage");
const AmbiguityDashboardPage = lazyPage(() => import("./pages/AmbiguityDashboardPage"), "AmbiguityDashboardPage");
const ThreatPrioritiesPage = lazyPage(() => import("./pages/ThreatPrioritiesPage"), "ThreatPrioritiesPage");
const AuditLogPage = lazyPage(() => import("./pages/AuditLogPage"), "AuditLogPage");
const HelpPage = lazyPage(() => import("./pages/HelpPage"), "HelpPage");
const TasksPage = lazyPage(() => import("./pages/TasksPage"), "TasksPage");
const AdminUsersPage = lazyPage(() => import("./pages/AdminUsersPage"), "AdminUsersPage");
const AdminTrashPage = lazyPage(() => import("./pages/AdminTrashPage"), "AdminTrashPage");

const queryClient = new QueryClient({
  // Fetched data counts as fresh for half a minute, and is kept for half an
  // hour after its page is left: going back to a page shows it at once, with
  // no request. Any change made here refreshes what it touches at once
  // (AutoRefresh), so this only delays what others change, by up to 30 s.
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000, gcTime: 30 * 60_000 } },
  // Every mutation in the app is a candidate for a new audit-log entry. A
  // single global hook here marks the audit log stale after any mutation —
  // refetched at once where it's on screen, and when shown again where it's
  // in a hidden tab (EmitterEditorPage's <Activity> tabs) — instead of every
  // mutation hook remembering to invalidate it individually.
  mutationCache: new MutationCache({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auditLog"] });
    },
  }),
});

export default function App() {
  // Once the first page is up: the other pages' code, in the background.
  useEffect(() => preloadPages(), []);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AutoRefresh />
        <BrowserRouter>
          <AuthProvider>
            <NavBar />
            <BackupWarning />
            <CheckoutReminder />
            <NearMissLimitSync />
            <Suspense fallback={<LoadingState />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              {STANDALONE && (
                <Route
                  path="/admin/sync"
                  element={
                    <RequireAdmin>
                      <OfflineSyncPage />
                    </RequireAdmin>
                  }
                />
              )}
              <Route
                path="/emitters"
                element={
                  <RequireAuth>
                    <EmittersListPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/emitters/compare"
                element={
                  <RequireAuth>
                    <EmitterComparePage />
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
                path="/emitters/:emitterId/tests/new"
                element={
                  <RequireAuth>
                    <TestRunNewPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/emitters/:emitterId/tests/:testRecordId"
                element={
                  <RequireAuth>
                    <TestRunDetailPage />
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
                path="/platforms/:platformId/tests/new"
                element={
                  <RequireAuth>
                    <PlatformTestRunPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/platforms/:platformId/tests/:testId"
                element={
                  <RequireAuth>
                    <PlatformTestDetailPage />
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
                path="/platform-confidence"
                element={
                  <RequireAuth>
                    <PlatformConfidencePage />
                  </RequireAuth>
                }
              />
              <Route
                path="/mdfs/compare"
                element={
                  <RequireAuth>
                    <MdfComparePage />
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
              <Route path="/threat-priorities" element={<Navigate to="/priorities" replace />} />
              <Route
                path="/priorities"
                element={
                  <RequireAuth>
                    <ThreatPrioritiesPage />
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
                path="/dwells"
                element={
                  <RequireAuth>
                    <DwellsListPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/dwells/strategies/:strategyId"
                element={
                  <RequireAuth>
                    <DwellStrategyPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/dwells/strategies/:id/versions"
                element={
                  <RequireAuth>
                    <DwellVersionHistoryPage kind="strategies" />
                  </RequireAuth>
                }
              />
              <Route
                path="/dwells/files/:fileId"
                element={
                  <RequireAuth>
                    <DwellFilePage />
                  </RequireAuth>
                }
              />
              <Route
                path="/dwells/files/:id/versions"
                element={
                  <RequireAuth>
                    <DwellVersionHistoryPage kind="files" />
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
                path="/reports"
                element={
                  <RequireAuth>
                    <ReportsPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/intercepts"
                element={
                  <RequireAuth>
                    <InterceptsPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/recordings/:recordingId"
                element={
                  <RequireAuth>
                    <RecordingPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/intercepts/import"
                element={
                  <RequireAuth>
                    <InterceptImportPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/intercepts/:interceptId/modes"
                element={
                  <RequireAuth>
                    <InterceptModePlanPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/intercepts/:interceptId/regroup"
                element={
                  <RequireAuth>
                    <InterceptRegroupPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/intercepts/:interceptId"
                element={
                  <RequireAuth>
                    <InterceptDetailPage />
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
                path="/tasks"
                element={
                  <RequireAuth>
                    <TasksPage />
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
                path="/admin/checkouts"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminCheckoutsPage />
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
              <Route
                path="/admin/backups"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminBackupsPage />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/statuses"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminStatusesPage />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/function-codes"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminFunctionCodesPage />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/defaults"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminDefaultsPage />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/settings"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminSettingsPage />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
              <Route
                path="*"
                element={
                  <RequireAuth>
                    <NotFoundPage />
                  </RequireAuth>
                }
              />
            </Routes>
            </Suspense>
            <ChatWidget />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
