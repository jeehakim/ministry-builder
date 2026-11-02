import { emptySiteDocument } from "@ministry/schema";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import realApp from "../src/index";
import { call, jsonInit } from "./helpers";

type CreatedSite = { id: string; slug: string; versionId: string };

async function createSite(user: string, orgName: string, slug?: string): Promise<Response> {
  return call(user, "/sites", jsonInit("POST", slug ? { orgName, slug } : { orgName }));
}

function formWithFile(bytes: Uint8Array, type: string, name = "f"): FormData {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  return form;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("auth and health", () => {
  it("serves /health without auth", async () => {
    const res = await realApp.request("/health", {}, env);
    expect(res.status).toBe(200);
  });

  it("rejects /sites without a bearer token", async () => {
    const res = await realApp.request("/sites", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Missing bearer token" });
  });

  it("rejects an invalid bearer token", async () => {
    const res = await realApp.request("/sites", { headers: { Authorization: "Bearer not-a-jwt" } }, env);
    expect(res.status).toBe(401);
  });
});

describe("sites", () => {
  it("creates a site with a first version and lists it for the owner only", async () => {
    const res = await createSite("user_a", "Grace Church");
    expect(res.status).toBe(201);
    const created = (await res.json()) as CreatedSite;
    expect(created.slug).toBe("grace-church");

    const list = (await (await call("user_a", "/sites")).json()) as { sites: { id: string }[] };
    expect(list.sites.map((s) => s.id)).toContain(created.id);
    const other = (await (await call("user_b", "/sites")).json()) as { sites: unknown[] };
    expect(other.sites).toHaveLength(0);

    const detail = (await (await call("user_a", `/sites/${created.id}`)).json()) as {
      document: { meta: { orgName: string } };
    };
    expect(detail.document.meta.orgName).toBe("Grace Church");
  });

  it("generates a unique slug for a repeated name and 409s on an explicit duplicate", async () => {
    const first = (await (await createSite("user_c", "Hope Mission")).json()) as CreatedSite;
    const second = (await (await createSite("user_d", "Hope Mission")).json()) as CreatedSite;
    expect(second.slug).not.toBe(first.slug);
    expect((await createSite("user_d", "Other", first.slug)).status).toBe(409);
    expect((await createSite("user_d", "Other", "Bad Slug!")).status).toBe(400);
  });

  it("hides sites from non-owners but not from admins", async () => {
    const created = (await (await createSite("user_e", "Private Org")).json()) as CreatedSite;
    expect((await call("user_f:member", `/sites/${created.id}`)).status).toBe(404);
    expect((await call("staff:admin", `/sites/${created.id}`)).status).toBe(200);
  });

  it("appends a version on PUT and moves current_version_id", async () => {
    const created = (await (await createSite("user_g", "Versioned")).json()) as CreatedSite;
    const doc = emptySiteDocument("Versioned");
    doc.meta.tagline = "Updated";

    const put = await call("user_g", `/sites/${created.id}/document`, jsonInit("PUT", doc));
    expect(put.status).toBe(200);
    const { versionId } = (await put.json()) as { versionId: string };

    const versions = (await (await call("user_g", `/sites/${created.id}/versions`)).json()) as {
      versions: { id: string }[];
      currentVersionId: string;
    };
    expect(versions.versions).toHaveLength(2);
    expect(versions.currentVersionId).toBe(versionId);

    const detail = (await (await call("user_g", `/sites/${created.id}`)).json()) as {
      document: { meta: { tagline: string } };
    };
    expect(detail.document.meta.tagline).toBe("Updated");
  });

  it("rejects invalid documents and malformed JSON", async () => {
    const created = (await (await createSite("user_h", "Strict")).json()) as CreatedSite;
    const bad = await call("user_h", `/sites/${created.id}/document`, jsonInit("PUT", { meta: {}, sections: [{ type: "nope" }] }));
    expect(bad.status).toBe(400);
    const notJson = await call("user_h", `/sites/${created.id}/document`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(notJson.status).toBe(400);
  });
});

describe("assets", () => {
  it("uploads, serves with cache headers, and deletes an image", async () => {
    const site = (await (await createSite("user_i", "Pictures")).json()) as CreatedSite;
    const up = await call("user_i", `/sites/${site.id}/assets`, { method: "POST", body: formWithFile(PNG, "image/png") });
    expect(up.status).toBe(201);
    const asset = (await up.json()) as { id: string; key: string; url: string };
    expect(asset.key).toMatch(new RegExp(`^sites/${site.id}/[0-9a-f-]{36}\\.png$`));
    expect(asset.url).toBe(`/assets/${asset.key}`);

    const got = await call(null, asset.url);
    expect(got.status).toBe(200);
    expect(got.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(got.headers.get("content-type")).toBe("image/png");

    const etag = got.headers.get("etag");
    expect(etag).toBeTruthy();
    expect((await call(null, asset.url, { headers: { "if-none-match": etag ?? "" } })).status).toBe(304);

    expect((await call("user_j", `/sites/${site.id}/assets/${asset.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await call("user_i", `/sites/${site.id}/assets/${asset.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(null, asset.url)).status).toBe(404);
  });

  it("rejects disallowed types, spoofed content, oversize files and missing fields", async () => {
    const site = (await (await createSite("user_k", "Uploads")).json()) as CreatedSite;
    const post = (body: FormData) => call("user_k", `/sites/${site.id}/assets`, { method: "POST", body });

    expect((await post(formWithFile(PNG, "image/gif"))).status).toBe(415);
    expect((await post(formWithFile(new TextEncoder().encode("<svg/>"), "image/png"))).status).toBe(415);
    expect((await post(formWithFile(new Uint8Array(5 * 1024 * 1024 + 1), "image/png"))).status).toBe(413);
    expect((await post(new FormData())).status).toBe(400);
  });

  it("does not let a stranger upload to someone else's site", async () => {
    const site = (await (await createSite("user_l", "Owned")).json()) as CreatedSite;
    const res = await call("user_m", `/sites/${site.id}/assets`, { method: "POST", body: formWithFile(PNG, "image/png") });
    expect(res.status).toBe(404);
  });

  it("does not serve keys outside the expected shape", async () => {
    expect((await call(null, "/assets/../secret")).status).toBe(404);
    expect((await call(null, "/assets/sites/x/not-a-uuid.png")).status).toBe(404);
  });
});
