import { emptySiteDocument, type Section } from "@ministry/schema";
import { describe, expect, it } from "vitest";
import { conformNewSection, conformOption, conformSection, editTarget, modelContent, pageSummary } from "../src/ai/edit";

function docWithImages() {
  const doc = emptySiteDocument("Grace Church");
  doc.meta.logo = { src: "/assets/sites/s/logo.png", alt: "" };
  const hero = doc.sections[0]!;
  if (hero.type === "hero") hero.image = { src: "/assets/sites/s/hero.webp", alt: "Sunday service", width: 1200, height: 800 };
  const programs = doc.sections.find((s) => s.type === "programs");
  if (programs?.type === "programs") {
    programs.items = [
      { title: "Youth", description: "Fridays", image: { src: "/assets/sites/s/y.webp", alt: "" } },
      { title: "Pantry", description: "Saturdays" },
    ];
  }
  return doc;
}

describe("pageSummary", () => {
  it("is one line with the sections, headings and counts, capped in length", () => {
    const doc = docWithImages();
    const line = pageSummary(doc);
    expect(line).not.toContain("\n");
    expect(line).toContain("Grace Church");
    expect(line).toContain('hero "Welcome to Grace Church"');
    expect(line).toContain("programs \"What we do\" (2)");
    expect(line).toMatch(/about "About us" \(\d+ words\)/);
    doc.meta.tagline = "x".repeat(600);
    expect(pageSummary(doc).length).toBeLessThanOrEqual(320);
  });
});

describe("editTarget and modelContent", () => {
  it("resolves every scope and reports a missing section", () => {
    const doc = docWithImages();
    expect(editTarget(doc, { kind: "section", id: "hero" })).toMatchObject({ kind: "section", section: { id: "hero" } });
    expect(editTarget(doc, { kind: "section", id: "nope" })).toBeNull();
    expect(editTarget(doc, { kind: "meta" })).toMatchObject({ kind: "meta" });
    expect(editTarget(doc, { kind: "theme" })).toMatchObject({ kind: "theme", theme: doc.theme });
    expect(editTarget(doc, { kind: "page" })).toMatchObject({ kind: "page", sections: doc.sections });
  });

  it("sends the model alt text but never a src, and only the three meta strings", () => {
    const doc = docWithImages();
    const json = JSON.stringify(modelContent(editTarget(doc, { kind: "page" })!));
    expect(json).not.toContain("/assets/");
    expect(json).toContain('"image":{"alt":"Sunday service"}');
    expect(json).not.toContain("showEmail");
    expect(modelContent(editTarget(doc, { kind: "meta" })!)).toEqual({ orgName: "Grace Church", tagline: doc.meta.tagline, description: "" });
  });
});

describe("conformSection", () => {
  it("restores media by position, keeps model alt text, and pins id, type and hidden", () => {
    const doc = docWithImages();
    const hero = doc.sections[0]!;
    const after = conformSection(hero, { id: "other", type: "hero", hidden: true, heading: "Hello", image: { alt: "A full room on Sunday" } });
    expect(after).toMatchObject({ id: "hero", type: "hero", hidden: false, heading: "Hello" });
    expect(after?.type === "hero" && after.image).toEqual({ src: "/assets/sites/s/hero.webp", alt: "A full room on Sunday", width: 1200, height: 800 });

    const programs = doc.sections.find((s) => s.type === "programs")!;
    const edited = conformSection(programs, {
      ...programs,
      items: [
        { title: "Youth group", description: "Fridays at 7", image: { src: "https://evil.example/x.png", alt: "" } },
        { title: "Food pantry", description: "Saturdays", image: { src: "https://evil.example/y.png" } },
        { title: "New one", description: "" },
      ],
    });
    expect(edited?.type === "programs" && edited.items.map((i) => i.image?.src)).toEqual(["/assets/sites/s/y.webp", undefined, undefined]);
  });

  it("rejects a different type or an unparsable object", () => {
    const hero = emptySiteDocument().sections[0]!;
    expect(conformSection(hero, { id: "hero", type: "about", body: "x" })).toBeNull();
    expect(conformSection(hero, { id: "hero", type: "hero" })).toBeNull();
    expect(conformSection(hero, "nope")).toBeNull();
  });

  it("keeps the contact section's private settings and endpoint", () => {
    const contact: Section = { id: "contact", type: "contact", hidden: false, heading: "Contact", email: "a@b.c", showEmail: true, phone: "", address: "", formEndpoint: "https://f.example/x", social: [] };
    const after = conformSection(contact, { id: "contact", type: "contact", heading: "Say hello", email: "a@b.c", showEmail: false, phone: "", address: "Main St", social: [] });
    expect(after).toMatchObject({ heading: "Say hello", showEmail: true, formEndpoint: "https://f.example/x", address: "Main St" });
  });
});

describe("conformOption", () => {
  const known = ["classic", "modern", "bold"];

  it("keeps only changes inside the scope and fills in before", () => {
    const doc = docWithImages();
    const changes = conformOption(
      doc,
      { kind: "section", id: "about" },
      {
        label: "Warmer",
        changes: [
          { target: "about", after: { id: "about", type: "about", heading: "Who we are", body: "Neighbors." } },
          { target: "hero", after: { id: "hero", type: "hero", heading: "Nope" } },
          { target: "meta", after: { orgName: "X", tagline: "", description: "" } },
        ],
      },
      known,
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ target: "about", label: "Warmer", before: { heading: "About us" }, after: { heading: "Who we are", body: "Neighbors." } });
  });

  it("merges meta text onto the current meta, keeps the logo and languages, and clamps unknown templates", () => {
    const doc = docWithImages();
    doc.meta.languages = ["ko"];
    const [meta] = conformOption(doc, { kind: "meta" }, { label: "Clear", changes: [{ target: "meta", after: { orgName: " ", tagline: "Hope for Dallas", description: "d", logo: null, languages: [] } }] }, known);
    expect(meta).toMatchObject({ target: "meta", after: { orgName: "Grace Church", tagline: "Hope for Dallas", description: "d", logo: doc.meta.logo, languages: ["ko"] } });

    const [theme] = conformOption(doc, { kind: "theme" }, { label: "Bold", changes: [{ target: "theme", after: { ...doc.theme, templateId: "missing", primary: "#123456" } }] }, known);
    expect(theme).toMatchObject({ target: "theme", after: { templateId: "classic", primary: "#123456" } });
    expect(conformOption(doc, { kind: "theme" }, { label: "Bad", changes: [{ target: "theme", after: { ...doc.theme, primary: "red" } }] }, known)).toEqual([]);
  });

  it("accepts several sections and the meta text for the page scope, dropping unknown ids and repeats", () => {
    const doc = docWithImages();
    const changes = conformOption(
      doc,
      { kind: "page" },
      {
        label: "Page",
        changes: [
          { target: "meta", after: { orgName: "Grace Church", tagline: "New", description: "" } },
          { target: "hero", after: { id: "hero", type: "hero", heading: "Hi" } },
          { target: "hero", after: { id: "hero", type: "hero", heading: "Twice" } },
          { target: "ghost", after: { id: "ghost", type: "about", body: "x" } },
          { target: "theme", after: doc.theme },
        ],
      },
      known,
    );
    expect(changes.map((c) => c.target)).toEqual(["meta", "hero"]);
  });
});

describe("conformNewSection", () => {
  it("validates, strips media and assigns a fresh id", () => {
    const doc = emptySiteDocument();
    const section = conformNewSection(doc, { id: "about", type: "about", hidden: true, heading: "Camp", body: "July.", image: { src: "https://x/y.png", alt: "" }, formEndpoint: "x" });
    expect(section).toMatchObject({ id: "about-1", type: "about", hidden: false, heading: "Camp", body: "July." });
    expect(section?.type === "about" ? section.image : "wrong type").toBeUndefined();
    expect(conformNewSection(doc, { type: "nope" })).toBeNull();
    const team = conformNewSection(doc, { id: "t", type: "team", members: [{ name: "Kim", photo: { src: "https://x/k.png" } }] });
    expect(team?.type === "team" && team.members[0]).toEqual({ name: "Kim", role: "", bio: "" });
  });
});
