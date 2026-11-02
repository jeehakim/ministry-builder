import { useCallback, useEffect, useId, useState } from "react";
import { Check, Copy, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { DomainKind, SiteDomain } from "../api";
import type { DomainsBackend } from "../backend";
import { useSiteId } from "../editor/EditorContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Plain-language reading of a domain's state, for the badge next to its name. */
function describe(domain: SiteDomain): { label: string; tone: "live" | "waiting" | "problem"; hint: string } {
  if (domain.active) return { label: "Live", tone: "live", hint: "The domain serves your site." };
  if (!domain.ownershipVerifiedAt) {
    return { label: "Waiting for TXT record", tone: "waiting", hint: "The ownership record has not been found yet. DNS changes can take a while to spread; check again in a few minutes." };
  }
  if (/timed_out|expired|deleted|inactive/.test(domain.sslStatus)) {
    return { label: "Needs attention", tone: "problem", hint: "Cloudflare could not finish the certificate. Check the CNAME record, then check status again." };
  }
  if (domain.verifiedAt) return { label: "Issuing certificate", tone: "waiting", hint: "Cloudflare has seen the CNAME and is issuing the certificate. Check again in a few minutes." };
  return { label: "Waiting for CNAME", tone: "waiting", hint: "Ownership is proved. Cloudflare has not seen the CNAME record yet; check again in a few minutes." };
}

/** Days until an unproved domain is removed, rounded up; null once ownership is proved. */
function daysLeft(domain: SiteDomain): number | null {
  if (!domain.expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(domain.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function DnsRecord(props: { type: string; name: string; value: string; valueLabel: string }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Type</dt>
      <dd>
        <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono">{props.type}</code>
      </dd>
      <dt className="text-muted-foreground">Name</dt>
      <dd>
        <CopyValue value={props.name} label="record name" />
      </dd>
      <dt className="text-muted-foreground">{props.valueLabel}</dt>
      <dd>
        <CopyValue value={props.value} label={`record ${props.valueLabel.toLowerCase()}`} />
      </dd>
    </dl>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error("Could not copy. Select the value and copy it by hand.");
    }
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      <code className="truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">{value}</code>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Copy ${label}`} onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </span>
  );
}

function DomainRow(props: {
  domain: SiteDomain;
  busy: boolean;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const { domain, busy, onRefresh, onRemove } = props;
  const state = describe(domain);
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{domain.hostname}</span>
        <Badge variant={state.tone === "live" ? "secondary" : state.tone === "problem" ? "destructive" : "outline"} className="gap-1.5 font-normal">
          {state.tone === "live" ? <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> : null}
          {state.label}
        </Badge>
        <span className="text-xs text-muted-foreground">{domain.kind === "primary" ? "Main domain" : "Redirects to main"}</span>
      </div>

      {domain.active ? null : (
        <div className="space-y-2.5 text-sm">
          <p className="text-muted-foreground">Add these two records where your domain's DNS is managed (your registrar, usually):</p>
          <div className="space-y-1">
            <p className="text-xs font-medium">
              1. Ownership proof{" "}
              {domain.ownershipVerifiedAt ? <span className="font-normal text-emerald-600">(found)</span> : <span className="font-normal text-muted-foreground">(checked first)</span>}
            </p>
            <DnsRecord type={domain.txt.type} name={domain.txt.name} value={domain.txt.value} valueLabel="Value" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">2. Routing</p>
            <DnsRecord type={domain.dns.type} name={domain.dns.name} value={domain.dns.target} valueLabel="Target" />
          </div>
          <p className="text-xs text-muted-foreground">
            {state.hint} DNS changes can take up to a day to spread. Once both records are live, the certificate is issued automatically.
            {domain.hostname.split(".").length === 2
              ? " If your DNS provider will not accept a CNAME on the root domain, use an ALIAS or ANAME record, or move your DNS to Cloudflare (free)."
              : ""}
            {daysLeft(domain) !== null ? ` Without the ownership record the domain is removed from this site in ${daysLeft(domain)} day${daysLeft(domain) === 1 ? "" : "s"}.` : ""}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {domain.active ? (
          <Button asChild variant="outline" size="sm">
            <a href={`https://${domain.hostname}/`} target="_blank" rel="noreferrer">
              Open
            </a>
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRefresh}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Check status
          </Button>
        )}
        {confirm ? (
          <span className="flex items-center gap-1.5" role="group" aria-label={`Confirm removing ${domain.hostname}`}>
            <span className="text-xs text-muted-foreground">Remove this domain?</span>
            <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onRemove}>
              Yes, remove
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(false)}>
              Keep it
            </Button>
          </span>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(true)}>
            <Trash2 />
            Remove
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * "Custom domain" section of the publish dialog: lists the domains attached to the site with their
 * DNS instructions and status, and lets the owner add or remove one. Needs the API backend.
 */
export function CustomDomainPanel({ domains, published }: { domains: DomainsBackend; published: boolean }) {
  const siteId = useSiteId();
  const inputId = useId();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; items: SiteDomain[]; enabled: boolean }
  >({ kind: "loading" });
  const [hostname, setHostname] = useState("");
  const [kind, setKind] = useState<DomainKind>("primary");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await domains.list(siteId);
      setState({ kind: "ready", items: list.domains, enabled: list.enabled });
    } catch (err) {
      setState({ kind: "error", message: errorText(err) });
    }
  }, [domains, siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = state.kind === "ready" ? state.items : [];
  const hasPrimary = items.some((d) => d.kind === "primary");

  // A site's first domain is its main one; later ones default to redirects.
  useEffect(() => {
    setKind(hasPrimary ? "redirect" : "primary");
  }, [hasPrimary]);

  function replace(updated: SiteDomain) {
    setState((s) => (s.kind === "ready" ? { ...s, items: s.items.map((d) => (d.id === updated.id ? updated : d)) } : s));
  }

  async function add() {
    const value = hostname.trim();
    if (!value) return;
    setAdding(true);
    try {
      const domain = await domains.add(siteId, value, kind);
      setState((s) => (s.kind === "ready" ? { ...s, items: [...s.items, domain] } : s));
      setHostname("");
      toast.success(`${domain.hostname} added`, { description: "Now create the two DNS records shown below it, starting with the TXT record." });
    } catch (err) {
      toast.error("Could not add the domain", { description: errorText(err) });
    } finally {
      setAdding(false);
    }
  }

  async function refresh(domain: SiteDomain) {
    setBusyId(domain.id);
    try {
      const updated = await domains.refresh(siteId, domain.id);
      replace(updated);
      const next = describe(updated);
      if (updated.active) toast.success(`${updated.hostname} is live`);
      else if (updated.ownershipVerifiedAt && !domain.ownershipVerifiedAt) toast.success("Ownership confirmed", { description: next.hint });
      else toast.info(next.label, { description: next.hint });
    } catch (err) {
      toast.error("Could not check the domain", { description: errorText(err) });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(domain: SiteDomain) {
    setBusyId(domain.id);
    try {
      await domains.remove(siteId, domain.id);
      setState((s) => (s.kind === "ready" ? { ...s, items: s.items.filter((d) => d.id !== domain.id) } : s));
      toast.success(`${domain.hostname} removed`);
    } catch (err) {
      toast.error("Could not remove the domain", { description: errorText(err) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="publish-domain" className="space-y-3">
      <div>
        <h3 id="publish-domain" className="text-sm font-semibold">
          Custom domain
        </h3>
        <p className="text-sm text-muted-foreground">
          Serve the site at your own address, with SSL handled for you. Add the main domain first, then any others that should redirect to it.
          You prove you control each domain with a TXT record before it goes live.
        </p>
      </div>

      {state.kind === "loading" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading domains…
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load domains: {state.message}
        </p>
      ) : null}

      {state.kind === "ready" ? (
        <>
          {items.length > 0 ? (
            <ul className="space-y-2">
              {items.map((domain) => (
                <DomainRow
                  key={domain.id}
                  domain={domain}
                  busy={busyId === domain.id}
                  onRefresh={() => void refresh(domain)}
                  onRemove={() => void remove(domain)}
                />
              ))}
            </ul>
          ) : null}

          {!state.enabled ? (
            <p className="text-sm text-muted-foreground">Custom domains are not enabled on this server yet.</p>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                  Domain name
                </Label>
                <Input
                  id={inputId}
                  value={hostname}
                  placeholder="example.org"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                  onChange={(e) => setHostname(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Role</Label>
                <Select value={kind} onValueChange={(v) => setKind(v === "redirect" ? "redirect" : "primary")}>
                  <SelectTrigger size="sm" className="w-36" aria-label="Domain role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary" disabled={hasPrimary}>
                      Main domain
                    </SelectItem>
                    <SelectItem value="redirect">Redirect to main</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" size="sm" disabled={adding || hostname.trim() === ""}>
                {adding ? <Loader2 className="animate-spin" /> : <Plus />}
                Add domain
              </Button>
            </form>
          )}
          {state.enabled && !published ? (
            <p className="text-xs text-muted-foreground">The domain starts serving your page once the site is published.</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
