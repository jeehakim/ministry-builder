import { languageName } from "@ministry/schema";
import { Info, Languages } from "lucide-react";
import { translationNotice } from "../lib/languages";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * Picks which language the sidebar and preview show. Renders nothing for a
 * single-language site; the Languages panel in Site & design is where one is added.
 */
export function LanguageSwitcher(props: {
  /** Primary language first. */
  languages: string[];
  active: string;
  onSelect: (code: string) => void;
}) {
  const { languages, active, onSelect } = props;
  const primary = languages[0];
  if (!primary || languages.length < 2) return null;
  const translating = active !== primary;

  return (
    <div className="shrink-0 space-y-2 border-b px-3 py-2">
      <div className="flex items-center gap-2">
        <Languages className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          className="min-w-0 flex-1 flex-wrap"
          value={active}
          aria-label="Editing language"
          onValueChange={(v) => {
            if (v !== "") onSelect(v);
          }}
        >
          {languages.map((code) => (
            <ToggleGroupItem
              key={code}
              value={code}
              lang={code}
              aria-label={`Edit in ${languageName(code)}`}
              className="data-[state=on]:border-brand/40 data-[state=on]:bg-brand-soft data-[state=on]:text-brand"
            >
              {languageName(code)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {translating ? (
          <Badge variant="secondary" className="shrink-0">
            Translation
          </Badge>
        ) : null}
      </div>
      {translating ? (
        <p role="status" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{translationNotice(primary)}</span>
        </p>
      ) : null}
    </div>
  );
}
