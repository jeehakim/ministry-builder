import type { Section, SiteDocument } from "@ministry/schema";
import type { RenderOptions } from "../types";
import { ContactForm } from "../ContactForm";
import { paragraphs } from "../util";
import { LanguageSwitcher } from "../LanguageSwitcher";

type Props = { doc: SiteDocument; options: RenderOptions };
type Attrs = Record<string, string | undefined>;

/** Splits the body into a lead sentence (for the oversized first line) and the remaining paragraphs. */
function splitLead(body: string): { lead: string; rest: string[] } {
  const [first = "", ...others] = paragraphs(body);
  const m = first.match(/^([\s\S]+?(?:[.!?](?=\s|$)|[。！？]))\s*([\s\S]*)$/);
  if (!m) return { lead: first, rest: others };
  return { lead: m[1] ?? first, rest: [m[2] ?? "", ...others].filter(Boolean) };
}

export function BoldBody({ doc, options }: Props) {
  const visible = doc.sections.filter((s) => !s.hidden);
  const hero = visible.find((s) => s.type === "hero");
  const bodyItems = visible.filter((s) => s.type !== "hero");
  const sectionAttrs = (s: Section): Attrs => (options.editor ? { "data-section-id": s.id } : {});

  return (
    <>
      <header className="bar">
        <div className="wrap">
          <a className="brand" href="#top">
            {doc.meta.logo ? <img src={options.imageUrl(doc.meta.logo)} alt="" /> : null}
            <span>{doc.meta.orgName}</span>
          </a>
          {bodyItems.length ? (
            <nav className="links" aria-label="Sections">
              {bodyItems.map((s) => (
                <a key={s.id} href={`#${s.id}`}>
                  {"heading" in s && s.heading ? s.heading : s.type}
                </a>
              ))}
            </nav>
          ) : null}
          <LanguageSwitcher links={options.languageLinks} />
        </div>
      </header>
      <main id="top">
        {hero?.type === "hero" ? <HeroView hero={hero} doc={doc} options={options} attrs={sectionAttrs(hero)} /> : null}
        {bodyItems.map((s) => (
          <SectionView key={s.id} section={s} options={options} attrs={sectionAttrs(s)} />
        ))}
      </main>
      <footer className="foot">
        <div className="wrap">
          <p>
            <strong>{doc.meta.orgName}</strong>
            {doc.meta.tagline ? <span>{doc.meta.tagline}</span> : null}
            <span>© {new Date().getFullYear()}</span>
          </p>
          <LanguageSwitcher links={options.languageLinks} />
        </div>
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
  const splitImage = style === "split" ? hero.image : undefined;
  const classes = ["hero", style, splitImage ? "has-img" : ""].filter(Boolean).join(" ");
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
        {splitImage ? <img className="hero-img" src={options.imageUrl(splitImage)} alt={splitImage.alt} /> : null}
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
            <h2>{s.heading}</h2>
            <p className="lead">{lead}</p>
            {rest.length || s.image ? (
              <div className={`cols${s.image ? " has-img" : ""}`}>
                <div className="copy">{rest.map((p, i) => <p key={i}>{p}</p>)}</div>
                {s.image ? <img src={options.imageUrl(s.image)} alt={s.image.alt} /> : null}
              </div>
            ) : null}
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
                  {it.image ? <img src={options.imageUrl(it.image)} alt={it.image.alt} /> : null}
                  <div className="in">
                    <span className="idx" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                    <h3>{it.title}</h3>
                    {it.description ? <p>{it.description}</p> : null}
                    {it.link ? <p><a href={it.link.href}>{it.link.label}</a></p> : null}
                  </div>
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
            <ul className="evs">
              {s.items.map((it, i) => (
                <li className="ev" key={i}>
                  {it.when ? <span className="pill">{it.when}</span> : null}
                  <h3>{it.title}</h3>
                  {it.where ? <div className="where">{it.where}</div> : null}
                  {it.description ? <p>{it.description}</p> : null}
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
            <div className="quotes">
              {s.items.map((it, i) => (
                <blockquote key={i}>
                  <p>{it.quote}</p>
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
            <div>
              <h2>{s.heading}</h2>
              {paragraphs(s.body).map((p, i) => <p key={i}>{p}</p>)}
            </div>
            {s.links.length ? (
              <div className="actions">
                {s.links.map((l, i) => (
                  <a className="btn" key={i} href={l.href} target="_blank" rel="noopener">{l.label}</a>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      );
    case "contact":
      return (
        <section className="section contact" id={s.id} {...attrs}>
          <div className="wrap">
            <h2>{s.heading}</h2>
            {(s.email && s.showEmail) || s.phone || s.address ? (
              <ul className="stats">
                {s.email && s.showEmail ? <li className="stat"><a href={`mailto:${s.email}`}>{s.email}</a></li> : null}
                {s.phone ? <li className="stat"><a href={`tel:${s.phone}`}>{s.phone}</a></li> : null}
                {s.address ? <li className="stat addr">{s.address}</li> : null}
              </ul>
            ) : null}
            {s.social.length ? (
              <div className="social">
                {s.social.map((l, i) => <a key={i} href={l.href} target="_blank" rel="noopener">{l.label}</a>)}
              </div>
            ) : null}
            <ContactForm section={s} options={options} />
          </div>
        </section>
      );
    case "hero":
      return null;
  }
}
