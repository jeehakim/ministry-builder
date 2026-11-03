import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { SendTestEmailRequest, SetResendFromRequest, SetResendKeyRequest, type IntegrationsResponse } from "@ministry/schema";
import { CircleCheck, Eye, EyeOff, Info, Loader2, Send, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { IntegrationsBackend } from "../backend";
import { useBackend } from "../backend-context";
import { ApiUnreachableBanner } from "../components/ApiUnreachableBanner";
import { isNetworkError } from "../lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  checkFromAddress,
  checkFromName,
  defaultTestRecipient,
  formatKeyHint,
  integrationErrorMessage,
  RESEND_DOMAINS_URL,
  senderStatus,
  testSentText,
} from "./emailDelivery";

type Load = { kind: "loading" } | { kind: "error"; message: string; network: boolean } | { kind: "ready"; data: IntegrationsResponse };

/** The "bring your own Resend" panel: who delivers contact form email, plus connect, from address, test and disconnect. */
export function EmailDeliveryPanel({ orgId, contactEmail, canManage = true }: { orgId: string; contactEmail: string | null; canManage?: boolean }) {
  const { integrations } = useBackend();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  // Bumped by the banner's retry button to load again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!integrations) return;
    let cancelled = false;
    setLoad({ kind: "loading" });
    integrations
      .get(orgId)
      .then((data) => !cancelled && setLoad({ kind: "ready", data }))
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: integrationErrorMessage(err), network: isNetworkError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [integrations, orgId, attempt]);

  if (!integrations) return <InfoBox>Email delivery settings need a Ministry Sites account.</InfoBox>;
  if (load.kind === "loading") return <Skeleton className="h-40 rounded-xl" />;
  if (load.kind === "error") {
    return load.network ? (
      <ApiUnreachableBanner onRetry={() => setAttempt((n) => n + 1)} />
    ) : (
      <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {load.message}
      </p>
    );
  }

  const { data } = load;
  const setData = (next: IntegrationsResponse) => setLoad({ kind: "ready", data: next });

  return (
    <div className="space-y-5">
      <StatusCard sender={data.activeSender} />
      {!canManage ? (
        <InfoBox>Only admins and owners can change how email is delivered.</InfoBox>
      ) : data.encryptionAvailable ? (
        <>
          <ConnectCard orgId={orgId} integrations={integrations} data={data} onData={setData} />
          {data.resend ? <FromCard orgId={orgId} integrations={integrations} resend={data.resend} onData={setData} /> : null}
          {data.resend?.fromAddress ? <TestCard orgId={orgId} integrations={integrations} resend={data.resend} contactEmail={contactEmail} onData={setData} /> : null}
          {data.resend ? <DisconnectCard orgId={orgId} integrations={integrations} data={data} onData={setData} /> : null}
        </>
      ) : (
        <InfoBox title="Bring-your-own email is not enabled on this server">
          Ask whoever runs this server to turn it on. Until then, delivery stays as shown above.
        </InfoBox>
      )}
    </div>
  );
}

function InfoBox({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div role="note" className="flex items-start gap-3 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function InlineError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function StatusCard({ sender }: { sender: IntegrationsResponse["activeSender"] }) {
  const { title, detail } = senderStatus(sender);
  return (
    <Card>
      <CardHeader>
        <CardDescription>Messages from your contact form are delivered by:</CardDescription>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className={sender === "none" ? "size-2 rounded-full bg-muted-foreground/50" : "size-2 rounded-full bg-emerald-500"} aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

interface CardProps {
  orgId: string;
  integrations: IntegrationsBackend;
  onData: (next: IntegrationsResponse) => void;
}

function ConnectCard({ orgId, integrations, data, onData }: CardProps & { data: IntegrationsResponse }) {
  const keyId = useId();
  // The key lives only in this state, and only until the moment it is submitted.
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resend = data.resend;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = SetResendKeyRequest.safeParse({ apiKey });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "That does not look like a Resend API key");
      return;
    }
    setApiKey("");
    setReveal(false);
    setError(null);
    setBusy(true);
    try {
      onData(await integrations.setResendKey(orgId, parsed.data));
    } catch (err) {
      setError(integrationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{resend ? "Your Resend account" : "Connect your Resend account"}</CardTitle>
        <CardDescription>
          Send your contact form messages from your own domain.{" "}
          <Link className="text-brand underline" to="/guide/email">
            Step-by-step guide
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {resend ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CircleCheck className="size-4 text-emerald-600" aria-hidden="true" />
              {formatKeyHint(resend.keyHint)}
            </p>
            {resend.verifiedDomains.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Verified domains:</span>
                {resend.verifiedDomains.map((d) => (
                  <Badge key={d} variant="secondary" className="font-mono font-normal">
                    {d}
                  </Badge>
                ))}
              </div>
            ) : (
              <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                <p className="font-medium">Verify a domain in Resend first</p>
                <p>
                  Add and verify a domain at{" "}
                  <a className="underline" href={RESEND_DOMAINS_URL} target="_blank" rel="noreferrer">
                    resend.com/domains
                  </a>
                  , then paste your key again to refresh this list.
                </p>
              </div>
            )}
          </div>
        ) : null}

        <form onSubmit={(e) => void submit(e)} className="space-y-1.5" autoComplete="off">
          <Label htmlFor={keyId}>{resend ? "Replace API key" : "Resend API key"}</Label>
          <div className="flex items-center gap-2">
            <Input
              id={keyId}
              name="resend-api-key"
              type={reveal ? "text" : "password"}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              className="font-mono"
              placeholder="re_…"
              value={apiKey}
              disabled={busy}
              aria-invalid={error !== null || undefined}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={reveal ? "Hide API key" : "Show API key"}
              aria-pressed={reveal}
              onClick={() => setReveal((v) => !v)}
            >
              {reveal ? <EyeOff /> : <Eye />}
            </Button>
            <Button type="submit" disabled={busy || apiKey.trim() === ""}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Checking…" : resend ? "Replace key" : "Connect"}
            </Button>
          </div>
          <InlineError message={error} />
        </form>

        <p className="text-xs text-muted-foreground">
          Your key is encrypted on our server and never shown again. We only use it to send your form messages, and you can revoke it any time in Resend.
        </p>
      </CardContent>
    </Card>
  );
}

function FromCard({ orgId, integrations, resend, onData }: CardProps & { resend: NonNullable<IntegrationsResponse["resend"]> }) {
  const addressId = useId();
  const nameId = useId();
  const [address, setAddress] = useState(resend.fromAddress ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const noDomains = resend.verifiedDomains.length === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const address_ = checkFromAddress(address, resend.verifiedDomains);
    if (!address_.ok) return setError(address_.message);
    const name_ = checkFromName(name);
    if (!name_.ok) return setError(name_.message);
    const parsed = SetResendFromRequest.safeParse({ fromAddress: address, ...(name.trim() !== "" ? { fromName: name } : {}) });
    if (!parsed.success) return setError("Enter a valid email address, such as hello@mail.yourchurch.org.");
    setError(null);
    setBusy(true);
    try {
      onData(await integrations.setResendFrom(orgId, parsed.data));
      setSaved(true);
    } catch (err) {
      setError(integrationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>From address</CardTitle>
        <CardDescription>
          {noDomains ? "Verify a domain in Resend first, then choose an address on it." : `Use an address on a verified domain: ${resend.verifiedDomains.join(", ")}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={addressId}>From address</Label>
              <Input
                id={addressId}
                type="email"
                autoComplete="off"
                placeholder="hello@mail.yourchurch.org"
                value={address}
                disabled={busy || noDomains}
                aria-invalid={error !== null || undefined}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={nameId}>Display name (optional)</Label>
              <Input
                id={nameId}
                autoComplete="off"
                placeholder="Grace Church"
                maxLength={80}
                value={name}
                disabled={busy || noDomains}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
          </div>
          <InlineError message={error} />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || noDomains || address.trim() === ""}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Saving…" : "Save"}
            </Button>
            {saved ? (
              <p role="status" className="text-sm text-muted-foreground">
                Saved
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function TestCard(props: CardProps & { resend: NonNullable<IntegrationsResponse["resend"]>; contactEmail: string | null }) {
  const { orgId, integrations, resend, contactEmail, onData } = props;
  const toId = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const to = defaultTestRecipient(typed, contactEmail);

  async function send() {
    const parsed = SendTestEmailRequest.safeParse({ to });
    if (!parsed.success) return setError("Enter a valid email address to send the test to.");
    setError(null);
    setBusy(true);
    try {
      onData(await integrations.sendResendTest(orgId, parsed.data));
    } catch (err) {
      setError(integrationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send a test email</CardTitle>
        <CardDescription>
          Sends from <span className="font-mono text-xs">{resend.fromAddress}</span> through your Resend account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor={toId}>Send the test to</Label>
            <div className="flex items-center gap-2">
              <Input
                id={toId}
                type="email"
                autoComplete="off"
                placeholder="you@yourchurch.org"
                value={to}
                disabled={busy}
                onChange={(e) => setTyped(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={busy || to.trim() === ""}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />}
                {busy ? "Sending…" : "Send test"}
              </Button>
            </div>
          </div>
          <InlineError message={error} />
          {error === null && !busy && resend.testedAt ? (
            <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CircleCheck className="size-4 text-emerald-600" aria-hidden="true" />
              {testSentText(resend.testedAt)}
            </p>
          ) : null}
          {error === null && !busy && !resend.testedAt && resend.lastError ? (
            <p className="text-sm text-muted-foreground">Last error from Resend: {resend.lastError}</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function DisconnectCard({ orgId, integrations, data, onData }: CardProps & { data: IntegrationsResponse }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await integrations.disconnectResend(orgId);
    } catch (err) {
      setError(integrationErrorMessage(err));
      setBusy(false);
      return;
    }
    try {
      onData(await integrations.get(orgId));
    } catch {
      // The key is gone; show the platform default rather than a stale connected state.
      onData({ ...data, resend: null, activeSender: data.activeSender === "organization" ? "platform" : data.activeSender });
    }
    toast.success("Resend disconnected", { description: "Contact form delivery is back to the platform default." });
    setBusy(false);
    setOpen(false);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">Stop using your Resend account for this organization.</p>
        <Button type="button" variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
          <Unplug />
          Disconnect
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect Resend?</DialogTitle>
            <DialogDescription>
              We delete your stored key. Contact form delivery returns to the platform default, and messages are still kept in your inbox. You can connect again any time.
            </DialogDescription>
          </DialogHeader>
          <InlineError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Keep it connected
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void disconnect()}>
              {busy ? <Loader2 className="animate-spin" /> : <Unplug />}
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
