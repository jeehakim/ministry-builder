import { Link } from "react-router";
import { Globe, HeartHandshake, type LucideIcon } from "lucide-react";
import { OrgSwitcher } from "../orgs/OrgSwitcher";
import { Brand } from "./Brand";
import { HelpMenu } from "./HelpMenu";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { cn } from "@/lib/utils";

export type DashboardArea = "sites" | "fundraising";

const AREAS: { key: DashboardArea; label: string; path: string; Icon: LucideIcon }[] = [
  { key: "sites", label: "Sites", path: "/", Icon: Globe },
  { key: "fundraising", label: "Fundraising", path: "/fundraising", Icon: HeartHandshake },
];

/**
 * The organization dashboard's header: brand, the organization switcher, the area menu
 * (Sites, Fundraising) and the account controls. Both areas show the current organization.
 * `showFundraising` is false in local mode, where there is no fundraising backend.
 */
export function DashboardHeader({ area, showFundraising = true }: { area: DashboardArea; showFundraising?: boolean }) {
  const areas = showFundraising ? AREAS : AREAS.filter((a) => a.key !== "fundraising");
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Brand />
          <OrgSwitcher />
        </div>
        {areas.length > 1 ? (
          <nav aria-label="Dashboard" className="flex items-center gap-1">
            {areas.map((a) => (
              <Link
                key={a.key}
                to={a.path}
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
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <HelpMenu />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
