import { UserButton } from "@clerk/clerk-react";
import { LOCAL_MODE } from "../env";

export function UserMenu() {
  if (LOCAL_MODE) {
    return (
      <span
        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
        title="No Clerk key configured: your site is stored in this browser only."
      >
        Local mode
      </span>
    );
  }
  return <UserButton />;
}
