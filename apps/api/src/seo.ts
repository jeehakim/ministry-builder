function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

/** Absolute URL of a language page: the primary language is the site root, the others sit one level down. */
export function languagePageUrl(baseUrl: string, primary: string, lang: string): string {
  return lang === primary ? baseUrl : `${baseUrl}${lang}/`;
}

export function sitemapUrl(baseUrl: string): string {
  return `${baseUrl}sitemap.xml`;
}

/** robots.txt: everything may be crawled; the sitemap is named by its absolute URL. */
export function buildRobotsTxt(baseUrl: string): string {
  return `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl(baseUrl)}\n`;
}

/**
 * sitemap.xml with the primary page and every language page. Each entry lists all language versions
 * as `xhtml:link` alternates (plus x-default for the primary page) when the site has more than one.
 * `baseUrl` is the absolute site root with a trailing slash; `languages` lists the primary first.
 */
export function buildSitemapXml(baseUrl: string, languages: string[]): string {
  const primary = languages[0] ?? "";
  const alternates =
    languages.length > 1
      ? [
          ...languages.map((lang) => ({ hreflang: lang, href: languagePageUrl(baseUrl, primary, lang) })),
          { hreflang: "x-default", href: baseUrl },
        ]
      : [];
  const entries = languages.map((lang) => {
    const lines = [`    <loc>${escapeXml(languagePageUrl(baseUrl, primary, lang))}</loc>`];
    for (const alt of alternates) {
      lines.push(`    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(alt.href)}"/>`);
    }
    return `  <url>\n${lines.join("\n")}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
}
