import type { ReactNode } from "react";
import { Link } from "react-router";
import { Building2, Globe, HeartHandshake, type LucideIcon } from "lucide-react";
import type { OrgChoice } from "../lib/fundraising";
import { Brand } from "./Brand";
import { HelpMenu } from "./HelpMenu";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type DashboardArea = "sites" | "fundraising";

const AREAS: { key: DashboardArea; label: string; path: string; Icon: LucideIcon }[] = [
  { key: "sites", label: "Sites", path: "/", Icon: Globe },
  { key: "fundraising", label: "Fundraising", path: "/fundraising", Icon: HeartHandshake },
];

/** Path of a dashboard area for an organization. */
export function areaPath(area: DashboardArea, orgId: string | null): string {
  const base = AREAS.find((a) => a.key === area)?.path ?? "/";
  return orgId ? `${base}?org=${encodeURIComponent(orgId)}` : base;
}

/**
 * The frame of the organization dashboard: brand, the organization switcher, the area menu
 * (Sites, Fundraising) and the account controls. Pages render inside it.
 */
export function AppShell(props: {
  area: DashboardArea;
  orgs: OrgChoice[];
  orgId: string | null;
  onOrgChange: (id: string) => void;
  children: ReactNode;
}) {
  const { area, orgs, orgId, onOrgChange, children } = props;
  const current = orgs.find((o) => o.id === orgId) ?? null;
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Brand compact />
          {orgs.length > 1 ? (
            <Select value={orgId ?? undefined} onValueChange={onOrgChange}>
              <SelectTrigger size="sm" className="max-w-56" aria-label="Organization">
                <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <SelectValue placeholder="Organization" />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : current ? (
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
              <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{current.name}</span>
            </span>
          ) : null}
          <nav aria-label="Dashboard" className="ml-2 flex items-center gap-1">
            {AREAS.map((a) => (
              <Link
                key={a.key}
                to={areaPath(a.key, orgId)}
                aria-current={area === a.key ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  area === a.key ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <a.Icon className="size-4" aria-hidden="true" />
                {a.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <HelpMenu />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
    </div>
  );
}
