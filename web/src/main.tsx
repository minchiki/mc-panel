import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "./App";
import { ConfirmProvider } from "./components/ui/confirm";
import { TooltipProvider } from "./components/ui/overlays";
import { AuthProvider } from "./hooks/auth";
import { ApiError } from "./lib/api";
import { I18nProvider } from "./lib/i18n";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <AuthProvider>
            <TooltipProvider delayDuration={250}>
              <ConfirmProvider>
                <App />
                <Toaster richColors closeButton position="top-right" theme="system" toastOptions={{ className: "font-sans" }} />
              </ConfirmProvider>
            </TooltipProvider>
          </AuthProvider>
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
