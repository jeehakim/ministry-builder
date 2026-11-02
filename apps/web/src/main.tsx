import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ClerkProvider, SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import { App } from "./App";
import { ApiBackendProvider, LocalBackendProvider } from "./backend-context";
import { CLERK_KEY, LOCAL_MODE } from "./env";
import "./index.css";

function Providers({ children }: { children: ReactNode }) {
  if (LOCAL_MODE) return <LocalBackendProvider>{children}</LocalBackendProvider>;
  return (
    <ClerkProvider publishableKey={CLERK_KEY}>
      <SignedOut>
        <div className="flex min-h-screen items-center justify-center">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <ApiBackendProvider>{children}</ApiBackendProvider>
      </SignedIn>
    </ClerkProvider>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element.");

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <Providers>
        <App />
      </Providers>
    </BrowserRouter>
  </StrictMode>,
);
