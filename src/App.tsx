import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import LoginPage from "./pages/Login";
import { api } from "@/utils/api";
import { getAccessToken } from "@/lib/cognito";
import { Loader2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const queryClient = new QueryClient();

// ── Root: dashboard when signed in, sign-in form otherwise (no /login redirect) ─

const RootRoute = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!user) return <LoginPage />;
  return <Index />;
};

// ── Critical banner ──────────────────────────────────────────────────────────

const CriticalBanner = () => {
  const [criticalCount, setCriticalCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Avoid calling protected endpoints before Cognito session restore completes.
    if (!getAccessToken()) return;
    api.get('/notifications/summary')
      .then((data: { critical_unread: number }) => {
        setCriticalCount(data.critical_unread ?? 0);
      })
      .catch(() => {});
  }, []);

  if (dismissed || criticalCount === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-red-700 text-white px-4 py-2 flex items-center justify-between shadow-lg">
      <span className="text-sm font-medium">
        ⚠ {criticalCount} certificate{criticalCount === 1 ? '' : 's'} require immediate attention
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-4 text-white/80 hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

// ── App ──────────────────────────────────────────────────────────────────────

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <CriticalBanner />
      <Toaster />
      <Sonner />
      <AuthProvider>
        {/* GitHub Pages doesn't support server-side SPA route rewrites.
            Hash routing keeps deep links working (e.g. /#/profile). */}
        <HashRouter>
          <Routes>
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/profile" element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } />
            <Route path="/" element={<RootRoute />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
