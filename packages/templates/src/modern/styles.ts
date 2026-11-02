import type { Theme } from "@ministry/schema";
import { themeVars } from "../util";
import { CONTACT_FORM_CSS } from "../ContactForm";

export function modernCss(theme: Theme): string {
  return `${themeVars(theme)}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
@media(prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;font-family:var(--body-font);color:var(--text);background:var(--bg);line-height:1.65;font-size:17px}
img{max-width:100%;height:auto;display:block}
a{color:var(--primary)}
h1,h2,h3{font-family:var(--heading-font);line-height:1.1;letter-spacing:-.02em;margin:0 0 .5em}
h1{font-size:clamp(2.25rem,7vw,4rem)}
h2{font-size:clamp(1.75rem,4vw,2.5rem)}
h3{font-size:1.2rem;letter-spacing:-.01em;line-height:1.25}
p{margin:0 0 1em}
:focus-visible{outline:3px solid var(--primary);outline-offset:3px}
.dark :focus-visible{outline-color:#fff}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
section[id]{scroll-margin-top:96px}
.bar{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 94%,transparent);border-bottom:1px solid color-mix(in srgb,var(--text) 10%,transparent)}
.bar .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 20px;padding-top:10px;padding-bottom:10px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);font-family:var(--heading-font);font-weight:700;font-size:1.1rem;letter-spacing:-.01em}
.brand img{height:36px;width:auto}
.links{order:3;flex:1 0 100%;display:flex;gap:20px;overflow-x:auto;white-space:nowrap;font-size:.92rem;padding:2px 0 6px}
.links a{color:var(--text);text-decoration:none;opacity:.75}
.links a:hover{opacity:1;text-decoration:underline;text-underline-offset:4px}
@media(min-width:860px){.links{order:0;flex:1 1 auto;justify-content:flex-end;padding:0}}
.btn{display:inline-block;padding:12px 22px;border-radius:var(--radius);font-weight:600;text-decoration:none;border:2px solid var(--primary);background:var(--primary);color:#fff;line-height:1.2}
.btn:hover{filter:brightness(1.12)}
.btn.ghost{background:transparent;color:var(--primary)}
.btn.sm{padding:8px 16px;font-size:.92rem}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.hero{padding:72px 0 80px}
.hero .wrap{display:grid;gap:40px;align-items:center}
.eyebrow{display:block;font-size:.8rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--primary);margin-bottom:18px}
.sub{font-size:1.2rem;max-width:36rem;opacity:.85;margin:0}
.hero-img{border-radius:var(--radius);aspect-ratio:4/3;object-fit:cover;width:100%;box-shadow:0 24px 48px -24px color-mix(in srgb,var(--text) 45%,transparent)}
@media(min-width:860px){.hero{padding:104px 0 112px}.hero.split.has-img .wrap{grid-template-columns:1.1fr .9fr;gap:64px}}
.hero.image,.hero.solid{color:#fff}
.hero.image{position:relative;background:color-mix(in srgb,var(--primary) 55%,#000)}
.hero.image .hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero.image::before{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(90deg,rgba(0,0,0,.82),rgba(0,0,0,.5) 70%,rgba(0,0,0,.35))}
.hero.image .wrap{position:relative;z-index:2}
.hero.solid{background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 78%,#fff))}
.hero.dark .eyebrow{color:color-mix(in srgb,var(--accent) 60%,#fff)}
.hero.dark .sub{opacity:.95}
.hero.dark .btn{background:#fff;border-color:#fff;color:#111}
.hero.dark .btn.ghost{background:transparent;color:#fff}
.section{padding:72px 0}
.section>.wrap>h2{margin-bottom:1em}
.about .wrap{display:grid;gap:28px}
.pull{font-family:var(--heading-font);font-size:clamp(1.4rem,3vw,1.9rem);line-height:1.3;letter-spacing:-.01em;margin:0;padding-left:20px;border-left:4px solid var(--accent)}
.about img{border-radius:var(--radius);margin-bottom:24px;width:100%;aspect-ratio:16/10;object-fit:cover}
@media(min-width:860px){.about .wrap{grid-template-columns:1fr 1fr;gap:64px;align-items:start}}
.cards{display:grid;gap:20px}
@media(min-width:640px){.cards{grid-template-columns:repeat(2,1fr)}}
@media(min-width:980px){.cards{grid-template-columns:repeat(3,1fr)}}
.card{border:1px solid color-mix(in srgb,var(--text) 12%,transparent);border-radius:var(--radius);padding:24px;background:color-mix(in srgb,var(--text) 3%,var(--bg))}
.card img{border-radius:calc(var(--radius) * .6);aspect-ratio:16/10;object-fit:cover;width:100%;margin-bottom:16px}
.idx{display:block;font-family:var(--heading-font);font-size:3rem;font-weight:800;line-height:1;letter-spacing:-.04em;color:var(--accent);margin-bottom:14px}
.card p{opacity:.85}
.card p:last-child{margin-bottom:0}
.events ul,.contact-list{list-style:none;margin:0;padding:0}
.ev{display:grid;gap:4px 32px;padding:22px 0;border-top:1px solid color-mix(in srgb,var(--text) 14%,transparent)}
.ev:last-child{border-bottom:1px solid color-mix(in srgb,var(--text) 14%,transparent)}
.when{font-weight:700;color:var(--primary)}
.ev h3{margin-bottom:.2em}
.where{opacity:.7;font-size:.95rem}
.ev p{margin:.5em 0 0}
@media(min-width:760px){.ev{grid-template-columns:200px 1fr}}
.members{list-style:none;margin:0;padding:0;display:grid;gap:28px 20px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.members img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius);margin-bottom:12px}
.members h3{margin:0;font-size:1.05rem}
.role{opacity:.7;font-size:.9rem}
.members p{font-size:.92rem;margin:.5em 0 0;opacity:.85}
.quotes{display:flex;gap:20px;overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:12px}
.quotes blockquote{flex:0 0 min(320px,82%);scroll-snap-align:start;margin:0;padding:28px;border-radius:var(--radius);background:color-mix(in srgb,var(--primary) 8%,var(--bg));font-size:1.05rem}
.quotes blockquote::before{content:"\\201C";display:block;font-family:var(--heading-font);font-size:3rem;line-height:.8;color:var(--accent)}
.quotes cite{display:block;margin-top:16px;font-style:normal;font-size:.9rem;font-weight:600;opacity:.75}
.give-card{max-width:680px;margin:0 auto;text-align:center;padding:48px 28px;border:3px solid var(--accent);border-radius:var(--radius)}
.give-card h2{margin-bottom:.4em}
.give-card .actions{justify-content:center}
.contact .wrap{display:grid;gap:40px}
@media(min-width:860px){.contact .wrap{grid-template-columns:1fr 1fr;gap:64px}}
.contact-list li{margin-bottom:10px}
.social{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:20px}
.foot{padding:32px 0;border-top:1px solid color-mix(in srgb,var(--text) 10%,transparent);font-size:.9rem;opacity:.75}

.lang-switch{display:flex;gap:2px;font-size:.8rem;margin-left:auto}
.lang-switch a{padding:4px 8px;border-radius:999px;text-decoration:none;color:inherit;opacity:.7}
.lang-switch a[aria-current]{background:color-mix(in oklch, var(--primary) 12%, transparent);opacity:1;font-weight:600}

${CONTACT_FORM_CSS}`;
}
