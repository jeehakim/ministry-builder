import type { Section, SiteDocument } from "@ministry/schema";
import type { RenderOptions } from "../types";
import { ContactForm } from "../ContactForm";
import { paragraphs } from "../util";
import { LanguageSwitcher } from "../LanguageSwitcher";

type Props = { doc: SiteDocument; options: RenderOptions };

export function ClassicBody({ doc, options }: Props) {
  const visible = doc.sections.filter((s) => !s.hidden);
  const hero = visible.find((s) => s.type === "hero");
  const navItems = visible.filter((s) => s.type !== "hero");
  const sectionAttrs = (s: Section) =>
    options.editor ? { "data-section-id": s.id } : {};

  return (
    <>
      <header className="wrap site-header">
        <a className="brand" href="#top">
          {doc.meta.logo ? <img src={options.imageUrl(doc.meta.logo)} alt={doc.meta.logo.alt || doc.meta.orgName} /> : null}
          <span>{doc.meta.orgName}</span>
        </a>
        <nav className="site-nav" aria-label="Sections">
          {navItems.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {"heading" in s && s.heading ? s.heading : s.type}
            </a>
          ))}
        </nav>
        <LanguageSwitcher links={options.languageLinks} />
      </header>
      <main id="top">
        {hero && hero.type === "hero" ? (
          <section className={`hero ${doc.theme.heroStyle}`} id={hero.id} {...sectionAttrs(hero)}>
            {doc.theme.heroStyle === "image" && hero.image ? (
              <img className="hero-bg" src={options.imageUrl(hero.image)} alt="" aria-hidden="true" />
            ) : null}
            <div className="wrap">
              <div>
                <h1>{hero.heading}</h1>
                {hero.subheading ? <p className="sub">{hero.subheading}</p> : null}
                {hero.primaryCta ? (
                  <a className="cta primary" href={hero.primaryCta.href}>{hero.primaryCta.label}</a>
                ) : null}
                {hero.secondaryCta ? (
                  <a className="cta secondary" href={hero.secondaryCta.href}>{hero.secondaryCta.label}</a>
                ) : null}
              </div>
              {doc.theme.heroStyle === "split" && hero.image ? (
                <img src={options.imageUrl(hero.image)} alt={hero.image.alt} />
              ) : null}
            </div>
          </section>
        ) : null}

        {navItems.map((s) => (
          <SectionView key={s.id} section={s} doc={doc} options={options} attrs={sectionAttrs(s)} />
        ))}
      </main>
      <footer className="site-footer wrap">
        © {new Date().getFullYear()} {doc.meta.orgName}
        {doc.meta.tagline ? ` · ${doc.meta.tagline}` : ""}
      </footer>
    </>
  );
}

function SectionView({
  section: s,
  options,
  attrs,
}: {
  section: Section;
  doc: SiteDocument;
  options: RenderOptions;
  attrs: Record<string, string | undefined>;
}) {
  switch (s.type) {
    case "about":
      return (
        <section className={`section about${s.image ? " has-image" : ""}`} id={s.id} {...attrs}>
          <div className="wrap">
            <div>
              <h2>{s.heading}</h2>
              {paragraphs(s.body).map((p, i) => <p key={i}>{p}</p>)}
            </div>
            {s.image ? <img src={options.imageUrl(s.image)} alt={s.image.alt} /> : null}
          </div>
        </section>
      );
    case "programs":
      return (
        <section className="section programs" id={s.id} {...attrs}>
          <div className="wrap">
            <h2>{s.heading}</h2>
            <div className="grid cols-3">
              {s.items.map((it, i) => (
                <div className="card" key={i}>
                  {it.image ? <img src={options.imageUrl(it.image)} alt={it.image.alt} /> : null}
                  <h3>{it.title}</h3>
                  {it.description ? <p>{it.description}</p> : null}
                  {it.link ? <a href={it.link.href}>{it.link.label}</a> : null}
                </div>
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
            <div className="grid">
              {s.items.map((it, i) => (
                <div className="card event" key={i}>
                  <h3>{it.title}</h3>
                  {it.when ? <div className="when">{it.when}</div> : null}
                  {it.where ? <div className="where">{it.where}</div> : null}
                  {it.description ? <p>{it.description}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    case "team":
      return (
        <section className="section team" id={s.id} {...attrs}>
          <div className="wrap">
            <h2>{s.heading}</h2>
            <div className="grid cols-3">
              {s.members.map((m, i) => (
                <div className="card" key={i}>
                  {m.photo ? <img src={options.imageUrl(m.photo)} alt={m.photo.alt || m.name} /> : null}
                  <h3>{m.name}</h3>
                  {m.role ? <div className="role">{m.role}</div> : null}
                  {m.bio ? <p>{m.bio}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    case "stories":
      return (
        <section className="section stories" id={s.id} {...attrs}>
          <div className="wrap">
            <h2>{s.heading}</h2>
            <div className="grid">
              {s.items.map((it, i) => (
                <blockquote key={i}>
                  {it.quote}
                  {it.attribution ? <footer>— {it.attribution}</footer> : null}
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
            <h2>{s.heading}</h2>
            {paragraphs(s.body).map((p, i) => <p key={i}>{p}</p>)}
            {s.links.map((l, i) => (
              <a className="cta primary" key={i} href={l.href} target="_blank" rel="noopener">{l.label}</a>
            ))}
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
                {s.email ? <li><a href={`mailto:${s.email}`}>{s.email}</a></li> : null}
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
