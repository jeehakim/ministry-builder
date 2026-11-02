import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import realApp from "../src/index";
import { call, jsonInit, makeSite } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

function withStaffToken(token: string | undefined, path: string, bindings: object = env): Promise<Response> {
  const headers: Record<string, string> = token === undefined ? {} : { "X-Staff-Token": token };
  return Promise.resolve(realApp.request(path, { headers }, bindings));
}

function stubClerk(response: Response) {
  const fetchStub = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

describe("staff token", () => {
  it("authenticates as an admin and reaches /admin/sites and other users' sites", async () => {
    const site = await makeSite("staff_owner", "Staff Visible Org");

    const res = await withStaffToken("test-staff-token", "/admin/sites");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sites: { id: string; orgName: string; ownerUserId: string; status: string; publishedUrl: string | null }[] };
    const row = body.sites.find((s) => s.id === site.id);
    expect(row).toMatchObject({ orgName: "Staff Visible Org", ownerUserId: "staff_owner", status: "draft", publishedUrl: null });

    expect((await withStaffToken("test-staff-token", `/sites/${site.id}`)).status).toBe(200);
  });

  it("rejects a wrong or missing token, and is disabled when no token is configured", async () => {
    expect((await withStaffToken("wrong-token", "/admin/sites")).status).toBe(401);
    expect((await withStaffToken("test-staff-tokenX", "/admin/sites")).status).toBe(401);
    expect((await withStaffToken(undefined, "/admin/sites")).status).toBe(401);
    expect((await withStaffToken("", "/admin/sites", { ...env, STAFF_API_TOKEN: "" })).status).toBe(401);
    expect((await withStaffToken("test-staff-token", "/admin/sites", { ...env, STAFF_API_TOKEN: undefined })).status).toBe(401);
  });
});

describe("admin routes", () => {
  it("rejects members on /admin/sites", async () => {
    expect((await call("member_a", "/admin/sites")).status).toBe(403);
    expect((await call("admin_a:admin", "/admin/sites")).status).toBe(200);
  });
});

describe("POST /orgs/:id/transfer", () => {
  it("is forbidden for members, even the org's owner", async () => {
    const site = await makeSite("transfer_owner", "Owner Org");
    const res = await call("transfer_owner", `/orgs/${site.orgId}/transfer`, jsonInit("POST", { email: "new@example.org" }));
    expect(res.status).toBe(403);
  });

  it("looks the user up in Clerk and makes them the owner", async () => {
    const site = await makeSite("transfer_staff", "Handover Org");
    const clerk = stubClerk(Response.json([{ id: "user_new_owner" }]));

    const res = await call("admin_b:admin", `/orgs/${site.orgId}/transfer`, jsonInit("POST", { email: "Pastor+Kim@Example.org" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: site.orgId, ownerUserId: "user_new_owner" });

    const [request] = clerk.mock.calls[0]!;
    const url = new URL(request instanceof Request ? request.url : String(request));
    expect(url.origin + url.pathname).toBe("https://api.clerk.com/v1/users");
    expect(url.searchParams.get("email_address")).toBe("pastor+kim@example.org");
    const headers = new Headers(clerk.mock.calls[0]![1]?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${env.CLERK_SECRET_KEY}`);

    const mine = (await (await call("user_new_owner", "/sites")).json()) as { sites: { id: string }[] };
    expect(mine.sites.map((s) => s.id)).toContain(site.id);
    const formerOwner = (await (await call("transfer_staff", "/sites")).json()) as { sites: unknown[] };
    expect(formerOwner.sites).toHaveLength(0);
  });

  it("answers 404 for an unknown email or organization, 400 for a bad email and 502 when Clerk fails", async () => {
    const site = await makeSite("transfer_staff2", "Edge Org");
    const transfer = (orgId: string, body: unknown) => call("admin_c:admin", `/orgs/${orgId}/transfer`, jsonInit("POST", body));

    stubClerk(Response.json([]));
    expect((await transfer(site.orgId, { email: "nobody@example.org" })).status).toBe(404);
    expect((await transfer("org_missing", { email: "nobody@example.org" })).status).toBe(404);
    expect((await transfer(site.orgId, { email: "not-an-email" })).status).toBe(400);
    expect((await transfer(site.orgId, {})).status).toBe(400);

    stubClerk(new Response("boom", { status: 500 }));
    expect((await transfer(site.orgId, { email: "someone@example.org" })).status).toBe(502);
  });

  it("works with the staff token through the real app", async () => {
    const site = await makeSite("transfer_staff3", "Bot Org");
    stubClerk(Response.json([{ id: "user_via_bot" }]));
    const res = await realApp.request(
      `/orgs/${site.orgId}/transfer`,
      { ...jsonInit("POST", { email: "bot@example.org" }), headers: { "content-type": "application/json", "X-Staff-Token": "test-staff-token" } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: site.orgId, ownerUserId: "user_via_bot" });
  });
});
