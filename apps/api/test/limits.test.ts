import { emptySiteDocument } from "@ministry/schema";
import { env } from "cloudflare:workers";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { publishEvents, siteVersions, sites } from "../src/db/schema";
import { limitsFor } from "../src/limits";
import { pruneVersions } from "../src/versions";
import { call, jsonInit, makeSite, PNG_BYTES } from "./helpers";

const db = () => drizzle(env.DB);
const HOUR = 60 * 60 * 1000;

function withEnv(vars: Record<string, string>): object {
  return { ...env, ...vars };
}

async function createSite(user: string, orgName: string, bindings: object = env): Promise<Response> {
  return call(user, "/sites", jsonInit("POST", { orgName }), bindings);
}

async function upload(user: string, siteId: string, bindings: object): Promise<Response> {
  const form = new FormData();
  form.set("file", new File([PNG_BYTES], "f.png", { type: "image/png" }));
  return call(user, `/sites/${siteId}/assets`, { method: "POST", body: form }, bindings);
}

describe("limitsFor", () => {
  it("uses the defaults when a var is missing, zero, negative or not a number", () => {
    const defaults = { maxSitesPerUser: 10, maxSiteStorageBytes: 100 * 1024 * 1024, maxVersionsPerSite: 500, maxPublishesPerHour: 20 };
    expect(limitsFor({})).toEqual(defaults);
    expect(limitsFor({ MAX_SITES_PER_USER: "0", MAX_SITE_STORAGE_BYTES: "-5", MAX_VERSIONS_PER_SITE: "lots", MAX_PUBLISHES_PER_HOUR: "" })).toEqual(defaults);
    expect(limitsFor({ MAX_SITES_PER_USER: "3", MAX_SITE_STORAGE_BYTES: "1000", MAX_VERSIONS_PER_SITE: "60", MAX_PUBLISHES_PER_HOUR: "2" })).toEqual({
      maxSitesPerUser: 3,
      maxSiteStorageBytes: 1000,
      maxVersionsPerSite: 60,
      maxPublishesPerHour: 2,
    });
  });
});

describe("sites per user", () => {
  it("answers 429 once the user owns the limit, counting sites across organizations", async () => {
    const bindings = withEnv({ MAX_SITES_PER_USER: "2" });
    expect((await createSite("lim_a", "First Org", bindings)).status).toBe(201);
    expect((await createSite("lim_a", "Second Org", bindings)).status).toBe(201);
    const third = await createSite("lim_a", "First Org", bindings);
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ error: "Site limit reached (2 sites per account)", limit: 2 });
    // A different user is not affected.
    expect((await createSite("lim_b", "Other Org", bindings)).status).toBe(201);
  });

  it("frees a slot when a site is deleted", async () => {
    const bindings = withEnv({ MAX_SITES_PER_USER: "1" });
    const first = await createSite("lim_c", "Only Org", bindings);
    const { site } = (await first.json()) as { site: { id: string } };
    expect((await createSite("lim_c", "Another Org", bindings)).status).toBe(429);
    expect((await call("lim_c", `/sites/${site.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await createSite("lim_c", "Another Org", bindings)).status).toBe(201);
  });

  it("exempts admins", async () => {
    const bindings = withEnv({ MAX_SITES_PER_USER: "1" });
    for (const name of ["Admin A", "Admin B", "Admin C"]) {
      expect((await createSite("lim_admin:admin", name, bindings)).status, name).toBe(201);
    }
  });

  it("allows 10 by default and refuses the 11th", async () => {
    for (let i = 1; i <= 10; i++) expect((await createSite("lim_d", `Default Org ${i}`)).status, `site ${i}`).toBe(201);
    expect((await createSite("lim_d", "Default Org 11")).status).toBe(429);
  });
});

describe("storage per site", () => {
  it("rejects the upload that would exceed the limit with 413, allows exactly the limit, and keeps nothing from the rejected file", async () => {
    // Each test image is 12 bytes: three fit in 36, a fourth does not.
    const bindings = withEnv({ MAX_SITE_STORAGE_BYTES: "36" });
    const site = await makeSite("lim_store_a", "Storage Org");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await upload("lim_store_a", site.id, bindings);
      expect(res.status, `upload ${i + 1}`).toBe(201);
      ids.push(((await res.json()) as { id: string }).id);
    }
    const rejected = await upload("lim_store_a", site.id, bindings);
    expect(rejected.status).toBe(413);
    expect(await rejected.json()).toEqual({ error: "Site storage limit reached. Delete unused images first.", limit: 36 });
    expect((await env.IMAGES.list({ prefix: `sites/${site.id}/` })).objects).toHaveLength(3);

    // Deleting an image makes room again.
    expect((await call("lim_store_a", `/sites/${site.id}/assets/${ids[0]}`, { method: "DELETE" }, bindings)).status).toBe(200);
    expect((await upload("lim_store_a", site.id, bindings)).status).toBe(201);
  });

  it("counts each site on its own", async () => {
    const bindings = withEnv({ MAX_SITE_STORAGE_BYTES: "12" });
    const a = await makeSite("lim_store_b", "Storage A");
    const b = await makeSite("lim_store_b", "Storage B");
    expect((await upload("lim_store_b", a.id, bindings)).status).toBe(201);
    expect((await upload("lim_store_b", a.id, bindings)).status).toBe(413);
    expect((await upload("lim_store_b", b.id, bindings)).status).toBe(201);
  });

  it("still enforces the 5 MB per-file limit", async () => {
    const site = await makeSite("lim_store_c", "Big File Org");
    const form = new FormData();
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG_BYTES);
    form.set("file", new File([big], "big.png", { type: "image/png" }));
    const res = await call("lim_store_c", `/sites/${site.id}/assets`, { method: "POST", body: form });
    expect(res.status).toBe(413);
  });
});

async function seedVersions(siteId: string, userId: string, n: number): Promise<string[]> {
  const base = Date.now() - HOUR;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `ver_seed_${siteId}_${String(i).padStart(3, "0")}`;
    ids.push(id);
    await db().insert(siteVersions).values({ id, siteId, document: "{}", createdBy: userId, createdAt: new Date(base + i * 1000) });
  }
  return ids;
}

async function versionIds(siteId: string): Promise<Set<string>> {
  const rows = await db().select({ id: siteVersions.id }).from(siteVersions).where(eq(siteVersions.siteId, siteId));
  return new Set(rows.map((r) => r.id));
}

describe("version pruning", () => {
  it("prunes the oldest versions down to the limit when a save pushes the site over it", async () => {
    const site = await makeSite("lim_ver_a", "Versions Org");
    // 60 old versions, then the initial one (created now), then the save below: 62 in all, limit 55.
    const seeded = await seedVersions(site.id, "lim_ver_a", 60);
    const res = await call("lim_ver_a", `/sites/${site.id}/document`, jsonInit("PUT", emptySiteDocument("Versions Org")), withEnv({ MAX_VERSIONS_PER_SITE: "55" }));
    expect(res.status).toBe(200);
    const { versionId } = (await res.json()) as { versionId: string };

    const remaining = await versionIds(site.id);
    expect(remaining.size).toBe(55);
    expect(seeded.slice(0, 7).some((id) => remaining.has(id))).toBe(false);
    expect(seeded.slice(7).every((id) => remaining.has(id))).toBe(true);
    expect(remaining.has(site.versionId)).toBe(true);
    expect(remaining.has(versionId)).toBe(true);

    const listed = (await (await call("lim_ver_a", `/sites/${site.id}/versions`)).json()) as { versions: { id: string }[]; currentVersionId: string };
    expect(listed.currentVersionId).toBe(versionId);
    expect(listed.versions).toHaveLength(55);
  });

  it("prunes nothing while the site is within the limit", async () => {
    const site = await makeSite("lim_ver_b", "Under Limit Org");
    await seedVersions(site.id, "lim_ver_b", 60);
    const res = await call("lim_ver_b", `/sites/${site.id}/document`, jsonInit("PUT", emptySiteDocument("Under Limit Org")));
    expect(res.status).toBe(200);
    expect((await versionIds(site.id)).size).toBe(62);
  });

  it("never prunes the current version or the newest 50, even when that leaves the site over the limit", async () => {
    const site = await makeSite("lim_ver_c", "Protected Org");
    const seeded = await seedVersions(site.id, "lim_ver_c", 60);
    const oldestAsCurrent = seeded[0] ?? "";
    await db().update(sites).set({ currentVersionId: oldestAsCurrent }).where(eq(sites.id, site.id));

    await pruneVersions(db(), site.id, oldestAsCurrent, 10);

    const remaining = await versionIds(site.id);
    // 61 versions: the newest 50 are seeded[11..59] and the initial one; seeded[1..10] are the only ones prunable.
    expect(remaining.size).toBe(51);
    expect(remaining.has(oldestAsCurrent)).toBe(true);
    expect(seeded.slice(1, 11).some((id) => remaining.has(id))).toBe(false);
    expect(seeded.slice(11).every((id) => remaining.has(id))).toBe(true);
    expect(remaining.has(site.versionId)).toBe(true);
  });

  it("only touches the site being saved", async () => {
    const mine = await makeSite("lim_ver_d", "Mine");
    const other = await makeSite("lim_ver_d", "Other");
    await seedVersions(other.id, "lim_ver_d", 60);
    await seedVersions(mine.id, "lim_ver_d", 60);
    await call("lim_ver_d", `/sites/${mine.id}/document`, jsonInit("PUT", emptySiteDocument("Mine")), withEnv({ MAX_VERSIONS_PER_SITE: "55" }));
    expect((await versionIds(other.id)).size).toBe(61);
    expect((await versionIds(mine.id)).size).toBe(55);
  });
});

async function publish(user: string, siteId: string, bindings: object = env): Promise<Response> {
  return call(user, `/sites/${siteId}/publish`, { method: "POST" }, bindings);
}

async function addEvents(siteId: string, userId: string, ages: number[]): Promise<void> {
  for (const [i, age] of ages.entries()) {
    await db().insert(publishEvents).values({ id: `pub_seed_${siteId}_${i}`, siteId, userId, createdAt: new Date(Date.now() - age) });
  }
}

describe("publish rate", () => {
  it("answers 429 with Retry-After once a site was published the allowed number of times within the hour", async () => {
    const bindings = withEnv({ MAX_PUBLISHES_PER_HOUR: "2" });
    const site = await makeSite("lim_pub_a", "Rate Org");
    expect((await publish("lim_pub_a", site.id, bindings)).status).toBe(200);
    expect((await publish("lim_pub_a", site.id, bindings)).status).toBe(200);
    const blocked = await publish("lim_pub_a", site.id, bindings);
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(HOUR / 1000 - 60);
    expect(retryAfter).toBeLessThanOrEqual(HOUR / 1000);
    expect(await blocked.json()).toMatchObject({ limit: 2, retryAfterSeconds: retryAfter });

    // Another site is counted separately, and a rejected attempt is not recorded.
    const other = await makeSite("lim_pub_a", "Rate Org Two");
    expect((await publish("lim_pub_a", other.id, bindings)).status).toBe(200);
    const [row] = await db().select({ n: count() }).from(publishEvents).where(eq(publishEvents.siteId, site.id));
    expect(row?.n).toBe(2);
  });

  it("allows 20 per hour by default", async () => {
    const site = await makeSite("lim_pub_b", "Default Rate Org");
    await addEvents(site.id, "lim_pub_b", Array.from({ length: 19 }, (_, i) => i * 1000));
    expect((await publish("lim_pub_b", site.id)).status).toBe(200);
    const blocked = await publish("lim_pub_b", site.id);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ limit: 20 });
  });

  it("does not count publishes older than an hour, and forgets rows older than a day", async () => {
    const bindings = withEnv({ MAX_PUBLISHES_PER_HOUR: "2" });
    const site = await makeSite("lim_pub_c", "Window Org");
    await addEvents(site.id, "lim_pub_c", [HOUR + 60_000, 2 * HOUR, 25 * HOUR, 26 * HOUR]);
    expect((await publish("lim_pub_c", site.id, bindings)).status).toBe(200);
    const left = await db().select({ id: publishEvents.id }).from(publishEvents).where(eq(publishEvents.siteId, site.id));
    // The two events within the last day plus the new one.
    expect(left).toHaveLength(3);
  });

  it("frees the slot as the oldest publish leaves the window", async () => {
    const bindings = withEnv({ MAX_PUBLISHES_PER_HOUR: "2" });
    const site = await makeSite("lim_pub_d", "Retry Org");
    await addEvents(site.id, "lim_pub_d", [HOUR - 90_000, 10_000]);
    const blocked = await publish("lim_pub_d", site.id, bindings);
    expect(blocked.status).toBe(429);
    // The older event leaves the window in about 90 seconds; the newer one would take almost an hour.
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(80);
    expect(retryAfter).toBeLessThanOrEqual(91);
  });

  it("does not count a publish that fails validation", async () => {
    const bindings = withEnv({ MAX_PUBLISHES_PER_HOUR: "1" });
    const stranger = await makeSite("lim_pub_e", "Mine Only");
    expect((await publish("lim_pub_other", stranger.id, bindings)).status).toBe(404);
    expect((await publish("lim_pub_e", stranger.id, bindings)).status).toBe(200);
  });

  it("lets a site with publish history be deleted", async () => {
    const site = await makeSite("lim_pub_f", "Deleted Rate Org");
    expect((await publish("lim_pub_f", site.id)).status).toBe(200);
    expect((await call("lim_pub_f", `/sites/${site.id}`, { method: "DELETE" })).status).toBe(200);
    const [row] = await db().select({ n: count() }).from(publishEvents).where(and(eq(publishEvents.siteId, site.id)));
    expect(row?.n).toBe(0);
  });
});
