import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { SiteDocument, type Section } from "@ministry/schema";
import { AlertCircle, ArrowLeft, Download, ExternalLink, Loader2, Monitor, Rocket, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useBackend } from "../backend-context";
import { Brand } from "../components/Brand";
import { PublishModal } from "../components/PublishModal";
import { SaveIndicator } from "../components/SaveIndicator";
import { ThemeToggle } from "../components/ThemeToggle";
import { UserMenu } from "../components/UserMenu";
import { buildExportZip, downloadBlob, exportFileName } from "../lib/exportZip";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatIssue } from "./documentOps";
import { SiteIdProvider } from "./EditorContext";
import { FieldsForm } from "./FieldsForm";
import { SECTION_FIELDS, SECTION_LABELS, type Obj } from "./fields";
import { Preview, type Device } from "./Preview";
import { SectionList, sectionTitle } from "./SectionList";
import { SECTION_ICONS } from "./sectionMeta";
import { SiteForm } from "./SiteForm";
import { useSiteDocument } from "./useSiteDocument";
import { renderSite } from "@ministry/templates";

type Tab = "sections" | "site";

export function EditorPage() {
  const { id } = useParams();
  if (!id) return <ErrorScreen message="Missing site id." />;
  return <Editor siteId={id} />;
}

function Editor({ siteId }: { siteId: string }) {
  const backend = useBackend();
  const editor = useSiteDocument(siteId);
  const [tab, setTab] = useState<Tab>("sections");
  const [device, setDevice] = useState<Device>("desktop");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const ready = editor.load.kind === "ready" ? editor.load : null;
  const doc = ready?.doc ?? null;
  const siteSlug = ready?.site.slug ?? "site";

  const selected: Section | undefined = useMemo(
    () => doc?.sections.find((s) => s.id === selectedId) ?? doc?.sections[0],
    [doc, selectedId],
  );

  useEffect(() => {
    if (editor.save.kind === "error") toast.error("Could not save", { description: editor.save.message });
  }, [editor.save]);

  async function handleExport() {
    if (!doc) return;
    setExporting(true);
    try {
      const parsed = SiteDocument.safeParse(doc);
      if (!parsed.success) throw new Error(`Fix this before exporting: ${formatIssue(parsed.error)}`);
      const blob = await buildExportZip(parsed.data, backend);
      downloadBlob(blob, exportFileName(parsed.data, siteSlug, backend.mode));
      toast.success("ZIP downloaded", { description: "Drop it on cloudflare.com/drop to go live." });
    } catch (err) {
      toast.error("Export failed", { description: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setExporting(false);
    }
  }

  function openPreviewTab() {
    if (!doc) return;
    try {
      const { html } = renderSite(doc, { imageUrl: (ref) => backend.imageUrl(ref) });
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error("Preview failed", { description: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  if (editor.load.kind === "loading") return <LoadingScreen />;
  if (editor.load.kind === "error" || !doc) {
    return <ErrorScreen message={editor.load.kind === "error" ? editor.load.message : "Site not found."} />;
  }

  const issue = editor.save.kind === "invalid" ? editor.save.message : null;
  const SelectedIcon = selected ? SECTION_ICONS[selected.type] : null;

  return (
    <SiteIdProvider value={siteId}>
      <div className="flex h-dvh flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm" aria-label="Back to your sites">
                <Link to="/">
                  <ArrowLeft />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Your sites</TooltipContent>
          </Tooltip>
          <Brand compact />
          <Separator orientation="vertical" className="h-5!" />
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{doc.meta.orgName || "Untitled site"}</h1>
          <SaveIndicator state={editor.save} />
          <Separator orientation="vertical" className="h-5!" />
          <Button variant="outline" size="sm" disabled={exporting} onClick={() => void handleExport()}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            Export
          </Button>
          <Button size="sm" onClick={() => setPublishOpen(true)}>
            <Rocket />
            Publish
          </Button>
          <ThemeToggle />
          <UserMenu />
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(340px,400px)_1fr]">
          <aside className="flex min-h-0 flex-col border-r bg-sidebar">
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
                    sections={doc.sections}
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
                        key={selected.id}
                        value={selected}
                        fields={SECTION_FIELDS[selected.type]}
                        onChange={(next: Obj) => editor.replaceSection(next as Section)}
                      />
                    </section>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="site" className="min-h-0 flex-1 overflow-y-auto">
                <div className="p-3">
                  <SiteForm doc={doc} update={editor.update} />
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
                doc={doc}
                device={device}
                hostname={`${siteSlug}.sites.shofar.io`}
                focusSectionId={tab === "sections" ? (selected?.id ?? null) : null}
              />
            </div>
          </main>
        </div>

        <PublishModal open={publishOpen} busy={exporting} onOpenChange={setPublishOpen} onDownload={() => void handleExport()} />
      </div>
    </SiteIdProvider>
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

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertCircle className="size-6 text-destructive" aria-hidden="true" />
      <p role="alert" className="text-sm">
        {message}
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">
          <ArrowLeft />
          Back to your sites
        </Link>
      </Button>
    </div>
  );
}
