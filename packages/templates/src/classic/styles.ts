import type { Theme } from "@ministry/schema";
import { themeVars } from "../util";
import { CONTACT_FORM_CSS } from "../ContactForm";

export function classicCss(theme: Theme): string {
  return `${themeVars(theme)}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--body-font);color:var(--text);background:var(--bg);line-height:1.6;font-size:17px}
img{max-width:100%;height:auto;display:block}
a{color:var(--primary)}
h1,h2,h3{font-family:var(--heading-font);line-height:1.2;margin:0 0 .5em}
h1{font-size:clamp(2rem,5vw,3.25rem)}
h2{font-size:clamp(1.5rem,3.5vw,2.25rem)}
h3{font-size:1.2rem}
p{margin:0 0 1em}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
.site-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;font-weight:700;font-family:var(--heading-font);font-size:1.15rem}
.brand img{height:44px;width:auto}
.site-nav{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:.95rem}
.site-nav a{text-decoration:none;color:inherit;opacity:.85}
.site-nav a:hover{opacity:1;text-decoration:underline}
.lang-switch{display:flex;gap:4px;font-size:.85rem}
.lang-switch a{padding:4px 8px;border-radius:999px;text-decoration:none;color:inherit;opacity:.75}
.lang-switch a[aria-current]{background:rgba(0,0,0,.08);opacity:1;font-weight:600}
.section{padding:64px 0}
.section + .section{border-top:1px solid rgba(0,0,0,.06)}
.hero{position:relative;color:#fff;background:var(--primary);padding:96px 0}
.hero.image{background:#222}
.hero.image .hero-bg{position:absolute;inset:0;object-fit:cover;width:100%;height:100%;opacity:.55}
.hero .wrap{position:relative}
.hero p.sub{font-size:1.25rem;max-width:40rem;opacity:.95}
.hero.split .wrap{display:grid;gap:32px;align-items:center}
@media(min-width:800px){.hero.split .wrap{grid-template-columns:1.1fr .9fr}}
.hero.split img{border-radius:var(--radius)}
.cta{display:inline-block;padding:12px 22px;border-radius:var(--radius);font-weight:600;text-decoration:none;margin:8px 10px 0 0}
.cta.primary{background:var(--accent);color:#111}
.cta.secondary{border:2px solid #fff;color:#fff}
.about .wrap{display:grid;gap:32px;align-items:center}
@media(min-width:800px){.about.has-image .wrap{grid-template-columns:1fr 1fr}}
.about img{border-radius:var(--radius)}
.grid{display:grid;gap:24px}
@media(min-width:640px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:960px){.grid.cols-3{grid-template-columns:repeat(3,1fr)}}
.card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:var(--radius);padding:20px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.card img{border-radius:var(--radius);margin-bottom:12px;aspect-ratio:4/3;object-fit:cover}
.event .when{font-weight:600;color:var(--primary)}
.event .where{opacity:.75;font-size:.95rem}
.team .card{text-align:center}
.team img{width:140px;height:140px;border-radius:50%;object-fit:cover;margin:0 auto 12px}
.team .role{opacity:.75;font-size:.95rem}
blockquote{margin:0;padding:20px 24px;border-left:4px solid var(--accent);background:rgba(0,0,0,.03);border-radius:var(--radius);font-style:italic}
blockquote footer{margin-top:8px;font-style:normal;opacity:.75}
.give{background:var(--primary);color:#fff;text-align:center}
.give .cta.primary{margin-top:12px}
.contact .wrap{display:grid;gap:32px}
@media(min-width:800px){.contact .wrap{grid-template-columns:1fr 1fr}}
.contact-list{list-style:none;padding:0;margin:0}
.contact-list li{margin-bottom:8px}
.social{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
.site-footer{padding:32px 0;font-size:.9rem;opacity:.7;text-align:center}
.hidden{display:none}

${CONTACT_FORM_CSS}`;
}
