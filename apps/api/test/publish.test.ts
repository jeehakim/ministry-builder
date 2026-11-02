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
