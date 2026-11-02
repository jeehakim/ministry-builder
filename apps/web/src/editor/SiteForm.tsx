import { useMemo } from "react";
import { localizeDocument, type Meta, type SiteDocument, type Theme } from "@ministry/schema";
import { templates } from "@ministry/templates";
import { ColorField, SelectField, TextField } from "../components/Field";
import { ImageField } from "../components/ImageField";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { editMetaText, mergeTheme } from "./documentOps";
import { FONT_PAIRS, findFontPair } from "./fontPairs";
import { LanguagesPanel } from "./LanguagesPanel";
import { ThemeReference } from "./ThemeReference";

const HERO_STYLES: { value: Theme["heroStyle"]; label: string }[] = [
  { value: "image", label: "Photo" },
  { value: "solid", label: "Solid" },
  { value: "split", label: "Split" },
];
const RADII: { value: Theme["radius"]; label: string }[] = [
  { value: "none", label: "Square" },
  { value: "small", label: "Soft" },
  { value: "large", label: "Round" },
];

function isHeroStyle(v: string): v is Theme["heroStyle"] {
  return HERO_STYLES.some((s) => s.value === v);
}
function isRadius(v: string): v is Theme["radius"] {
  return RADII.some((s) => s.value === v);
}

export function SiteForm(props: {
  doc: SiteDocument;
  update: (fn: (d: SiteDocument) => SiteDocument) => void;
  /** The language being edited; anything other than the primary is a translation. */
  lang: string;
  translatingTo: string | null;
  onTranslate: (code: string) => Promise<boolean>;
  onOpenLanguage: (code: string) => void;
}) {
  const { doc, update, lang, translatingTo, onTranslate, onOpenLanguage } = props;
  const translating = lang !== doc.meta.language;
  const view = useMemo(() => localizeDocument(doc, lang), [doc, lang]);
  const { theme } = doc;
  const meta = view.meta;
  const setMeta = (patch: Partial<Meta>) => update((d) => ({ ...d, meta: { ...d.meta, ...patch } }));
  const setTheme = (patch: Partial<Theme>) => update((d) => ({ ...d, theme: { ...d.theme, ...patch } }));

  const pair = findFontPair(theme.headingFont, theme.bodyFont);
  const templateOptions = Object.values(templates).map((t) => ({ value: t.id, label: t.name }));
  if (!templateOptions.some((o) => o.value === theme.templateId)) {
    templateOptions.push({ value: theme.templateId, label: `${theme.templateId} (unavailable)` });
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="site-details" className="space-y-4">
        <div>
          <h2 id="site-details" className="text-sm font-semibold">
            Organization
          </h2>
          <p className="text-xs text-muted-foreground">Shown in the header, page title, and search results.</p>
        </div>
        <TextField
          label="Name"
          value={meta.orgName}
          disabled={translating}
          assist={{ context: "organization name" }}
          onChange={(orgName) => setMeta({ orgName })}
        />
        <TextField
          label="Tagline"
          value={meta.tagline}
          assist={{ context: "organization tagline" }}
          onChange={(tagline) => update((d) => editMetaText(d, lang, { tagline }))}
        />
        <TextField
          label="Description for search engines"
          multiline
          value={meta.description}
          assist={{ context: "search engine description" }}
          onChange={(description) => update((d) => editMetaText(d, lang, { description }))}
        />
        <ImageField label="Logo" value={meta.logo} locked={translating} lockAlt={translating} onChange={(logo) => setMeta({ logo })} />
      </section>

      <Separator />

      <LanguagesPanel doc={doc} update={update} translatingTo={translatingTo} onTranslate={onTranslate} onOpenLanguage={onOpenLanguage} />

      <Separator />

      <fieldset disabled={translating} aria-labelledby="site-theme" className="min-w-0 space-y-4 border-0 p-0 disabled:opacity-60">
        <div>
          <h2 id="site-theme" className="text-sm font-semibold">
            Design
          </h2>
          <p className="text-xs text-muted-foreground">Changes show in the preview right away.</p>
        </div>
        <ThemeReference
          onApply={(incoming) =>
            update((d) => ({ ...d, theme: mergeTheme(d.theme, incoming, Object.keys(templates)) }))
          }
        />
        <SelectField label="Template" value={theme.templateId} options={templateOptions} onChange={(templateId) => setTheme({ templateId, ...(templates[templateId]?.themeDefaults ?? {}) })} />
        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Primary" value={theme.primary} onChange={(primary) => setTheme({ primary })} />
          <ColorField label="Accent" value={theme.accent} onChange={(accent) => setTheme({ accent })} />
          <ColorField label="Background" value={theme.background} onChange={(background) => setTheme({ background })} />
          <ColorField label="Text" value={theme.text} onChange={(text) => setTheme({ text })} />
        </div>
        <SelectField
          label="Fonts"
          value={pair?.id ?? "custom"}
          options={[
            ...FONT_PAIRS.map((p) => ({ value: p.id, label: p.label })),
            ...(pair ? [] : [{ value: "custom", label: "Custom (from imported document)", disabled: true }]),
          ]}
          onChange={(id) => {
            const next = FONT_PAIRS.find((p) => p.id === id);
            if (next) setTheme({ headingFont: next.headingFont, bodyFont: next.bodyFont });
          }}
        />
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Hero style</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="w-full"
            value={theme.heroStyle}
            onValueChange={(v) => {
              if (isHeroStyle(v)) setTheme({ heroStyle: v });
            }}
          >
            {HERO_STYLES.map((o) => (
              <ToggleGroupItem key={o.value} value={o.value} className="flex-1">
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Corners</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="w-full"
            value={theme.radius}
            onValueChange={(v) => {
              if (isRadius(v)) setTheme({ radius: v });
            }}
          >
            {RADII.map((o) => (
              <ToggleGroupItem key={o.value} value={o.value} className="flex-1">
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </fieldset>
    </div>
  );
}
