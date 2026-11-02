import type { Theme } from "@ministry/schema";
import { themeVars } from "../util";

/** Black or white, whichever reads better on `color`. Anything that is not a hex color falls back to near-black. */
function onColor(color: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  const digits = m?.[1];
  if (!digits) return "#111";
  const hex = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.179 ? "#111" : "#fff";
}

export function boldCss(theme: Theme): string {
  return `${themeVars(theme)}
:root{--on-accent:${onColor(theme.accent)};--on-primary:${onColor(theme.primary)};--deep:#14202e;--veil:linear-gradient(100deg,rgba(20,32,46,.95),rgba(20,32,46,.88))}
@supports (color:color-mix(in srgb,red,blue)){:root{--deep:color-mix(in srgb,var(--primary) 38%,#000);--veil:linear-gradient(100deg,color-mix(in srgb,var(--deep) 95%,transparent),color-mix(in srgb,var(--deep) 88%,transparent))}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
@media(prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}.btn,.links a,.lang-switch a{transition:background-color .2s,color .2s,opacity .2s,filter .2s}}
body{margin:0;font-family:var(--body-font);color:var(--text);background:var(--bg);line-height:1.65;font-size:17px}
img{max-width:100%;height:auto;display:block}
a{color:var(--primary)}
h1,h2,h3{font-family:var(--heading-font);line-height:1.1;letter-spacing:-.025em;margin:0 0 .5em;text-wrap:balance}
h1{font-size:clamp(2.6rem,6vw,4.5rem);line-height:1.02;letter-spacing:-.035em}
h2{font-size:clamp(1.9rem,4.2vw,3rem)}
h3{font-size:1.2rem;letter-spacing:-.01em;line-height:1.25}
p{margin:0 0 1em}
:focus-visible{outline:3px solid var(--primary);outline-offset:3px}
.hero :focus-visible{outline-color:#fff}
.give :focus-visible{outline-color:var(--on-primary)}
.wrap{max-width:1160px;margin:0 auto;padding:0 24px}
.bar{border-bottom:1px solid color-mix(in srgb,var(--text) 12%,transparent)}
.bar .wrap{display:flex;flex-wrap:wrap;align-items:center;gap:2px 20px;padding-top:10px;padding-bottom:6px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);font-family:var(--heading-font);font-weight:800;font-size:1.05rem;letter-spacing:-.01em}
.brand img{height:32px;width:auto}
.links{order:3;flex:1 0 100%;min-width:0;display:flex;gap:22px;overflow-x:auto;white-space:nowrap;font-size:.9rem;padding:4px}
.links a{color:var(--text);text-decoration:none;opacity:.8;padding:2px 0}
.links a:hover{opacity:1;text-decoration:underline;text-underline-offset:5px}
.links a:focus-visible{outline-width:2px;outline-offset:1px}
.lang-switch{display:flex;gap:2px;font-size:.8rem}
.lang-switch a{padding:6px 10px;border-radius:999px;text-decoration:none;color:inherit;opacity:.75}
.lang-switch a:hover{opacity:1}
.lang-switch a[aria-current]{background:color-mix(in srgb,var(--primary) 12%,transparent);opacity:1;font-weight:700}
.bar .lang-switch{order:2;margin-left:auto}
@media(min-width:860px){.bar .wrap{flex-wrap:nowrap;padding-top:14px;padding-bottom:14px}.links{order:0;flex:0 1 auto;margin-left:auto}.bar .lang-switch{order:0}.links+.lang-switch{margin-left:0}}
.btn{display:inline-block;padding:14px 26px;border-radius:var(--radius);font:inherit;font-weight:700;line-height:1.2;text-decoration:none;border:2px solid var(--accent);background:var(--accent);color:var(--on-accent);cursor:pointer}
.btn:hover{filter:brightness(1.08)}
.btn.ghost{background:transparent;border-color:#fff;color:#fff}
.btn.ghost:hover{background:rgba(255,255,255,.14);filter:none}
.actions{display:flex;flex-wrap:wrap;gap:12px}
.hero{position:relative;overflow:hidden;color:#fff;background:var(--deep);padding:88px 0 96px}
.hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero.image::before{content:"";position:absolute;inset:0;z-index:1;background:var(--veil)}
.hero .wrap{position:relative;z-index:2;display:grid;gap:48px;align-items:center}
.eyebrow{display:block;margin-bottom:22px;font-size:.8rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:color-mix(in srgb,var(--accent) 55%,#fff)}
.eyebrow::after{content:"";display:block;width:56px;height:3px;margin-top:14px;background:currentColor}
.hero h1{max-width:16em;margin-bottom:.4em}
.hero .sub{max-width:38rem;margin:0;font-size:clamp(1.1rem,2vw,1.35rem);color:rgba(255,255,255,.92)}
.hero .actions{margin-top:36px}
.hero-img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius)}
.section{padding:72px 0}
@media(min-width:860px){.hero{padding:144px 0 152px}.hero.has-img .wrap{grid-template-columns:1.15fr .85fr;gap:72px}.section{padding:120px 0}}
.section>.wrap>h2{margin-bottom:1.2em}
.about>.wrap>h2{margin-bottom:28px;font-size:.85rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--primary)}
.lead{margin:0 0 56px;font-family:var(--heading-font);font-size:clamp(1.7rem,4.2vw,3rem);font-weight:700;line-height:1.18;letter-spacing:-.025em}
.cols{display:grid;gap:40px;align-items:start}
.cols .copy{max-width:40rem}
.cols img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius)}
@media(min-width:860px){.cols.has-img{grid-template-columns:1fr 1fr;gap:80px}}
.programs{background:color-mix(in srgb,var(--text) 5%,var(--bg))}
.cards{display:grid;gap:20px}
@media(min-width:640px){.cards{grid-template-columns:repeat(2,1fr)}}
@media(min-width:980px){.cards{grid-template-columns:repeat(3,1fr);gap:24px}}
.card{background:var(--bg);border-radius:var(--radius);overflow:hidden}
.card img{width:100%;aspect-ratio:16/9;object-fit:cover}
.card .in{padding:28px}
.idx{display:block;margin-bottom:16px;font-family:var(--heading-font);font-size:3.5rem;font-weight:800;line-height:1;letter-spacing:-.05em;color:var(--accent)}
.card p{opacity:.85}
.card p:last-child{margin-bottom:0}
.evs{list-style:none;margin:0;padding:0;display:grid;gap:0 64px}
@media(min-width:760px){.evs{grid-template-columns:repeat(2,1fr)}}
.ev{padding:28px 0;border-top:1px solid color-mix(in srgb,var(--text) 25%,transparent)}
.pill{display:inline-block;margin-bottom:14px;padding:6px 14px;border-radius:999px;background:var(--primary);color:var(--on-primary);font-size:.85rem;font-weight:700;line-height:1.3}
.ev h3{margin-bottom:.25em;font-size:1.35rem}
.where{font-size:.95rem;opacity:.75}
.ev p{margin:.6em 0 0}
.members{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,1fr);gap:40px 20px;text-align:center}
@media(min-width:860px){.members{grid-template-columns:repeat(4,1fr);gap:56px 32px}}
.members img{width:min(100%,180px);aspect-ratio:1;object-fit:cover;border-radius:50%;margin:0 auto 18px}
.members h3{margin:0 0 .2em;font-size:1.1rem}
.role{font-size:.9rem;opacity:.75}
.members p{margin:.6em 0 0;font-size:.92rem;opacity:.85}
.quotes{display:grid;gap:48px}
@media(min-width:760px){.quotes{grid-template-columns:repeat(2,1fr);gap:56px 64px}}
.quotes blockquote{margin:0;font-size:1.2rem;line-height:1.5}
.quotes blockquote::before{content:"\\201C";content:"\\201C"/"";display:block;height:3.2rem;font-family:var(--heading-font);font-size:5.5rem;font-weight:800;line-height:1;color:var(--accent)}
.quotes blockquote p{margin:0}
.quotes cite{display:block;margin-top:18px;font-size:.9rem;font-style:normal;font-weight:700;opacity:.75}
.give{background:var(--primary);color:var(--on-primary)}
.give .wrap{display:grid;gap:32px;align-items:center}
.give h2{margin-bottom:.4em}
.give p:last-child{margin-bottom:0}
@media(min-width:860px){.give .wrap{grid-template-columns:1.4fr 1fr;gap:72px}.give .actions{justify-content:flex-end}}
.stats{list-style:none;margin:0 0 40px;padding:0;display:grid;gap:24px 32px;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.stat{padding-top:16px;border-top:3px solid var(--accent);font-family:var(--heading-font);font-size:clamp(1.2rem,2.4vw,1.6rem);font-weight:700;line-height:1.25;letter-spacing:-.02em;overflow-wrap:anywhere}
.stat.addr{white-space:pre-line}
.stat a{color:inherit;text-decoration:none}
.stat a:hover{color:var(--primary);text-decoration:underline;text-underline-offset:5px}
.social{display:flex;flex-wrap:wrap;gap:8px 24px;margin:0 0 40px}
.form{display:grid;gap:12px;max-width:640px}
.form input,.form textarea{width:100%;padding:14px 16px;border:1px solid color-mix(in srgb,var(--text) 50%,transparent);border-radius:calc(var(--radius) * .6);font:inherit;color:var(--text);background:var(--bg)}
.form button{justify-self:start}
.foot{padding:32px 0;border-top:1px solid color-mix(in srgb,var(--text) 12%,transparent);font-size:.9rem}
.foot .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 32px}
.foot p{margin:0;opacity:.8}
.foot p span::before{content:"\\00B7";margin:0 .6em}
`;
}
