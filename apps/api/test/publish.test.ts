import { emptySiteDocument } from "@ministry/schema";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import realApp from "../src/index";
import { call, jsonInit, makeSite, PNG_BYTES, uploadPng } from "./helpers";

const HOST = "sites.shofar.io";

/** Requests go through the real app so the hosting handler runs first, exactly as in production. */
function hosted(url: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(realApp.request(url, init, env));
}

async function siteWithImage(user: string, orgName: string) {
  const site = await makeSite(user, orgName);
  const image = await uploadPng(user, site.id);
  const doc = emptySiteDocument(orgName);
  const hero = doc.sections.find((s) => s.type === "hero");
  if (hero?.type === "hero") hero.image = { src: `/assets/${image.key}`, alt: "Hero" };
  const about = doc.sections.find((s) => s.type === "about");
  if (about?.type === "about") about.image = { src: "https://example.org/remote.jpg", alt: "Remote" };
  const put = await call(user, `/sites/${site.id}/document`, jsonInit("PUT", doc));
  expect(put.status).toBe(200);
  return { site, image, file: image.key.slice(image.key.lastIndexOf("/") + 1) };
}

describe("publish", () => {
  it("writes index.html and images to PUBLISHED, drops stale images, and returns the public URL", async () => {
    const { site, image, file } = await siteWithImage("pub_a", "Publish Org");
    await env.PUBLISHED.put(`published/${site.id}/images/stale.png`, "old");
    await env.PUBLISHED.put(`published/other-site/images/keep.png`, "other");

    const res = await call("pub_a", `/sites/${site.id}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; publishedAt: string };
    expect(body.url).toBe(`https://${HOST}/${site.slug}/`);
    expect(Number.isNaN(Date.parse(body.publishedAt))).toBe(false);

    const index = await env.PUBLISHED.get(`published/${site.id}/index.html`);
    expect(index?.httpMetadata?.contentType).toBe("text/html; charset=utf-8");
    const html = await index!.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Publish Org");
    expect(html).toContain(`images/${file}`);
    expect(html).not.toContain(image.key);
    expect(html).toContain("https://example.org/remote.jpg");

    const copied = await env.PUBLISHED.get(`published/${site.id}/images/${file}`);
    expect(copied?.httpMetadata?.contentType).toBe("image/png");
    expect(new Uint8Array(await copied!.arrayBuffer())).toEqual(PNG_BYTES);
    expect(await env.PUBLISHED.head(`published/${site.id}/images/stale.png`)).toBeNull();
    expect(await env.PUBLISHED.head(`published/other-site/images/keep.png`)).not.toBeNull();
    // Publishing never writes into the uploads bucket.
    expect(await env.IMAGES.head(`published/${site.id}/index.html`)).toBeNull();

    const detail = (await (await call("pub_a", `/sites/${site.id}`)).json()) as {
      site: { status: string; publishedUrl: string | null; publishedAt: string | null };
    };
    expect(detail.site).toMatchObject({ status: "published", publishedUrl: body.url, publishedAt: body.publishedAt });
    const list = (await (await call("pub_a", "/sites")).json()) as { sites: { id: string; publishedUrl: string | null }[] };
    expect(list.sites.find((s) => s.id === site.id)?.publishedUrl).toBe(body.url);
  });

  it("does not let other users publish and reports drafts as unpublished", async () => {
    const site = await makeSite("pub_b", "Not Yours");
    expect((await call("pub_c", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(404);
    const detail = (await (await call("pub_b", `/sites/${site.id}`)).json()) as {
      site: { status: string; publishedUrl: string | null; publishedAt: string | null };
    };
    expect(detail.site).toMatchObject({ status: "draft", publishedUrl: null, publishedAt: null });
  });

  it("does not copy another site's uploads into the bundle", async () => {
    const victim = await makeSite("pub_d", "Victim");
    const victimImage = await uploadPng("pub_d", victim.id);
    const attacker = await makeSite("pub_e", "Attacker");
    const doc = emptySiteDocument("Attacker");
    const hero = doc.sections[0];
    if (hero?.type === "hero") hero.image = { src: `/assets/${victimImage.key}`, alt: "" };
    await call("pub_e", `/sites/${attacker.id}/document`, jsonInit("PUT", doc));

    expect((await call("pub_e", `/sites/${attacker.id}/publish`, { method: "POST" })).status).toBe(200);
    const leftovers = await env.PUBLISHED.list({ prefix: `published/${attacker.id}/images/` });
    expect(leftovers.objects).toHaveLength(0);
  });
});

describe("hosting handler", () => {
  it("serves the index and images of a published site with the right cache headers", async () => {
    const { site, file } = await siteWithImage("host_a", "Hosted Org");
    await call("host_a", `/sites/${site.id}/publish`, { method: "POST" });

    const page = await hosted(`https://${HOST}/${site.slug}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("cache-control")).toBe("public, max-age=60");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await page.text()).toContain("Hosted Org");

    const image = await hosted(`https://${HOST}/${site.slug}/images/${file}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG_BYTES);

    const etag = page.headers.get("etag") ?? "";
    expect((await hosted(`https://${HOST}/${site.slug}/`, { headers: { "if-none-match": etag } })).status).toBe(304);
  });

  it("redirects /<slug> and the bare host, and serves the subdomain form", async () => {
    const { site } = await siteWithImage("host_b", "Redirect Org");
    await call("host_b", `/sites/${site.id}/publish`, { method: "POST" });

    const slash = await hosted(`https://${HOST}/${site.slug}`, { redirect: "manual" });
    expect(slash.status).toBe(301);
    expect(slash.headers.get("location")).toBe(`/${site.slug}/`);

    const root = await hosted(`https://${HOST}/`, { redirect: "manual" });
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("https://build.shofar.io");

    const sub = await hosted(`https://${site.slug}.${HOST}/`);
    expect(sub.status).toBe(200);
    expect(await sub.text()).toContain("Redirect Org");
  });

  it("answers 404 HTML for unknown, unpublished, unsafe and unexpected paths", async () => {
    const draft = await makeSite("host_c", "Draft Org");
    const { site, image } = await siteWithImage("host_c", "Live Org");
    await call("host_c", `/sites/${site.id}/publish`, { method: "POST" });

    const cases = [
      `https://${HOST}/${draft.slug}/`,
      `https://${HOST}/no-such-site/`,
      `https://${HOST}/${site.slug}/secret.txt`,
      `https://${HOST}/${site.slug}/images/missing.png`,
      `https://${HOST}/${site.slug}/images/..%2Findex.html`,
      // Uploads live in IMAGES, which the hosting handler never reads.
      `https://${HOST}/${site.slug}/${image.key}`,
      `https://${HOST}//${site.slug}/`,
      `https://${draft.slug}.${HOST}/`,
    ];
    for (const url of cases) {
      const res = await hosted(url);
      expect(res.status, url).toBe(404);
      expect(res.headers.get("content-type"), url).toBe("text/html; charset=utf-8");
      expect(res.headers.get("x-content-type-options"), url).toBe("nosniff");
    }
    expect((await hosted(`https://${HOST}/${site.slug}/`, { method: "POST" })).status).toBe(405);
  });

  it("leaves the API host alone", async () => {
    const res = await hosted("https://api.build.shofar.io/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

/** A Korean-primary site with a hero image, translated to English by the (fake) AI route. */
async function translatedSite(user: string, orgName: string) {
  const site = await makeSite(user, orgName);
  const image = await uploadPng(user, site.id);
  const doc = emptySiteDocument(orgName);
  doc.meta.language = "ko";
  doc.meta.tagline = "작은 교회";
  const hero = doc.sections.find((s) => s.type === "hero");
  if (hero?.type === "hero") hero.image = { src: `/assets/${image.key}`, alt: "Hero" };
  expect((await call(user, `/sites/${site.id}/document`, jsonInit("PUT", doc))).status).toBe(200);
  expect((await call(user, `/sites/${site.id}/ai/translate`, jsonInit("POST", { language: "en" }))).status).toBe(200);
  return { site, doc, file: image.key.slice(image.key.lastIndexOf("/") + 1) };
}

async function pageText(siteId: string, path: string): Promise<string> {
  const object = await env.PUBLISHED.get(`published/${siteId}/${path}`);
  expect(object, path).not.toBeNull();
  return object!.text();
}

describe("multi-language publish", () => {
  it("writes the primary page at the root and each other language under /<lang>/, sharing one images folder", async () => {
    const { site, file } = await translatedSite("lang_a", "Language Org");
    const res = await call("lang_a", `/sites/${site.id}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toBe(`https://${HOST}/${site.slug}/`);

    const primary = await pageText(site.id, "index.html");
    expect(primary).toContain('<html lang="ko">');
    expect(primary).toContain("작은 교회");
    expect(primary).not.toContain("[en] ");
    expect(primary).toContain(`images/${file}`);
    expect(primary).not.toContain(`../images/${file}`);
    expect(primary).toContain('<link rel="alternate" hreflang="ko" href="./">');
    expect(primary).toContain('<link rel="alternate" hreflang="en" href="en/">');
    expect(primary).toContain('href="en/"');

    const english = await pageText(site.id, "en/index.html");
    expect(english).toContain('<html lang="en">');
    expect(english).toContain("[en] 작은 교회");
    expect(english).toContain(`../images/${file}`);
    expect(english).not.toContain(`src="images/${file}"`);
    expect(english).toContain('<link rel="alternate" hreflang="ko" href="../">');
    expect(english).toContain('<link rel="alternate" hreflang="en" href="./">');
    expect(english).toContain("English");
    expect(english).toContain("한국어");

    const englishObject = await env.PUBLISHED.head(`published/${site.id}/en/index.html`);
    expect(englishObject?.httpMetadata?.contentType).toBe("text/html; charset=utf-8");
    const images = await env.PUBLISHED.list({ prefix: `published/${site.id}/images/` });
    expect(images.objects.map((o) => o.key)).toEqual([`published/${site.id}/images/${file}`]);
    expect(await env.PUBLISHED.head(`published/${site.id}/en/images/${file}`)).toBeNull();
  });

  it("links every language from every page, relative to the page being rendered", async () => {
    const { site, doc } = await translatedSite("lang_b", "Three Languages");
    expect((await call("lang_b", `/sites/${site.id}/ai/translate`, jsonInit("POST", { language: "es" }))).status).toBe(200);
    expect((await call("lang_b", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);

    const english = await pageText(site.id, "en/index.html");
    expect(english).toContain('<link rel="alternate" hreflang="ko" href="../">');
    expect(english).toContain('<link rel="alternate" hreflang="es" href="../es/">');
    expect(english).toContain('<link rel="alternate" hreflang="en" href="./">');
    const spanish = await pageText(site.id, "es/index.html");
    expect(spanish).toContain('<link rel="alternate" hreflang="en" href="../en/">');
    expect(spanish).toContain("Español");
    expect(await pageText(site.id, "index.html")).toContain('<link rel="alternate" hreflang="es" href="es/">');
    expect(doc.meta.language).toBe("ko");
  });

  it("removes pages of languages that left the document, skips unsafe language codes and adds no switcher to single-language sites", async () => {
    const { site, doc } = await translatedSite("lang_c", "Shrinking Org");
    await env.PUBLISHED.put(`published/${site.id}/fr/index.html`, "old french");
    await env.PUBLISHED.put(`published/${site.id}/not a page.txt`, "keep");
    expect((await call("lang_c", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);
    expect(await env.PUBLISHED.head(`published/${site.id}/en/index.html`)).not.toBeNull();
    expect(await env.PUBLISHED.head(`published/${site.id}/fr/index.html`)).toBeNull();

    const single = { ...doc, meta: { ...doc.meta, languages: ["../evil", "EN"] } };
    expect((await call("lang_c", `/sites/${site.id}/document`, jsonInit("PUT", single))).status).toBe(200);
    expect((await call("lang_c", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);

    expect(await env.PUBLISHED.head(`published/${site.id}/en/index.html`)).toBeNull();
    const keys = (await env.PUBLISHED.list({ prefix: `published/${site.id}/` })).objects.map((o) => o.key);
    expect(keys.filter((k) => k.endsWith("index.html"))).toEqual([`published/${site.id}/index.html`]);
    expect(keys.some((k) => k.includes(".."))).toBe(false);
    expect(await env.PUBLISHED.head(`published/${site.id}/not a page.txt`)).not.toBeNull();
    expect(await pageText(site.id, "index.html")).not.toContain("hreflang");
  });
});

describe("hosting handler: languages", () => {
  it("serves /<slug>/<lang>/ with the page's language and the primary page's cache headers", async () => {
    const { site, file } = await translatedSite("host_lang_a", "Hosted Languages");
    await call("host_lang_a", `/sites/${site.id}/publish`, { method: "POST" });

    const english = await hosted(`https://${HOST}/${site.slug}/en/`);
    expect(english.status).toBe(200);
    expect(english.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(english.headers.get("cache-control")).toBe("public, max-age=60");
    expect(english.headers.get("content-language")).toBe("en");
    expect(english.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await english.text()).toContain("[en] ");

    const primary = await hosted(`https://${HOST}/${site.slug}/`);
    expect(primary.headers.get("content-language")).toBe("ko");

    // The shared images folder is reachable from the language page's ../images/ path.
    const image = await hosted(`https://${HOST}/${site.slug}/images/${file}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-language")).toBeNull();

    const etag = english.headers.get("etag") ?? "";
    const revalidated = await hosted(`https://${HOST}/${site.slug}/en/`, { headers: { "if-none-match": etag } });
    expect(revalidated.status).toBe(304);

    const sub = await hosted(`https://${site.slug}.${HOST}/en/`);
    expect(sub.status).toBe(200);
    expect(await sub.text()).toContain("[en] ");
  });

  it("redirects /<slug>/<lang> to the slash form and answers 404 for languages that were not published", async () => {
    const { site } = await translatedSite("host_lang_b", "Redirect Languages");
    await call("host_lang_b", `/sites/${site.id}/publish`, { method: "POST" });

    const redirected = await hosted(`https://${HOST}/${site.slug}/en?ref=x`, { redirect: "manual" });
    expect(redirected.status).toBe(301);
    expect(redirected.headers.get("location")).toBe(`/${site.slug}/en/?ref=x`);
    const sub = await hosted(`https://${site.slug}.${HOST}/en`, { redirect: "manual" });
    expect(sub.status).toBe(301);
    expect(sub.headers.get("location")).toBe("/en/");

    for (const url of [
      `https://${HOST}/${site.slug}/fr/`,
      `https://${HOST}/${site.slug}/fr`,
      `https://${HOST}/${site.slug}/EN/`,
      `https://${HOST}/${site.slug}/english/`,
      `https://${HOST}/${site.slug}/en/images/x.png`,
      `https://${HOST}/${site.slug}/en/index.html`,
    ]) {
      const res = await hosted(url, { redirect: "manual" });
      expect(res.status, url).toBe(404);
      expect(res.headers.get("content-type"), url).toBe("text/html; charset=utf-8");
    }
  });
});

describe("unpublish", () => {
  it("removes every published object, returns the site to draft and stops serving it", async () => {
    const { site } = await siteWithImage("unpub_a", "Unpublish Org");
    await call("unpub_a", `/sites/${site.id}/publish`, { method: "POST" });
    expect((await hosted(`https://${HOST}/${site.slug}/`)).status).toBe(200);

    expect((await call("unpub_b", `/sites/${site.id}/unpublish`, { method: "POST" })).status).toBe(404);
    const res = await call("unpub_a", `/sites/${site.id}/unpublish`, { method: "POST" });
    expect(res.status).toBe(200);

    expect((await env.PUBLISHED.list({ prefix: `published/${site.id}/` })).objects).toHaveLength(0);
    expect((await hosted(`https://${HOST}/${site.slug}/`)).status).toBe(404);
    const detail = (await (await call("unpub_a", `/sites/${site.id}`)).json()) as {
      site: { status: string; publishedUrl: string | null; publishedAt: string | null };
    };
    expect(detail.site).toMatchObject({ status: "draft", publishedUrl: null, publishedAt: null });
  });
});
