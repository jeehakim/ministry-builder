import {
  AiAddSectionRequest,
  AiAltTextRequest,
  AiDraftRequest,
  AiEditRequest,
  AiRewriteRequest,
  AiThemeRequest,
  AiTranslateRequest,
  SiteDocument,
  Theme,
  TranslationOverlay,
  type AiAction,
  type AiAddSectionResponse,
  type AiAltTextResponse,
  type AiDraftResponse,
  type AiEditResponse,
  type AiRewriteResponse,
  type AiThemeResponse,
  type AiTranslateResponse,
  type AiUsageResponse,
} from "@ministry/schema";
import { templates } from "@ministry/templates";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import { isSiteAssetKey, loadOrgAccess, requireSiteRole } from "../access";
import { AiProviderError, createProvider, type AiCallUsage, type AiProvider } from "../ai";
import { conformNewSection, conformOption, editTarget, pageSummary } from "../ai/edit";
import type { TemplateChoice } from "../ai/provider";
import { completedUsage, dailyLimit, globalDailyLimit, orgDailyLimit, orgUsedToday, releaseUsage, reserveUsage, usedToday, utcDayWindow } from "../ai/usage";
import { aiUsage, siteVersions, sites, type Site } from "../db/schema";
import { newId } from "../ids";
import { errorFields, logError, requestIdOf, scrub } from "../log";
import { LANGUAGE_PATH_PATTERN } from "../published";
import type { AppEnv } from "../types";

const MAX_AI_BODY_BYTES = 32 * 1024;
const tooLarge = bodyLimit({ maxSize: MAX_AI_BODY_BYTES, onError: (c) => c.json({ error: "Body too large" }, 413) });

type Ctx = Context<AppEnv>;
type Guard = { site: Site; provider: AiProvider; orgName: string };

function templateChoices(): TemplateChoice[] {
  return Object.values(templates).map(({ id, name, description }) => ({ id, name, description }));
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Keeps a model-chosen template id inside the registry. */
function knownTemplateId(id: string): string {
  if (Object.hasOwn(templates, id)) return id;
  return templateChoices()[0]?.id ?? "classic";
}

async function parseBody<S extends z.ZodTypeAny>(c: Ctx, schema: S): Promise<z.output<S> | Response> {
  const body: unknown = await c.req.json().catch(() => undefined);
  if (body === undefined) return c.json({ error: "Body must be valid JSON" }, 400);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: `Invalid request: ${describeIssues(parsed.error)}` }, 400);
  return parsed.data;
}

/**
 * Everything that must hold before a model call: site access and a configured provider. The quota is
 * taken later, by `callProvider`, once the body has been validated, so a rejected request spends nothing.
 * Returns the loaded pieces or the Response to send.
 */
async function guard(c: Ctx): Promise<Guard | Response> {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id") ?? "", "editor");
  if (access instanceof Response) return access;
  const { site, org } = access;

  const provider = createProvider(c.env);
  if (!provider) return c.json({ error: "AI is not configured on this server" }, 503);

  return { site, provider, orgName: org.name };
}

const AUDIT_MAX_CHARS = 4000;

/** Serializes an audit value, truncated so a long brief cannot bloat the row. */
function audit(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const json = typeof value === "string" ? value : JSON.stringify(value);
  return json.length > AUDIT_MAX_CHARS ? `${json.slice(0, AUDIT_MAX_CHARS)}…` : json;
}

/**
 * The statement that turns the call's reservation into its finished `ai_usage` row. Tokens were spent
 * whether or not the output turns out usable, so callers run it on every path after the provider answered.
 */
function finishUsage(
  db: ReturnType<typeof drizzle>,
  usageId: string,
  usage: AiCallUsage,
  trail: { request?: unknown; result?: unknown } = {},
) {
  return db
    .update(aiUsage)
    .set(completedUsage(usage, { requestJson: audit(trail.request), resultJson: audit(trail.result) }))
    .where(eq(aiUsage.id, usageId));
}

/**
 * Reserves a quota slot, runs the provider call and logs tokens and latency. Over quota answers 429;
 * a provider failure gives the slot back and answers 502. On success the caller finishes the usage row.
 */
async function callProvider<T extends { usage: AiCallUsage }>(
  c: Ctx,
  site: Pick<Site, "id" | "orgId">,
  action: AiAction,
  call: () => Promise<T>,
): Promise<{ result: T; usageId: string } | Response> {
  const db = drizzle(c.env.DB);
  const reservation = await reserveUsage(db, {
    userId: c.var.user.id,
    siteId: site.id,
    orgId: site.orgId,
    action,
    userLimit: dailyLimit(c.env),
    orgLimit: orgDailyLimit(c.env),
    globalLimit: globalDailyLimit(c.env),
  });
  if (!reservation.ok) {
    const resetsAt = utcDayWindow().resetsAt.toISOString();
    const quota = { scope: reservation.reason, used: reservation.used, limit: reservation.limit, resetsAt };
    if (reservation.reason === "global") {
      logError("ai_global_limit_reached", requestIdOf(c), { used: reservation.used, limit: reservation.limit });
      return c.json({ error: "The AI assistant has reached its daily capacity for everyone. It resets at midnight UTC.", ...quota }, 429);
    }
    if (reservation.reason === "organization") {
      return c.json({ error: `Your organization's daily AI limit (${reservation.limit}) is used up. It resets at midnight UTC.`, ...quota }, 429);
    }
    return c.json({ error: "Daily AI limit reached. It resets at midnight UTC.", ...quota }, 429);
  }

  const startedAt = Date.now();
  try {
    const result = await call();
    console.log(
      JSON.stringify({
        event: "ai_call",
        action,
        provider: result.usage.provider,
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        ms: Date.now() - startedAt,
      }),
    );
    return { result, usageId: reservation.id };
  } catch (err) {
    // SDK errors can echo the prompt in their message, so only our own AiProviderError text is logged.
    logError("ai_call_failed", requestIdOf(c), {
      action,
      ms: Date.now() - startedAt,
      ...errorFields(err, err instanceof AiProviderError),
    });
    await releaseUsage(db, reservation.id);
    const message = err instanceof AiProviderError ? err.message : "The AI service is unavailable right now. Please try again in a moment.";
    return c.json({ error: message }, 502);
  }
}

/** Resolves an optional image key for this site: Response on a bad key, key (or undefined) otherwise. */
async function checkImageKey(c: Ctx, siteId: string, key: string | undefined): Promise<string | undefined | Response> {
  if (key === undefined) return undefined;
  if (!isSiteAssetKey(siteId, key)) return c.json({ error: "Image does not belong to this site" }, 400);
  if (!(await c.env.IMAGES.head(key))) return c.json({ error: "Image not found" }, 404);
  return key;
}

export const aiRoutes = new Hono<AppEnv>();

/** Today's use by the caller, plus their organization's when `?orgId=` names one they belong to. */
aiRoutes.get("/ai/usage", async (c) => {
  const db = drizzle(c.env.DB);
  const used = await usedToday(db, c.var.user.id);
  const body: AiUsageResponse = {
    used,
    limit: dailyLimit(c.env),
    resetsAt: utcDayWindow().resetsAt.toISOString(),
    available: createProvider(c.env) !== null,
  };
  const orgId = c.req.query("orgId");
  if (orgId) {
    const access = await loadOrgAccess(db, c.var.user, orgId);
    if (access) body.organization = { used: await orgUsedToday(db, access.org.id), limit: orgDailyLimit(c.env) };
  }
  return c.json(body);
});

aiRoutes.post("/sites/:id/ai/draft", tooLarge, async (c) => {
  const g = await guard(c);
  if (g instanceof Response) return g;
  const body = await parseBody(c, AiDraftRequest);
  if (body instanceof Response) return body;
  const referenceAssetKey = await checkImageKey(c, g.site.id, body.referenceAssetKey);
  if (referenceAssetKey instanceof Response) return referenceAssetKey;

  const called = await callProvider(c, g.site, "draft", () =>
    g.provider.draft({
      notes: body.notes,
      language: body.language,
      variations: body.variations,
      templates: templateChoices(),
      orgName: g.orgName,
      styleNotes: body.styleNotes,
      referenceAssetKey,
    }),
  );
  if (called instanceof Response) return called;
  const { result, usageId } = called;

  const db = drizzle(c.env.DB);
  const variationGroupId = newId("vgrp");
  const variations: AiDraftResponse["variations"] = [];
  for (const candidate of result.variations) {
    const parsed = SiteDocument.safeParse(candidate.document);
    if (!parsed.success) {
      logError("ai_variation_invalid", requestIdOf(c), { issues: scrub(describeIssues(parsed.error)) });
      continue;
    }
    const document = parsed.data;
    // The organization's name is fixed by the site, whatever the model wrote.
    document.meta.orgName = g.orgName;
    document.theme.templateId = knownTemplateId(document.theme.templateId);
    variations.push({ versionId: newId("ver"), label: candidate.label, document });
  }

  const usage = finishUsage(db, usageId, result.usage, {
    request: { notes: body.notes, language: body.language, variations: body.variations, styleNotes: body.styleNotes, referenceAssetKey: body.referenceAssetKey },
    result: { variationGroupId, versionIds: variations.map((v) => v.versionId), labels: variations.map((v) => v.label) },
  });
  if (variations.length === 0) {
    await usage;
    return c.json({ error: "The AI returned drafts we could not use. Please try again." }, 502);
  }

  // Variations are stored as versions only; current_version_id moves when the user picks one.
  const [firstVersion, ...otherVersions] = variations.map((v) =>
    db.insert(siteVersions).values({
      id: v.versionId,
      siteId: g.site.id,
      document: JSON.stringify(v.document),
      variationGroupId,
      createdBy: c.var.user.id,
    }),
  );
  await db.batch([firstVersion!, ...otherVersions, usage]);

  const response: AiDraftResponse = { variationGroupId, variations };
  return c.json(response);
});

aiRoutes.post("/sites/:id/ai/rewrite", tooLarge, async (c) => {
  const g = await guard(c);
  if (g instanceof Response) return g;
  const body = await parseBody(c, AiRewriteRequest);
  if (body instanceof Response) return body;

  const called = await callProvider(c, g.site, "rewrite", () => g.provider.rewrite(body));
  if (called instanceof Response) return called;
  const { result, usageId } = called;

  await finishUsage(drizzle(c.env.DB), usageId, result.usage, { request: { instruction: body.instruction, context: body.context, text: body.text }, result: { text: result.text } });
  const response: AiRewriteResponse = { text: result.text };
  return c.json(response);
});

aiRoutes.post("/sites/:id/ai/theme", tooLarge, async (c) => {
  const g = await guard(c);
  if (g instanceof Response) return g;
  const body = await parseBody(c, AiThemeRequest);
  if (body instanceof Response) return body;
  const referenceAssetKey = await checkImageKey(c, g.site.id, body.referenceAssetKey);
  if (referenceAssetKey instanceof Response) return referenceAssetKey;

  const called = await callProvider(c, g.site, "theme", () =>
    g.provider.theme({ templates: templateChoices(), description: body.description, referenceAssetKey }),
  );
  if (called instanceof Response) return called;
  const { result, usageId } = called;

  await finishUsage(drizzle(c.env.DB), usageId, result.usage, { request: { description: body.description, referenceAssetKey: body.referenceAssetKey }, result: result });
  const parsed = Theme.safeParse(result.theme);
  if (!parsed.success) {
    logError("ai_theme_invalid", requestIdOf(c), { issues: scrub(describeIssues(parsed.error)) });
    return c.json({ error: "The AI returned a theme we could not use. Please try again." }, 502);
  }
  const response: AiThemeResponse = {
    theme: { ...parsed.data, templateId: knownTemplateId(parsed.data.templateId) },
    rationale: result.rationale,
  };
  return c.json(response);
});

aiRoutes.post("/sites/:id/ai/alt-text", tooLarge, async (c) => {
  const g = await guard(c);
  if (g instanceof Response) return g;
  const body = await parseBody(c, AiAltTextRequest);
  if (body instanceof Response) return body;
  const assetKey = await checkImageKey(c, g.site.id, body.assetKey);
  if (assetKey instanceof Response) return assetKey;
  if (assetKey === undefined) return c.json({ error: "assetKey is required" }, 400);

  const called = await callProvider(c, g.site, "alt_text", () => g.provider.altText({ assetKey, orgName: g.orgName }));
  if (called instanceof Response) return called;
  const { result, usageId } = called;

  await finishUsage(drizzle(c.env.DB), usageId, result.usage, { request: { assetKey: body.assetKey }, result: { alt: result.alt } });
  const response: AiAltTextResponse = { alt: result.alt };
  return c.json(response);
});

async function currentDocument(db: ReturnType<typeof drizzle>, site: Site): Promise<SiteDocument | null> {
  if (!site.currentVersionId) return null;
  const [version] = await db
    .select({ document: siteVersions.document })
    .from(siteVersions)
    .where(eq(siteVersions.id, site.currentVersionId))
    .limit(1);
  const parsed = version ? SiteDocument.safeParse(JSON.parse(version.document)) : null;
  return parsed?.success ? parsed.data : null;
}

aiRoutes.post("/sites/:id/ai/translate", tooLarge, async (c) => {
  const g = await guard(c);
  if (g instanceof Response) return g;
  const body = await parseBody(c, AiTranslateRequest);
  if (body instanceof Response) return body;

  const db = drizzle(c.env.DB);
  const document = await currentDocument(db, g.site);
  if (!document) return c.json({ error: "Site has no valid content to translate" }, 409);
  const language = body.language;
  // The language becomes a URL path segment on the published site, so it must be a plain language code.
  if (!LANGUAGE_PATH_PATTERN.test(language)) return c.json({ error: "Invalid language code" }, 400);
  if (language === document.meta.language) {
    return c.json({ error: "That is already the site's main language" }, 400);
  }

  const called = await callProvider(c, g.site, "translate", () =>
    g.provider.translate({ document, targetLanguage: language, sourceLanguage: document.meta.language }),
  );
  if (called instanceof Response) return called;
  const { result, usageId } = called;

  const versionId = newId("ver");
  const usage = finishUsage(db, usageId, result.usage, { request: { language: body.language }, result: { versionId } });
  const overlay = TranslationOverlay.safeParse(result.overlay);
  if (!overlay.success) {
    logError("ai_translation_invalid", requestIdOf(c), { issues: scrub(describeIssues(overlay.error)) });
    await usage;
    return c.json({ error: "The AI returned a translation we could not use. Please try again." }, 502);
  }

  // The model call takes a while; do not overwrite edits saved in the meantime.
  const [latest] = await db.select({ id: sites.currentVersionId }).from(sites).where(eq(sites.id, g.site.id)).limit(1);
  if (latest?.id !== g.site.currentVersionId) {
    await usage;
    return c.json({ error: "The site changed while it was being translated. Please try again." }, 409);
  }

  const next = SiteDocument.safeParse({
    ...document,
    meta: {
      ...document.meta,
      languages: document.meta.languages.includes(language) ? document.meta.languages : [...document.meta.languages, language],
    },
    translations: { ...document.translations, [language]: overlay.data },
  });
  if (!next.success) {
    logError("ai_translated_document_invalid", requestIdOf(c), { issues: scrub(describeIssues(next.error)) });
    await usage;
    return c.json({ error: "The translation could not be added to this site." }, 502);
  }

  await db.batch([
    db.insert(siteVersions).values({
      id: versionId,
      siteId: g.site.id,
      document: JSON.stringify(next.data),
      createdBy: c.var.user.id,
    }),
    db
      .update(sites)
      .set({ currentVersionId: versionId, updatedAt: sql`(unixepoch() * 1000)` })
      .where(eq(sites.id, g.site.id)),
    usage,
  ]);

  const response: AiTranslateResponse = { language, overlay: overlay.data };
  return c.json(response);
});

// ---- Scoped editing (Ask AI) ---------------------------------------------

/**
 * Proposes changes to one scope of the saved document. Nothing is stored: the editor
 * applies the change set when the user clicks Apply. One quota action per call,
 * whether it returns one option or three.
 */
aiRoutes.post("/sites/:id/ai/edit", tooLarge, async (c) => {
  const g = await guard(c);
  if (g instanceof Response) return g;
  const body = await parseBody(c, AiEditRequest);
  if (body instanceof Response) return body;

  const db = drizzle(c.env.DB);
  const document = await currentDocument(db, g.site);
  if (!document) return c.json({ error: "Site has no valid content to edit" }, 409);
  const target = editTarget(document, body.scope);
  if (!target) return c.json({ error: "That section is not on the saved page. Save and try again." }, 400);
  const options = body.scope.kind === "page" ? 1 : body.options;

  const called = await callProvider(c, g.site, "edit", () =>
    g.provider.edit({
      instruction: body.instruction,
      scope: body.scope,
      target,
      pageSummary: pageSummary(document),
      templateId: document.theme.templateId,
      templates: templateChoices(),
      orgName: g.orgName,
      language: document.meta.language,
      options,
    }),
  );
  if (called instanceof Response) return called;
  const { result, usageId } = called;

  const changes = result.options.flatMap((option) => conformOption(document, body.scope, option, Object.keys(templates)));
  await finishUsage(db, usageId, result.usage, {
    request: { instruction: body.instruction, scope: body.scope, options },
    result: { changes: changes.map((ch) => ({ target: ch.target, label: ch.label, after: ch.after })) },
  });
  if (changes.length === 0) {
    logError("ai_edit_invalid", requestIdOf(c), { scope: body.scope.kind, options: result.options.length });
    return c.json({ error: "The AI returned changes we could not use. Please try again." }, 502);
  }
  const response: AiEditResponse = { changes, model: result.usage.model };
  return c.json(response);
});

/** Writes one new section for the saved page. The editor inserts it; nothing is stored here. */
aiRoutes.post("/sites/:id/ai/add-section", tooLarge, async (c) => {
  const g = await guard(c);
  if (g instanceof Response) return g;
  const body = await parseBody(c, AiAddSectionRequest);
  if (body instanceof Response) return body;

  const db = drizzle(c.env.DB);
  const document = await currentDocument(db, g.site);
  if (!document) return c.json({ error: "Site has no valid content to add to" }, 409);
  const afterSection = body.afterSectionId ? document.sections.find((s) => s.id === body.afterSectionId) : undefined;
  if (body.afterSectionId && !afterSection) return c.json({ error: "That section is not on the saved page. Save and try again." }, 400);

  const called = await callProvider(c, g.site, "add_section", () =>
    g.provider.addSection({
      instruction: body.instruction,
      pageSummary: pageSummary(document),
      existingTypes: document.sections.map((s) => s.type),
      afterSection,
      orgName: g.orgName,
      language: document.meta.language,
    }),
  );
  if (called instanceof Response) return called;
  const { result, usageId } = called;

  const section = conformNewSection(document, result.section);
  await finishUsage(db, usageId, result.usage, {
    request: { instruction: body.instruction, afterSectionId: body.afterSectionId },
    result: section ? { section } : null,
  });
  if (!section) {
    logError("ai_add_section_invalid", requestIdOf(c), {});
    return c.json({ error: "The AI returned a section we could not use. Please try again." }, 502);
  }
  const response: AiAddSectionResponse = { section, model: result.usage.model };
  return c.json(response);
});
