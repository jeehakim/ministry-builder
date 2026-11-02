---
name: pattern-raw-strings-into-templates
description: Recurring vuln pattern in this repo - unconstrained z.string() schema fields interpolated raw into template CSS/HTML strings (theme colors/fonts broke out of <style>)
metadata:
  type: feedback
---
Check every `${...}` template-literal interpolation in packages/templates (styles.ts, util.ts themeVars, index.tsx head) against the Zod field type. At 2026-11-02, Theme.primary/accent/background/text/headingFont/bodyFont were plain z.string() and went raw into `<style>`, giving stored XSS via `red}</style><script>...` (PoC confirmed). JSX-rendered text and hrefs are safe (React 19.3 SSR escapes and blocks javascript: URLs); the raw string-built head/CSS is where bugs live. An in-flight publish sanitizer (publishSafety.ts) covered hrefs but not theme fields.

**Why:** schema says "CSS color" in comments only; AI output and PUT /sites/:id/document both feed it.
**How to apply:** on any template/schema change, grep for raw interpolation into CSS/HTML and require a strict regex at the schema (not just at render).
