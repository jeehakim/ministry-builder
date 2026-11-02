import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ClerkLoaded, ClerkLoading, ClerkProvider, SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";
import { dark } from "@clerk/themes";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { App } from "./App";
import { ApiBackendProvider, LocalBackendProvider } from "./backend-context";
import { Brand } from "./components/Brand";
import { CLERK_KEY, LOCAL_MODE } from "./env";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";

function Providers({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  if (LOCAL_MODE) return <LocalBackendProvider>{children}</LocalBackendProvider>;
  return (
    <ClerkProvider publishableKey={CLERK_KEY} appearance={{ baseTheme: resolvedTheme === "dark" ? dark : undefined }}>
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
      <SignedIn>
        <ApiBackendProvider>{children}</ApiBackendProvider>
      </SignedIn>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element.");

createRoot(rootEl).render(
  <StrictMode>
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
  </StrictMode>,
);
