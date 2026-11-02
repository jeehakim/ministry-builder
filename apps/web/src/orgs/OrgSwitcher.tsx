import { useNavigate } from "react-router";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrg } from "./OrgContext";

/**
 * Picks the organization being worked in. Hidden in local mode and for people with no organization.
 * `leaveOnSelect` sends the user back to the site list after a switch, for pages that belong to one site.
 */
export function OrgSwitcher({ leaveOnSelect = false }: { leaveOnSelect?: boolean }) {
  const { orgs, current, select } = useOrg();
  const navigate = useNavigate();
  if (!current) return null;

  function choose(id: string) {
    if (id === current?.id) return;
    select(id);
    if (leaveOnSelect) void navigate("/");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-64 gap-2" aria-label={`Organization: ${current.name}. Switch organization`}>
          <Building2 aria-hidden="true" />
          <span className="truncate">{current.name}</span>
          <Badge variant="secondary" className="font-normal capitalize">
            {current.role}
          </Badge>
          <ChevronsUpDown className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => choose(org.id)} aria-current={org.id === current.id ? "true" : undefined}>
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            <span className="text-xs text-muted-foreground capitalize">{org.role}</span>
            <Check className={org.id === current.id ? "opacity-100" : "opacity-0"} aria-hidden="true" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
