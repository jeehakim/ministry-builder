import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  languageName,
  localizeDocument,
  SiteDocument,
  siteLanguages,
  type AiDraftRequest,
  type AiDraftResponse,
  type AiDraftVariation,
  type Section,
} from "@ministry/schema";
import { AlertCircle, ArrowLeft, ExternalLink, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import type { SiteInfo } from "../api";
import { useBackend } from "../backend-context";
import { ApiUnreachableBanner } from "../components/ApiUnreachableBanner";
import { PublishModal } from "../components/PublishModal";
import { buildExportZip, downloadBlob, exportFileName } from "../lib/exportZip";
import { previewLanguageLinks } from "../lib/languages";
import { platformContactEmail } from "../lib/messages";
import { useLatest } from "../lib/useLatest";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AiProvider, useAi } from "./AiContext";
import { DraftDialog } from "./DraftDialog";
import { MessagesDialog } from "./MessagesDialog";
import { editSection, formatIssue, setTranslation } from "./documentOps";
import { EditorHeader } from "./EditorHeader";
import { SiteIdProvider } from "./EditorContext";
import { GiveCampaignsPanel } from "./GiveCampaignsPanel";
import { FieldsForm } from "./FieldsForm";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { SECTION_FIELDS, SECTION_LABELS, type Obj } from "./fields";
import { Preview, type Device } from "./Preview";
import { SectionList, sectionTitle } from "./SectionList";
import { SECTION_ICONS } from "./sectionMeta";
import { SiteForm } from "./SiteForm";
import { useEditingLanguage } from "./useEditingLanguage";
import { useSiteDocument } from "./useSiteDocument";
import { VariationPicker } from "./VariationPicker";
import { renderSite } from "@ministry/templates";

type Tab = "sections" | "site";

export function EditorPage() {
  const { id } = useParams();
  if (!id) return <ErrorScreen message="Missing site id." />;
  return <Editor siteId={id} />;
}

function Editor({ siteId }: { siteId: string }) {
  const editor = useSiteDocument(siteId);

  useEffect(() => {
    if (editor.save.kind === "error") toast.error("Could not save", { description: editor.save.message });
  }, [editor.save]);

  if (editor.load.kind === "loading") return <LoadingScreen />;
  if (editor.load.kind === "error") return <ErrorScreen message={editor.load.message} onRetry={editor.load.network ? editor.retry : undefined} />;

  return (
    <SiteIdProvider value={siteId}>
      <AiProvider>
        <EditorView key={siteId} editor={editor} doc={editor.load.doc} site={editor.load.site} />
      </AiProvider>
    </SiteIdProvider>
  );
}

type EditorState = ReturnType<typeof useSiteDocument>;
type Dialog = "draft" | "variations" | "messages" | null;

function EditorView(props: { editor: EditorState; doc: SiteDocument; site: SiteInfo }) {
  const { editor, doc, site } = props;
  const backend = useBackend();
  const ai = useAi();
  const [tab, setTab] = useState<Tab>("sections");
  const [device, setDevice] = useState<Device>("desktop");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  // The last AI result stays here so the other variations remain reachable after one is chosen.
  const [variations, setVariations] = useState<AiDraftResponse | null>(null);
  const dialogNow = useLatest(dialog);
  const siteSlug = site.slug;
  const contactEmail = useMemo(() => platformContactEmail(doc), [doc]);

  const { active: lang, translating, setEditingLang } = useEditingLanguage(doc);
  const [translatingTo, setTranslatingTo] = useState<string | null>(null);
  // The forms and the preview show this view; edits are routed back to the primary text or an overlay.
  const viewDoc = useMemo(() => localizeDocument(doc, lang), [doc, lang]);
  const languages = useMemo(() => siteLanguages(doc), [doc]);
  const languageLinks = useMemo(() => previewLanguageLinks(doc, lang), [doc, lang]);

  const selected: Section | undefined = useMemo(
    () => viewDoc.sections.find((s) => s.id === selectedId) ?? viewDoc.sections[0],
    [viewDoc, selectedId],
  );

  function openLanguage(code: string) {
    setEditingLang(code);
    setTab("sections");
  }

  /** Flushes pending edits, has the AI translate the saved page, and applies the overlay locally. Resolves true on success. */
  async function translateInto(code: string): Promise<boolean> {
    if (translatingTo !== null) return false;
    setTranslatingTo(code);
    try {
      // The server translates its saved copy, so make sure it has the latest text.
      try {
        await editor.flush();
      } catch (err) {
        toast.error("Could not save your latest changes first", { description: err instanceof Error ? err.message : "Try again in a moment." });
        return false;
      }
      const result = await ai.runTranslate(code);
      if (!result) return false;
      editor.update((d) => setTranslation(d, code, result.overlay));
      openLanguage(code);
      toast.success(`Translated to ${languageName(code)}. Review and edit any line.`);
      return true;
    } finally {
      setTranslatingTo(null);
    }
  }

  async function handleGenerate(request: AiDraftRequest) {
    const result = await ai.runDraft(request);
    if (!result) return;
    setVariations(result);
    // Only take over the screen if the user is still looking at the draft form.
    if (dialogNow.current === "draft") {
      setDialog("variations");
      return;
    }
    toast.success(result.variations.length === 1 ? "Your draft is ready" : "Your drafts are ready", {
      action: { label: "Review", onClick: () => setDialog("variations") },
    });
  }

  function applyVariation(variation: AiDraftVariation) {
    const before = doc;
    editor.update(() => variation.document);
    setSelectedId(null);
    setDialog(null);
    toast.success("Draft applied, you can edit every field", {
      action: { label: "Undo", onClick: () => editor.update(() => before) },
    });
  }

  async function handleExport() {
    const parsed = SiteDocument.safeParse(doc);
    setExporting(true);
    try {
      if (!parsed.success) throw new Error(`Fix this before exporting: ${formatIssue(parsed.error)}`);
      const blob = await buildExportZip(parsed.data, backend, siteSlug);
      downloadBlob(blob, exportFileName(parsed.data, siteSlug, backend.mode));
      toast.success("ZIP downloaded", { description: "Drop it on cloudflare.com/drop to go live." });
    } catch (err) {
      toast.error("Export failed", { description: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setExporting(false);
    }
  }

  function openPreviewTab() {
    try {
      const { html } = renderSite(viewDoc, { imageUrl: (ref) => backend.imageUrl(ref), formAction: "#" });
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error("Preview failed", { description: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  const issue = editor.save.kind === "invalid" ? editor.save.message : null;
  const SelectedIcon = selected ? SECTION_ICONS[selected.type] : null;

  return (
    <>
      <div className="flex h-dvh flex-col bg-background">
        <EditorHeader
          orgName={doc.meta.orgName}
          save={editor.save}
          site={site}
          exporting={exporting}
          hasVariations={variations !== null}
          onDraft={() => setDialog("draft")}
          onVariations={() => setDialog("variations")}
          onExport={() => void handleExport()}
          onPublish={() => setPublishOpen(true)}
          onMessages={() => setDialog("messages")}
        />

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(340px,400px)_1fr]">
          <aside className="flex min-h-0 flex-col border-r bg-sidebar">
            <LanguageSwitcher languages={languages} active={lang} onSelect={setEditingLang} />
            <Tabs value={tab} onValueChange={(v) => setTab(v === "site" ? "site" : "sections")} className="flex min-h-0 flex-1 flex-col gap-0">
              <div className="shrink-0 border-b px-3 pt-2">
                <TabsList variant="line" className="w-full">
                  <TabsTrigger value="sections">Sections</TabsTrigger>
                  <TabsTrigger value="site">Site & design</TabsTrigger>
                </TabsList>
              </div>

              {issue ? (
                <p role="alert" className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{issue}</span>
                </p>
              ) : null}

              <TabsContent value="sections" className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-5 p-3">
                  <SectionList
                    sections={viewDoc.sections}
                    locked={translating}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelectedId}
                    onMove={editor.moveSection}
                    onReorder={editor.reorderSection}
                    onToggleHidden={editor.toggleHidden}
                    onDelete={editor.removeSection}
                    onAdd={(type) => {
                      editor.addSection(type);
                      setSelectedId(null);
                    }}
                  />
                  {selected && SelectedIcon ? (
                    <section aria-label={`Edit ${selected.type} section`} className="rounded-xl border bg-card p-3 shadow-xs">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="grid size-6 place-items-center rounded-md bg-muted text-muted-foreground">
                          <SelectedIcon className="size-3.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{sectionTitle(selected)}</p>
                          <p className="text-[11px] text-muted-foreground">{SECTION_LABELS[selected.type]} section</p>
                        </div>
                      </div>
                      <FieldsForm
                        key={`${selected.id}:${lang}`}
                        value={selected}
                        fields={SECTION_FIELDS[selected.type]}
                        sectionType={selected.type}
                        translating={translating}
                        onChange={(next: Obj) => editor.update((d) => editSection(d, lang, next as Section))}
                      />
                      {selected.type === "give" ? (
                        <div className="mt-4">
                          <GiveCampaignsPanel
                            section={selected}
                            orgId={site.orgId}
                            onChange={(campaigns) => editor.update((d) => editSection(d, doc.meta.language, { ...(d.sections.find((s) => s.id === selected.id) as Section), campaigns } as Section))}
                          />
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="site" className="min-h-0 flex-1 overflow-y-auto">
                <div className="p-3">
                  <SiteForm
                    doc={doc}
                    update={editor.update}
                    lang={lang}
                    translatingTo={translatingTo}
                    onTranslate={translateInto}
                    onOpenLanguage={openLanguage}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </aside>

          <main className="flex min-h-0 flex-col">
            <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
              <span className="text-xs font-medium text-muted-foreground">Live preview</span>
              <div className="flex items-center gap-1">
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={device}
                  onValueChange={(v) => {
                    if (v === "desktop" || v === "mobile") setDevice(v);
                  }}
                  aria-label="Preview width"
                >
                  <ToggleGroupItem value="desktop" aria-label="Desktop width">
                    <Monitor />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="mobile" aria-label="Phone width">
                    <Smartphone />
                  </ToggleGroupItem>
                </ToggleGroup>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Open preview in a new tab" onClick={openPreviewTab}>
                      <ExternalLink />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Open in a new tab</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Preview
                doc={viewDoc}
                device={device}
                hostname={`${siteSlug}.sites.shofar.io`}
                focusSectionId={tab === "sections" ? (selected?.id ?? null) : null}
                languageLinks={languageLinks}
                onSelectLanguage={setEditingLang}
              />
            </div>
          </main>
        </div>

        <PublishModal
          open={publishOpen}
          busy={exporting}
          site={site}
          doc={doc}
          onOpenChange={setPublishOpen}
          onDownload={() => void handleExport()}
          onSiteChange={editor.updateSite}
          beforePublish={editor.flush}
        />
      </div>

      {backend.messages ? (
        <MessagesDialog
          open={dialog === "messages"}
          onOpenChange={(open) => setDialog(open ? "messages" : null)}
          orgName={doc.meta.orgName}
          contactEmail={contactEmail}
          onCountChange={(messageCount) => editor.updateSite({ messageCount })}
        />
      ) : null}
      <DraftDialog open={dialog === "draft"} onOpenChange={(open) => setDialog(open ? "draft" : null)} onGenerate={(r) => void handleGenerate(r)} />
      <VariationPicker
        open={dialog === "variations"}
        onOpenChange={(open) => setDialog(open ? "variations" : null)}
        result={variations}
        onUse={applyVariation}
        onWriteAnother={() => setDialog("draft")}
      />
    </>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex h-12 items-center gap-3 border-b px-3">
        <Skeleton className="size-7 rounded-lg" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(340px,400px)_1fr]">
        <div className="space-y-2 border-r p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 rounded-lg" />
          ))}
        </div>
        <div className="preview-canvas p-6">
          <Skeleton className="h-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/** `onRetry` is given only when the failure was a network one, which shows the unreachable banner instead of the message. */
function ErrorScreen({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      {onRetry ? (
        <ApiUnreachableBanner onRetry={onRetry} className="max-w-md" />
      ) : (
        <>
          <AlertCircle className="size-6 text-destructive" aria-hidden="true" />
          <p role="alert" className="text-sm">
            {message}
          </p>
        </>
      )}
      <Button asChild variant="outline" size="sm">
        <Link to="/">
          <ArrowLeft />
          Back to your sites
        </Link>
      </Button>
    </div>
  );
}
