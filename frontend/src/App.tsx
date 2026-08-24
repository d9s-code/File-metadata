import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { NavBar } from "./components/common/NavBar";
import { LoginPage } from "./pages/LoginPage";
import { EmittersListPage } from "./pages/EmittersListPage";
import { EmitterEditorPage } from "./pages/EmitterEditorPage";
import { EmitterVersionHistoryPage } from "./pages/EmitterVersionHistoryPage";

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
            <Route path="/" element={<Navigate to="/emitters" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
