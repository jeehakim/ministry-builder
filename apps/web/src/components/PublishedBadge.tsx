import { safeHttpUrl } from "../lib/urls";
import { Badge } from "@/components/ui/badge";

/** Green "Published" badge linking to the live site. Renders nothing for an unpublished site. */
export function PublishedBadge({ url }: { url: string | null }) {
  const href = safeHttpUrl(url);
  if (!href) return null;
  return (
    <Badge
      asChild
      variant="secondary"
      className="gap-1.5 font-normal hover:bg-secondary/70 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <a href={href} target="_blank" rel="noreferrer" title={href}>
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        Published
        <span className="sr-only"> (opens the live site in a new tab)</span>
      </a>
    </Badge>
  );
}
