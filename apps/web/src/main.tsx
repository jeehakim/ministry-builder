import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router";
import { ClerkLoaded, ClerkLoading, ClerkProvider, SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";
import { dark } from "@clerk/themes";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { App } from "./App";
import { ApiBackendProvider, LocalBackendProvider } from "./backend-context";
import { Brand } from "./components/Brand";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MisconfiguredScreen } from "./components/MisconfiguredScreen";
import { CLERK_KEY, LOCAL_MODE, MISSING_CONFIG } from "./env";
import { isPublicPath } from "./lib/routes";
import { ClerkOrgProvider, OrgProvider } from "./orgs/OrgContext";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";

/** Everything needs a signed-in user except the pages `isPublicPath` names (an invitation link opens before sign-in). */
function AuthGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  if (isPublicPath(pathname)) return <>{children}</>;
  return (
    <>
      <SignedOut>
        <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-muted/30 p-6">
          <div className="text-center">
            <Brand className="justify-center" />
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              Free landing pages for non-profits and ministries. Sign in to start or continue a site.
            </p>
          </div>
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>{children}</SignedIn>
    </>
  );
}

function Providers({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  if (LOCAL_MODE) {
    return (
      <LocalBackendProvider>
        <OrgProvider enabled={false}>{children}</OrgProvider>
      </LocalBackendProvider>
    );
  }
  return (
    <ClerkProvider publishableKey={CLERK_KEY} afterSignOutUrl="/" appearance={{ baseTheme: resolvedTheme === "dark" ? dark : undefined }}>
      <ClerkLoading>
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-muted/30 p-6">
          <Brand className="justify-center" />
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Connecting to sign-in…
          </p>
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <ApiBackendProvider>
          <ClerkOrgProvider>
            <AuthGate>{children}</AuthGate>
          </ClerkOrgProvider>
        </ApiBackendProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element.");

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      {MISSING_CONFIG ? (
        <MisconfiguredScreen missing={MISSING_CONFIG} />
      ) : (
        <BrowserRouter>
          <ThemeProvider>
            <TooltipProvider delayDuration={300}>
              <Providers>
                <App />
              </Providers>
              <Toaster position="bottom-right" richColors />
            </TooltipProvider>
          </ThemeProvider>
        </BrowserRouter>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
