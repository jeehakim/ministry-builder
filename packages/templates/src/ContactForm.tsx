import type { Section } from "@ministry/schema";
import type { RenderOptions } from "./types";
import { uiStrings } from "./i18n";

type ContactSection = Extract<Section, { type: "contact" }>;

/**
 * The contact form shared by every template. Posts to the platform's form endpoint
 * (`options.formAction`, which emails the section's address) or to a custom
 * `formEndpoint` the user configured. Renders nothing when neither exists.
 * A hidden honeypot field and the page language travel with the submission.
 */
export function ContactForm({ section, options }: { section: ContactSection; options: RenderOptions }) {
  const language = options.language ?? "en";
  const action = section.formEndpoint || (section.email ? options.formAction : undefined);
  if (!action) return null;
  const t = uiStrings(language);
  const disabled = action === "#";
  return (
    <form className="form" action={action} method="POST" acceptCharset="UTF-8">
      <label className="field">
        <span className="label">{t.name}</span>
        <input name="name" autoComplete="name" maxLength={120} required disabled={disabled} />
      </label>
      <label className="field">
        <span className="label">{t.email}</span>
        <input name="email" type="email" autoComplete="email" maxLength={200} required disabled={disabled} />
      </label>
      <label className="field">
        <span className="label">{t.message}</span>
        <textarea name="message" rows={5} maxLength={4000} required disabled={disabled} />
      </label>
      <div className="hp" aria-hidden="true">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <input type="hidden" name="_lang" value={language} />
      <button type="submit" disabled={disabled}>{t.send}</button>
    </form>
  );
}

/** CSS shared by the templates for the form; each template's stylesheet appends its own colors. */
export const CONTACT_FORM_CSS = `.form{display:grid;gap:12px}
.form .field{display:grid;gap:4px}
.form .label{font-size:.85rem;font-weight:600;opacity:.85}
.form input,.form textarea{width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,.2);border-radius:var(--radius);font:inherit;background:#fff;color:inherit}
.form input:focus-visible,.form textarea:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.form button{padding:12px 20px;border:0;border-radius:var(--radius);background:var(--accent);font-weight:600;cursor:pointer;font:inherit;font-weight:600}
.form button:disabled,.form input:disabled,.form textarea:disabled{opacity:.6;cursor:not-allowed}
.hp{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}
`;
