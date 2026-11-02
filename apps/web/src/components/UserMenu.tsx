import { UserButton } from "@clerk/clerk-react";
import { HardDrive } from "lucide-react";
import { LOCAL_MODE } from "../env";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function UserMenu() {
  if (LOCAL_MODE) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="secondary" className="gap-1 font-normal">
            <HardDrive className="size-3" aria-hidden="true" />
            Local mode
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom">No sign-in configured. Your site is stored in this browser only.</TooltipContent>
      </Tooltip>
    );
  }
  return <UserButton />;
}
