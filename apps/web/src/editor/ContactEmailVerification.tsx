import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MailCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { ContactEmailStatus } from "../api";
import type { ContactEmailBackend } from "../backend";
import { Button } from "@/components/ui/button";
import { useSiteId } from "./EditorContext";

// Something@something.tld; the server validates properly, this only decides whether to ask it.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOKUP_DEBOUNCE_MS = 500;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; status: ContactEmailStatus };

/**
 * Shown under the contact section's fields: whether the address the hosted form delivers to has
 * confirmed it wants the messages, with a button to send (or re-send) the verification email.
 * Messages are stored in the inbox either way; only the email delivery waits for verification.
 */
export function ContactEmailVerification(props: { contactEmail: ContactEmailBackend; email: string; customEndpoint: boolean }) {
  const { contactEmail, email, customEndpoint } = props;
  const siteId = useSiteId();
  const address = email.trim().toLowerCase();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (customEndpoint || !LOOKS_LIKE_EMAIL.test(address)) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    const timer = setTimeout(async () => {
      try {
        const status = await contactEmail.status(siteId, address);
        if (!cancelled) setState({ kind: "ready", status });
      } catch (err) {
        if (!cancelled) setState({ kind: "error", message: errorText(err) });
      }
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [contactEmail, siteId, address, customEndpoint]);

  async function send() {
    setSending(true);
    try {
      const status = await contactEmail.verify(siteId, address);
      setState({ kind: "ready", status });
      if (status.verified) toast.success(`${status.email} is verified`);
      else toast.success(`Verification email sent to ${status.email}`, { description: "Open the link in it, then check again here." });
    } catch (err) {
      toast.error("Could not send the verification email", { description: errorText(err) });
    } finally {
      setSending(false);
    }
  }

  async function check() {
    setState({ kind: "loading" });
    try {
      const status = await contactEmail.status(siteId, address);
      setState({ kind: "ready", status });
      if (status.verified) toast.success(`${status.email} is verified`);
      else toast.info("Not verified yet", { description: "Open the link in the verification email, then check again." });
    } catch (err) {
      setState({ kind: "error", message: errorText(err) });
    }
  }

  if (state.kind === "idle") return null;

  return (
    <div className="mt-3 rounded-lg border bg-muted/30 p-2.5 text-xs" aria-live="polite">
      {state.kind === "loading" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Checking whether {address} is verified…
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="text-destructive" role="alert">
          Could not check the address: {state.message}
        </p>
      ) : null}
      {state.kind === "ready" && !state.status.enabled ? (
        <p className="text-muted-foreground">Email delivery is off on this server. Messages are kept in your inbox instead.</p>
      ) : null}
      {state.kind === "ready" && state.status.enabled && state.status.verified ? (
        <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          <span>
            <span className="font-medium">Verified.</span> Messages are emailed to {state.status.email}.
          </span>
        </p>
      ) : null}
      {state.kind === "ready" && state.status.enabled && !state.status.verified ? (
        <div className="space-y-2">
          <p>
            <span className="font-medium">Not verified.</span>{" "}
            {state.status.sentAt
              ? `A verification email was sent to ${state.status.email}. Open the link in it; until then messages stay in your inbox and are not emailed.`
              : `Messages are kept in your inbox but are not emailed until ${state.status.email} confirms it wants them.`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="outline" size="xs" disabled={sending} onClick={() => void send()}>
              {sending ? <Loader2 className="animate-spin" /> : <MailCheck />}
              {state.status.sentAt ? "Resend verification email" : "Send verification email"}
            </Button>
            {state.status.sentAt ? (
              <Button type="button" variant="ghost" size="xs" disabled={sending} onClick={() => void check()}>
                <RefreshCw />
                Check again
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
