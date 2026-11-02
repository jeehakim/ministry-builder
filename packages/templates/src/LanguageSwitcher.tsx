import type { LanguageLink } from "./types";

/** Links to the other language versions of the page. Renders nothing for single-language sites. */
export function LanguageSwitcher({ links, className = "lang-switch" }: { links?: LanguageLink[]; className?: string }) {
  if (!links || links.length < 2) return null;
  return (
    <nav className={className} aria-label="Language">
      {links.map((l) => (
        <a key={l.code} href={l.href} lang={l.code} hrefLang={l.code} aria-current={l.current ? "page" : undefined}>
          {l.label}
        </a>
      ))}
    </nav>
  );
}
