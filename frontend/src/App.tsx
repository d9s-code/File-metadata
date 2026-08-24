import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
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
import { AmbiguityDashboardPage } from "./pages/AmbiguityDashboardPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
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
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
