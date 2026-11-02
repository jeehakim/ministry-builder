import { emptySiteDocument, SiteDocument } from "@ministry/schema";
import { describe, expect, it } from "vitest";
import { safeHref, sanitizeDocumentForPublish } from "../src/publishSafety";

describe("safeHref", () => {
  it.each([
    ["https://example.org/a?b=1#c", "https://example.org/a?b=1#c"],
    ["http://example.org", "http://example.org"],
    ["HTTPS://EXAMPLE.ORG", "HTTPS://EXAMPLE.ORG"],
    ["mailto:pastor@example.org", "mailto:pastor@example.org"],
    ["MailTo:pastor@example.org", "MailTo:pastor@example.org"],
    ["tel:+1 555 0100", "tel:+1 555 0100"],
    ["#about", "#about"],
    ["page.html", "page.html"],
    ["sub/dir/page.html?x=1", "sub/dir/page.html?x=1"],
    ["/images/a.png", "/images/a.png"],
    ["  https://example.org  ", "https://example.org"],
    ["https://example.org/a\tb\n", "https://example.org/ab"],
  ])("keeps %j", (input, expected) => {
    expect(safeHref(input)).toBe(expected);
  });

  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["JAVASCRIPT:alert(1)"],
    ["  javascript:alert(1)"],
    ["\n\tjavascript:alert(1)"],
    ["java\tscript:alert(1)"],
    ["java\nscript:alert(1)"],
    ["java\u0000script:alert(1)"],
    [" javascript:alert(1)"],
    ["data:text/html;base64,PHNjcmlwdD4="],
    ["DaTa:text/html,<script>alert(1)</script>"],
    ["  data:text/html,x"],
    ["vbscript:msgbox(1)"],
    ["VBScript:msgbox(1)"],
    [" vbscript:msgbox(1)"],
    ["file:///etc/passwd"],
    ["blob:https://example.org/uuid"],
    ["ftp://example.org/file"],
    ["sms:+15550100"],
    ["../secret"],
    ["a/../b"],
    ["images/%2e%2e/secret"],
    ["..\\secret"],
    [""],
    ["   "],
    ["\u0000\u0001"],
  ])("drops %j", (input) => {
    expect(safeHref(input)).toBeNull();
  });

  it("drops anything that is not a string", () => {
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(42)).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});

function documentWithLinks() {
  const doc = emptySiteDocument("Safety Org");
  const hero = doc.sections.find((s) => s.type === "hero");
  const give = doc.sections.find((s) => s.type === "give");
  const contact = doc.sections.find((s) => s.type === "contact");
  const programs = doc.sections.find((s) => s.type === "programs");
  if (hero?.type !== "hero" || give?.type !== "give" || contact?.type !== "contact" || programs?.type !== "programs") {
    throw new Error("starter document changed");
  }
  hero.primaryCta = { label: "Visit", href: "JaVaScRiPt:alert(1)" };
  hero.secondaryCta = { label: "Read", href: "#about" };
  give.links = [
    { label: "Bad", href: "data:text/html,<script>alert(1)</script>" },
    { label: "Good", href: "https://give.example.org" },
    { label: "Spaced", href: "  vbscript:msgbox(1)" },
    { label: "Mail", href: "mailto:a@example.org" },
  ];
  contact.formEndpoint = "javascript:void(0)";
  contact.social = [{ label: "Page", href: " https://social.example.org" }];
  programs.items = [
    { title: "With link", description: "", link: { label: "More", href: "../escape" } },
    { title: "Fine", description: "", link: { label: "More", href: "more.html" } },
  ];
  return { doc, hero, give, contact, programs };
}

describe("sanitizeDocumentForPublish", () => {
  it("removes links whose destination is unsafe and keeps the rest", () => {
    const { doc } = documentWithLinks();
    const clean = sanitizeDocumentForPublish(doc);
    const hero = clean.sections.find((s) => s.type === "hero");
    const give = clean.sections.find((s) => s.type === "give");
    const contact = clean.sections.find((s) => s.type === "contact");
    const programs = clean.sections.find((s) => s.type === "programs");

    expect(hero?.type === "hero" && hero.primaryCta).toBeUndefined();
    expect(hero?.type === "hero" && hero.secondaryCta).toEqual({ label: "Read", href: "#about" });
    expect(give?.type === "give" && give.links).toEqual([
      { label: "Good", href: "https://give.example.org" },
      { label: "Mail", href: "mailto:a@example.org" },
    ]);
    expect(contact?.type === "contact" && contact.formEndpoint).toBeUndefined();
    expect(contact?.type === "contact" && contact.social).toEqual([{ label: "Page", href: "https://social.example.org" }]);
    expect(programs?.type === "programs" && programs.items.map((i) => i.link)).toEqual([undefined, { label: "More", href: "more.html" }]);
  });

  it("returns a document the renderer still accepts", () => {
    const { doc } = documentWithLinks();
    expect(SiteDocument.safeParse(sanitizeDocumentForPublish(doc)).success).toBe(true);
  });

  it("does not modify its input", () => {
    const { doc } = documentWithLinks();
    const before = JSON.stringify(doc);
    sanitizeDocumentForPublish(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("strips control characters from every string but keeps line breaks and tabs in free text", () => {
    const doc = emptySiteDocument("Org\u0000 Name\u001b");
    doc.meta.tagline = "Tag\u0007line";
    const about = doc.sections.find((s) => s.type === "about");
    if (about?.type !== "about") throw new Error("starter document changed");
    about.body = "First\u0000 paragraph\r\n\r\nSecond\tparagraph\u009f\u007f";
    const hero = doc.sections.find((s) => s.type === "hero");
    if (hero?.type !== "hero") throw new Error("starter document changed");
    hero.image = { src: "images/a\u0000.png", alt: "Al\u0008t" };
    doc.translations = { es: { meta: { tagline: "Lí\u0000nea" }, sections: { about: { body: "Cuer\u0001po" } } } };

    const clean = sanitizeDocumentForPublish(doc);
    expect(clean.meta.orgName).toBe("Org Name");
    expect(clean.meta.tagline).toBe("Tagline");
    const cleanAbout = clean.sections.find((s) => s.type === "about");
    expect(cleanAbout?.type === "about" && cleanAbout.body).toBe("First paragraph\r\n\r\nSecond\tparagraph");
    const cleanHero = clean.sections.find((s) => s.type === "hero");
    expect(cleanHero?.type === "hero" && cleanHero.image).toEqual({ src: "images/a.png", alt: "Alt" });
    expect(clean.translations["es"]?.meta.tagline).toBe("Línea");
    expect(clean.translations["es"]?.sections["about"]).toEqual({ body: "Cuerpo" });
  });

  it("drops only the unsafe href inside translation overlays so array positions stay aligned", () => {
    const { doc } = documentWithLinks();
    doc.meta.languages = ["es"];
    doc.translations = {
      es: {
        meta: {},
        sections: {
          [doc.sections.find((s) => s.type === "give")?.id ?? "give"]: {
            links: [{ label: "Malo", href: "javascript:alert(1)" }, { label: "Bueno", href: "https://dar.example.org" }],
          },
        },
      },
    };
    const clean = sanitizeDocumentForPublish(doc);
    const give = Object.values(clean.translations["es"]?.sections ?? {})[0] as { links: unknown[] };
    expect(give.links).toEqual([{ label: "Malo" }, { label: "Bueno", href: "https://dar.example.org" }]);
  });

  it("leaves a document with nothing to clean unchanged", () => {
    const doc = emptySiteDocument("Plain Org");
    expect(sanitizeDocumentForPublish(doc)).toEqual(doc);
  });

  it("does not let a __proto__ key in a translation overlay pollute the result", () => {
    const doc = emptySiteDocument("Proto Org");
    const overlay = JSON.parse('{"meta":{},"sections":{"__proto__":{"polluted":"yes"}}}') as SiteDocument["translations"][string];
    doc.translations = { es: overlay };
    const clean = sanitizeDocumentForPublish(doc);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.keys(clean.translations["es"]?.sections ?? {})).toEqual(["__proto__"]);
  });
});
