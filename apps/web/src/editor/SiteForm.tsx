import type { Meta, SiteDocument, Theme } from "@ministry/schema";
import { templates } from "@ministry/templates";
import { ColorField, SelectField, TextField } from "../components/Field";
import { ImageField } from "../components/ImageField";
import { FONT_PAIRS, findFontPair } from "./fontPairs";

const HERO_STYLES: Theme["heroStyle"][] = ["image", "solid", "split"];
const RADII: Theme["radius"][] = ["none", "small", "large"];

function isHeroStyle(v: string): v is Theme["heroStyle"] {
  return HERO_STYLES.some((s) => s === v);
}
function isRadius(v: string): v is Theme["radius"] {
  return RADII.some((s) => s === v);
}

export function SiteForm({ doc, update }: { doc: SiteDocument; update: (fn: (d: SiteDocument) => SiteDocument) => void }) {
  const { meta, theme } = doc;
  const setMeta = (patch: Partial<Meta>) => update((d) => ({ ...d, meta: { ...d.meta, ...patch } }));
  const setTheme = (patch: Partial<Theme>) => update((d) => ({ ...d, theme: { ...d.theme, ...patch } }));

  const pair = findFontPair(theme.headingFont, theme.bodyFont);
  const templateOptions = Object.values(templates).map((t) => ({ value: t.id, label: t.name }));
  if (!templateOptions.some((o) => o.value === theme.templateId)) {
    templateOptions.push({ value: theme.templateId, label: `${theme.templateId} (unavailable)` });
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="site-details" className="space-y-3">
        <h2 id="site-details" className="text-sm font-semibold text-slate-900">
          Organization
        </h2>
        <TextField label="Name" value={meta.orgName} onChange={(orgName) => setMeta({ orgName })} />
        <TextField label="Tagline" value={meta.tagline} onChange={(tagline) => setMeta({ tagline })} />
        <TextField
          label="Description (for search engines)"
          multiline
          value={meta.description}
          onChange={(description) => setMeta({ description })}
        />
        <ImageField label="Logo" value={meta.logo} onChange={(logo) => setMeta({ logo })} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Language code" value={meta.language} onChange={(language) => setMeta({ language })} />
          <TextField
            label="Second language (optional)"
            value={meta.secondaryLanguage ?? ""}
            placeholder="ko"
            onChange={(v) => setMeta({ secondaryLanguage: v === "" ? undefined : v })}
          />
        </div>
      </section>

      <section aria-labelledby="site-theme" className="space-y-3">
        <h2 id="site-theme" className="text-sm font-semibold text-slate-900">
          Design
        </h2>
        <SelectField
          label="Template"
          value={theme.templateId}
          options={templateOptions}
          onChange={(templateId) => setTheme({ templateId })}
        />
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
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Hero style"
            value={theme.heroStyle}
            options={HERO_STYLES.map((v) => ({ value: v, label: v }))}
            onChange={(v) => {
              if (isHeroStyle(v)) setTheme({ heroStyle: v });
            }}
          />
          <SelectField
            label="Corner radius"
            value={theme.radius}
            options={RADII.map((v) => ({ value: v, label: v }))}
            onChange={(v) => {
              if (isRadius(v)) setTheme({ radius: v });
            }}
          />
        </div>
      </section>
    </div>
  );
}
