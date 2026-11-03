import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { SignIn, useAuth, useClerk } from "@clerk/clerk-react";
import { ROLE_DESCRIPTIONS, type InvitationPreview } from "@ministry/schema";
import { AlertCircle, HardDrive, Loader2, MailX, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "../api";
import type { OrgsBackend } from "../backend";
import { useBackend } from "../backend-context";
import { ApiUnreachableBanner } from "../components/ApiUnreachableBanner";
import { Brand } from "../components/Brand";
import { isNetworkError } from "../lib/errors";
import { useOrg } from "../orgs/OrgContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/30 p-6">
      <Brand className="justify-center" />
      {children}
    </div>
  );
}

/** Opened from the link in an invitation. Works before sign-in: the preview is public, and signing in happens right here. */
export function InvitePage() {
  const { token } = useParams();
  const { orgs } = useBackend();
  if (!token) return <Gone />;
  if (!orgs) return <LocalModeNotice />;
  return <HostedInvite token={token} orgs={orgs} />;
}

function LocalModeNotice() {
  return (
    <Shell>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="size-4" aria-hidden="true" />
            Invitations need an account
          </CardTitle>
          <CardDescription>
            Local mode keeps one site in this browser and has no sign-in, so there is no organization to join. Open the invitation link in the hosted app instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/">Back to your site</Link>
          </Button>
        </CardContent>
      </Card>
    </Shell>
  );
}

/** The link is unknown, expired, or already used. */
function Gone() {
  return (
    <Shell>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailX className="size-4" aria-hidden="true" />
            This invitation is no longer valid
          </CardTitle>
          <CardDescription>It may have expired or already been used. Ask the person who invited you to send a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/">Go to Ministry Sites</Link>
          </Button>
        </CardContent>
      </Card>
    </Shell>
  );
}

type Load =
  | { kind: "loading" }
  | { kind: "gone" }
  | { kind: "error"; message: string; network: boolean }
  | { kind: "ready"; preview: InvitationPreview };

function HostedInvite({ token, orgs }: { token: string; orgs: OrgsBackend }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  // Bumped by the banner's retry button to load again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    orgs
      .previewInvitation(token)
      .then((preview) => !cancelled && setLoad({ kind: "ready", preview }))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setLoad({ kind: "gone" });
        else setLoad({ kind: "error", message: err instanceof Error ? err.message : "Could not load the invitation.", network: isNetworkError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [orgs, token, attempt]);

  if (load.kind === "gone") return <Gone />;

  if (load.kind === "loading") {
    return (
      <Shell>
        <Skeleton className="h-56 w-full max-w-md rounded-xl" />
      </Shell>
    );
  }

  if (load.kind === "error") {
    return (
      <Shell>
        <div className="w-full max-w-md space-y-3 text-center">
          {load.network ? (
            <ApiUnreachableBanner onRetry={() => setAttempt((n) => n + 1)} />
          ) : (
            <p role="alert" className="flex items-center justify-center gap-2 text-sm">
              <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
              {load.message}
            </p>
          )}
        </div>
      </Shell>
    );
  }

  return <InviteCard token={token} orgs={orgs} preview={load.preview} onGone={() => setLoad({ kind: "gone" })} />;
}

function InviteCard(props: { token: string; orgs: OrgsBackend; preview: InvitationPreview; onGone: () => void }) {
  const { token, orgs, preview, onGone } = props;
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { refresh, select } = useOrg();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<{ message: string; wrongAccount: boolean } | null>(null);

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const joined = await orgs.acceptInvitation(token);
      toast.success(`You joined ${joined.orgName}`, { description: `You are ${joined.role === "admin" ? "an" : "a"} ${joined.role} there.` });
      await refresh();
      select(joined.orgId);
      void navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        onGone();
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setError({ message: `This invitation was sent to ${preview.email}. Sign in with that address.`, wrongAccount: true });
      } else {
        setError({
          message: isNetworkError(err) ? "Can't reach the server. Check your connection, then try again." : err instanceof Error ? err.message : "Could not accept the invitation.",
          wrongAccount: false,
        });
      }
      setAccepting(false);
    }
  }

  return (
    <Shell>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">
            {preview.inviterEmail ? (
              <>
                <span className="break-all">{preview.inviterEmail}</span> invited you to join <span className="break-words">{preview.orgName}</span> as{" "}
                <Badge variant="secondary" className="align-middle capitalize">
                  {preview.role}
                </Badge>
              </>
            ) : (
              <>
                You're invited to join <span className="break-words">{preview.orgName}</span> as{" "}
                <Badge variant="secondary" className="align-middle capitalize">
                  {preview.role}
                </Badge>
              </>
            )}
          </CardTitle>
          <CardDescription>{ROLE_DESCRIPTIONS[preview.role]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This invitation was sent to <span className="font-medium text-foreground">{preview.email}</span>.
          </p>

          {isSignedIn ? (
            <div className="space-y-3">
              <Button type="button" onClick={() => void accept()} disabled={accepting}>
                {accepting ? <Loader2 className="animate-spin" /> : <UserCheck />}
                {accepting ? "Joining…" : `Accept and join ${preview.orgName}`}
              </Button>
              {error ? (
                <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <p>{error.message}</p>
                  {error.wrongAccount ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void signOut({ redirectUrl: pathname })}>
                      Sign out and use another account
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm">
              Sign in with <span className="font-medium">{preview.email}</span> to accept.
            </p>
          )}
        </CardContent>
      </Card>
      {isSignedIn ? null : <SignIn routing="hash" forceRedirectUrl={pathname} signUpForceRedirectUrl={pathname} />}
    </Shell>
  );
}
