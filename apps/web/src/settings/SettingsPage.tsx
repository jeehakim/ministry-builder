import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { SiteDocument } from "@ministry/schema";
import { AlertCircle, ArrowLeft, Globe, Mail, Settings, TriangleAlert, type LucideIcon } from "lucide-react";
import type { SiteInfo } from "../api";
import { useBackend } from "../backend-context";
import { ApiUnreachableBanner } from "../components/ApiUnreachableBanner";
import { Brand } from "../components/Brand";
import { DeleteSiteDialog } from "../components/DeleteSiteDialog";
import { HelpMenu } from "../components/HelpMenu";
import { ThemeToggle } from "../components/ThemeToggle";
import { UserMenu } from "../components/UserMenu";
import { isNetworkError } from "../lib/errors";
import { platformContactEmail } from "../lib/messages";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailDeliveryPanel } from "./EmailDeliveryPanel";

const SECTIONS = [
  { key: "email", label: "Email delivery", Icon: Mail },
  { key: "domain", label: "Domain", Icon: Globe },
  { key: "danger", label: "Danger zone", Icon: TriangleAlert },
] as const satisfies readonly { key: string; label: string; Icon: LucideIcon }[];

type SectionKey = (typeof SECTIONS)[number]["key"];

function sectionFrom(value: string | null): SectionKey {
  return SECTIONS.find((s) => s.key === value)?.key ?? "email";
}

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string; network: boolean }
  | { kind: "ready"; site: SiteInfo; doc: SiteDocument };

export function SettingsPage() {
  const { id } = useParams();
  const backend = useBackend();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  // Bumped by the banner's retry button to load again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id || !backend.integrations) return;
    let cancelled = false;
    setLoad({ kind: "loading" });
    backend
      .loadSite(id)
      .then(({ site, document }) => !cancelled && setLoad({ kind: "ready", site, doc: document }))
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: err instanceof Error ? err.message : "Could not load the site.", network: isNetworkError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [backend, id, attempt]);

  const unavailable = !id || !backend.integrations;
  const backTo = id ? `/sites/${encodeURIComponent(id)}` : "/";

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Brand />
          <div className="flex items-center gap-1">
            <HelpMenu />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-10">
        {unavailable ? (
          <Empty className="border bg-background py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Settings />
              </EmptyMedia>
              <EmptyTitle>Settings need a Ministry Sites account</EmptyTitle>
              <EmptyDescription>Local mode keeps your site in this browser only, so there is no email delivery to set up.</EmptyDescription>
            </EmptyHeader>
            <Button asChild variant="outline">
              <Link to={backTo}>
                <ArrowLeft />
                Back
              </Link>
            </Button>
          </Empty>
        ) : load.kind === "loading" ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : load.kind === "error" ? (
          <div className="mx-auto max-w-md space-y-3 text-center">
            {load.network ? (
              <ApiUnreachableBanner onRetry={() => setAttempt((n) => n + 1)} />
            ) : (
              <p role="alert" className="flex items-center justify-center gap-2 text-sm">
                <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
                {load.message}
              </p>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to="/">
                <ArrowLeft />
                Back to your sites
              </Link>
            </Button>
          </div>
        ) : (
          <SettingsView site={load.site} doc={load.doc} />
        )}
      </div>
    </div>
  );
}

function SettingsView({ site, doc }: { site: SiteInfo; doc: SiteDocument }) {
  const navigate = useNavigate();
  const backend = useBackend();
  const [params] = useSearchParams();
  const section = sectionFrom(params.get("section"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const contactEmail = useMemo(() => platformContactEmail(doc), [doc]);
  const orgName = doc.meta.orgName || "Untitled site";
  const editorPath = `/sites/${encodeURIComponent(site.id)}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-1 lg:sticky lg:top-6 lg:self-start">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to={editorPath}>
            <ArrowLeft />
            Back to the editor
          </Link>
        </Button>
        <p className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Settings</p>
        <nav aria-label="Settings sections" className="space-y-1">
          {SECTIONS.map(({ key, label, Icon }) => (
            <Link
              key={key}
              to={`?section=${key}`}
              replace
              aria-current={section === key ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                section === key ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 max-w-2xl space-y-6">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Site settings</p>
          <h1 className="text-2xl font-semibold tracking-tight">{orgName}</h1>
        </div>

        {section === "email" ? (
          <section aria-label="Email delivery" className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Email delivery</h2>
              <p className="text-sm text-muted-foreground">Choose who sends the messages from your site's contact form.</p>
            </div>
            {site.orgId ? (
              <EmailDeliveryPanel orgId={site.orgId} contactEmail={contactEmail} />
            ) : (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                The server did not say which organization owns this site, so email settings cannot load.
              </p>
            )}
          </section>
        ) : null}

        {section === "domain" ? (
          <Card>
            <CardHeader>
              <CardTitle>Domain</CardTitle>
              <CardDescription>Your own address, such as yourchurch.org, is set up from the Publish dialog.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                Open the editor, click <strong>Publish</strong>, and scroll to <strong>Custom domain</strong>. Add your domain there and copy the DNS record it
                shows to your registrar.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={editorPath}>Open the editor</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/guide/domains">Read the domain guide</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {section === "danger" ? (
          <Card className="ring-destructive/30">
            <CardHeader>
              <CardTitle>Danger zone</CardTitle>
              <CardDescription>Deleting a site cannot be undone.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Removes the site, every saved version, uploaded images, contact messages and the published pages.</p>
              {backend.deleteSite ? (
                <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
                  Delete site
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </main>

      <DeleteSiteDialog
        site={confirmDelete ? { id: site.id, orgName, publishedUrl: site.publishedUrl } : null}
        onClose={() => setConfirmDelete(false)}
        onDeleted={() => void navigate("/", { replace: true })}
      />
    </div>
  );
}
