import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { SiteDocument, type Section } from "@ministry/schema";
import { useBackend } from "../backend-context";
import { SaveIndicator } from "../components/SaveIndicator";
import { PublishModal } from "../components/PublishModal";
import { btnCls, btnPrimaryCls } from "../components/ui";
import { buildExportZip, downloadBlob, exportFileName } from "../lib/exportZip";
import { formatIssue } from "./documentOps";
import { SiteIdProvider } from "./EditorContext";
import { FieldsForm } from "./FieldsForm";
import { SECTION_FIELDS, type Obj } from "./fields";
import { Preview, type Device } from "./Preview";
import { SectionList } from "./SectionList";
import { SiteForm } from "./SiteForm";
import { useSiteDocument } from "./useSiteDocument";
import { UserMenu } from "../components/UserMenu";

type Tab = "sections" | "site";

export function EditorPage() {
  const { id } = useParams();
  if (!id) return <p className="p-6 text-sm text-red-700">Missing site id.</p>;
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
  const [exportError, setExportError] = useState<string | null>(null);

  const ready = editor.load.kind === "ready" ? editor.load : null;
  const doc = ready?.doc ?? null;
  const siteSlug = ready?.site.slug ?? "site";

  const selected: Section | undefined = useMemo(
    () => doc?.sections.find((s) => s.id === selectedId) ?? doc?.sections[0],
    [doc, selectedId],
  );

  async function handleExport() {
    if (!doc) return;
    setExporting(true);
    setExportError(null);
    try {
      const parsed = SiteDocument.safeParse(doc);
      if (!parsed.success) throw new Error(`Fix this before exporting: ${formatIssue(parsed.error)}`);
      const blob = await buildExportZip(parsed.data, backend);
      downloadBlob(blob, exportFileName(parsed.data, siteSlug, backend.mode));
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  if (editor.load.kind === "loading") return <p className="p-6 text-sm text-slate-600">Loading site...</p>;
  if (editor.load.kind === "error" || !doc) {
    return (
      <div className="p-6">
        <p role="alert" className="text-sm text-red-700">
          {editor.load.kind === "error" ? editor.load.message : "Site not found."}
        </p>
        <Link to="/" className="mt-2 inline-block text-sm text-sky-700 underline">
          Back to your sites
        </Link>
      </div>
    );
  }

  const issue = editor.save.kind === "invalid" ? editor.save.message : null;

  return (
    <SiteIdProvider value={siteId}>
      <div className="flex h-screen flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-900">
            Sites
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{doc.meta.orgName || "Untitled site"}</h1>
          <SaveIndicator state={editor.save} />
          <button type="button" className={btnCls} disabled={exporting} onClick={() => void handleExport()}>
            {exporting ? "Exporting..." : "Export ZIP"}
          </button>
          <button type="button" className={btnPrimaryCls} onClick={() => setPublishOpen(true)}>
            Publish
          </button>
          <UserMenu />
        </header>

        {exportError && !publishOpen ? (
          <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-sm text-red-800">
            {exportError}
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,420px)_1fr]">
          <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-slate-50">
            <div role="tablist" aria-label="Editor" className="flex border-b border-slate-200 bg-white">
              {(["sections", "site"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={`tab-${t}`}
                  aria-selected={tab === t}
                  aria-controls={`panel-${t}`}
                  onClick={() => setTab(t)}
                  className={`flex-1 border-b-2 px-3 py-2 text-sm font-medium capitalize ${
                    tab === t ? "border-sky-700 text-sky-800" : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {issue ? (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {issue}
                </p>
              ) : null}

              {tab === "sections" ? (
                <>
                  <SectionList
                    sections={doc.sections}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelectedId}
                    onMove={editor.moveSection}
                    onToggleHidden={editor.toggleHidden}
                    onDelete={editor.removeSection}
                    onAdd={(type) => {
                      editor.addSection(type);
                      setSelectedId(null);
                    }}
                  />
                  {selected ? (
                    <section aria-label={`Edit ${selected.type} section`} className="rounded-md border border-slate-200 bg-white p-3">
                      <FieldsForm
                        key={selected.id}
                        value={selected}
                        fields={SECTION_FIELDS[selected.type]}
                        onChange={(next: Obj) => editor.replaceSection(next as Section)}
                      />
                    </section>
                  ) : null}
                </>
              ) : (
                <SiteForm doc={doc} update={editor.update} />
              )}
            </div>
          </aside>

          <main className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-1.5">
              <span className="text-xs font-medium text-slate-500">Live preview</span>
              <div role="group" aria-label="Preview width" className="flex overflow-hidden rounded-md border border-slate-300">
                {(["desktop", "mobile"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={device === d}
                    onClick={() => setDevice(d)}
                    className={`px-3 py-1 text-xs capitalize ${device === d ? "bg-slate-800 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Preview doc={doc} device={device} focusSectionId={tab === "sections" ? (selected?.id ?? null) : null} />
            </div>
          </main>
        </div>

        {publishOpen ? (
          <PublishModal
            busy={exporting}
            error={exportError}
            onDownload={() => void handleExport()}
            onClose={() => {
              setPublishOpen(false);
              setExportError(null);
            }}
          />
        ) : null}
      </div>
    </SiteIdProvider>
  );
}
