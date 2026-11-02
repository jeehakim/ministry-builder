import type { Section, SiteDocument } from "@ministry/schema";
import type { RenderOptions } from "../types";
import { ContactForm } from "../ContactForm";
import { paragraphs } from "../util";
import { LanguageSwitcher } from "../LanguageSwitcher";

type Props = { doc: SiteDocument; options: RenderOptions };
type Attrs = Record<string, string | undefined>;

/** Splits the body into a lead sentence (for the pull-quote) and the remaining paragraphs. */
function splitLead(body: string): { lead: string; rest: string[] } {
  const [first = "", ...others] = paragraphs(body);
  const m = first.match(/^(.+?[.!?])(?:\s+([\s\S]*))?$/);
  if (!m) return { lead: first, rest: others };
  return { lead: m[1] ?? first, rest: [m[2] ?? "", ...others].filter(Boolean) };
}

export function ModernBody({ doc, options }: Props) {
  const visible = doc.sections.filter((s) => !s.hidden);
  const hero = visible.find((s) => s.type === "hero");
  const give = visible.find((s) => s.type === "give");
  const sectionAttrs = (s: Section): Attrs => (options.editor ? { "data-section-id": s.id } : {});

  const heroCta = hero?.type === "hero" ? hero.primaryCta : undefined;
  const topCta = heroCta
    ? { label: heroCta.label, href: heroCta.href }
    : give?.type === "give"
      ? { label: give.heading, href: `#${give.id}` }
      : undefined;
  // The give section is surfaced as the top-bar button, so keep it out of the link row.
  const navItems = visible.filter((s) => s.type !== "hero" && !(!heroCta && s === give));
  const bodyItems = visible.filter((s) => s.type !== "hero");

  return (
    <>
      <header className="bar">
        <div className="wrap">
          <a className="brand" href="#top">
            {doc.meta.logo ? <img src={options.imageUrl(doc.meta.logo)} alt="" /> : null}
            <span>{doc.meta.orgName}</span>
          </a>
          <nav className="links" aria-label="Sections">
            {navItems.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {"heading" in s && s.heading ? s.heading : s.type}
              </a>
            ))}
          </nav>
          <LanguageSwitcher links={options.languageLinks} />
          {topCta ? <a className="btn sm" href={topCta.href}>{topCta.label}</a> : null}
        </div>
      </header>
      <main id="top">
        {hero?.type === "hero" ? <HeroView hero={hero} doc={doc} options={options} attrs={sectionAttrs(hero)} /> : null}
        {bodyItems.map((s) => (
          <SectionView key={s.id} section={s} options={options} attrs={sectionAttrs(s)} />
        ))}
      </main>
      <footer className="foot">
        <div className="wrap">© {new Date().getFullYear()} {doc.meta.orgName}</div>
      </footer>
    </>
  );
}

function HeroView({
  hero,
  doc,
  options,
  attrs,
}: {
  hero: Extract<Section, { type: "hero" }>;
  doc: SiteDocument;
  options: RenderOptions;
  attrs: Attrs;
}) {
  const style = doc.theme.heroStyle;
  const dark = style !== "split";
  const hasSplitImage = style === "split" && hero.image;
  const classes = ["hero", style, dark ? "dark" : "", hasSplitImage ? "has-img" : ""].filter(Boolean).join(" ");
  return (
    <section className={classes} id={hero.id} {...attrs}>
      {style === "image" && hero.image ? (
        <img className="hero-bg" src={options.imageUrl(hero.image)} alt="" aria-hidden="true" />
      ) : null}
      <div className="wrap">
        <div>
          {doc.meta.tagline ? <span className="eyebrow">{doc.meta.tagline}</span> : null}
          <h1>{hero.heading}</h1>
          {hero.subheading ? <p className="sub">{hero.subheading}</p> : null}
          {hero.primaryCta || hero.secondaryCta ? (
            <div className="actions">
              {hero.primaryCta ? <a className="btn" href={hero.primaryCta.href}>{hero.primaryCta.label}</a> : null}
              {hero.secondaryCta ? <a className="btn ghost" href={hero.secondaryCta.href}>{hero.secondaryCta.label}</a> : null}
            </div>
          ) : null}
        </div>
        {hasSplitImage && hero.image ? (
          <img className="hero-img" src={options.imageUrl(hero.image)} alt={hero.image.alt} />
        ) : null}
      </div>
    </section>
  );
}

function SectionView({
  section: s,
  options,
  attrs,
}: {
  section: Section;
  options: RenderOptions;
  attrs: Attrs;
}) {
  switch (s.type) {
    case "about": {
      const { lead, rest } = splitLead(s.body);
      return (
        <section className="section about" id={s.id} {...attrs}>
          <div className="wrap">
            <div>
              <h2>{s.heading}</h2>
              <p className="pull">{lead}</p>
            </div>
            <div>
              {s.image ? <img src={options.imageUrl(s.image)} alt={s.image.alt} /> : null}
              {rest.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </div>
        </section>
      );
    }
    case "programs":
      return (
        <section className="section programs" id={s.id} {...attrs}>
          <div className="wrap">
            <h2>{s.heading}</h2>
            <div className="cards">
              {s.items.map((it, i) => (
                <article className="card" key={i}>
                  <span className="idx" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  {it.image ? <img src={options.imageUrl(it.image)} alt={it.image.alt} /> : null}
                  <h3>{it.title}</h3>
                  {it.description ? <p>{it.description}</p> : null}
                  {it.link ? <p><a href={it.link.href}>{it.link.label}</a></p> : null}
                </article>
              ))}
            </div>
          </div>
        </section>
      );
    case "events":
      return (
        <section className="section events" id={s.id} {...attrs}>
          <div className="wrap">
            <h2>{s.heading}</h2>
            <ul>
              {s.items.map((it, i) => (
                <li className="ev" key={i}>
                  <div className="when">{it.when}</div>
                  <div>
                    <h3>{it.title}</h3>
                    {it.where ? <div className="where">{it.where}</div> : null}
                    {it.description ? <p>{it.description}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    case "team":
      return (
        <section className="section team" id={s.id} {...attrs}>
          <div className="wrap">
            <h2>{s.heading}</h2>
            <ul className="members">
              {s.members.map((m, i) => (
                <li key={i}>
                  {m.photo ? <img src={options.imageUrl(m.photo)} alt={m.photo.alt || m.name} /> : null}
                  <h3>{m.name}</h3>
                  {m.role ? <div className="role">{m.role}</div> : null}
                  {m.bio ? <p>{m.bio}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    case "stories":
      return (
        <section className="section stories" id={s.id} {...attrs}>
          <div className="wrap">
            <h2>{s.heading}</h2>
            <div className="quotes" role="region" aria-label={s.heading} tabIndex={0}>
              {s.items.map((it, i) => (
                <blockquote key={i}>
                  {it.quote}
                  {it.attribution ? <cite>{it.attribution}</cite> : null}
                </blockquote>
              ))}
            </div>
          </div>
        </section>
      );
    case "give":
      return (
        <section className="section give" id={s.id} {...attrs}>
          <div className="wrap">
            <div className="give-card">
              <h2>{s.heading}</h2>
              {paragraphs(s.body).map((p, i) => <p key={i}>{p}</p>)}
              {s.links.length ? (
                <div className="actions">
                  {s.links.map((l, i) => (
                    <a className="btn" key={i} href={l.href} target="_blank" rel="noopener">{l.label}</a>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      );
    case "contact":
      return (
        <section className="section contact" id={s.id} {...attrs}>
          <div className="wrap">
            <div>
              <h2>{s.heading}</h2>
              <ul className="contact-list">
                {s.email && s.showEmail ? <li><a href={`mailto:${s.email}`}>{s.email}</a></li> : null}
                {s.phone ? <li><a href={`tel:${s.phone}`}>{s.phone}</a></li> : null}
                {s.address ? <li>{s.address}</li> : null}
              </ul>
              {s.social.length ? (
                <div className="social">
                  {s.social.map((l, i) => <a key={i} href={l.href} target="_blank" rel="noopener">{l.label}</a>)}
                </div>
              ) : null}
            </div>
            <ContactForm section={s} options={options} />
          </div>
        </section>
      );
    case "hero":
      return null;
  }
}
