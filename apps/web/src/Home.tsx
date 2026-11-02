import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import type { SiteSummary } from "./api";
import { LOCAL_SITE_ID } from "./backend";
import { useBackend } from "./backend-context";
import { UserMenu } from "./components/UserMenu";
import { btnPrimaryCls, inputCls, labelCls } from "./components/ui";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; sites: SiteSummary[] };

export function Home() {
  const backend = useBackend();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [orgName, setOrgName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    backend
      .listSites()
      .then(async (sites) => {
        // Local mode has exactly one site: create the starter on first visit.
        if (backend.mode === "local" && sites.length === 0) {
          await backend.createSite("Your organization");
          return backend.listSites();
        }
        return sites;
      })
      .then((sites) => !cancelled && setState({ kind: "ready", sites }))
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : "Could not load your sites." });
      });
    return () => {
      cancelled = true;
    };
  }, [backend]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = orgName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { site } = await backend.createSite(name);
      void navigate(`/sites/${encodeURIComponent(site.id)}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the site.");
      setCreating(false);
    }
  }

  // Local mode has exactly one site: go straight to it once it exists.
  if (backend.mode === "local" && state.kind === "ready" && state.sites.length > 0) {
    return <Navigate to={`/sites/${LOCAL_SITE_ID}`} replace />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Your sites</h1>
        <UserMenu />
      </div>

      {state.kind === "loading" ? <p className="text-sm text-slate-600">Loading...</p> : null}
      {state.kind === "error" ? (
        <p role="alert" className="mb-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}
        </p>
      ) : null}

      {state.kind === "ready" && state.sites.length > 0 ? (
        <ul className="mb-8 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {state.sites.map((s) => (
            <li key={s.id}>
              <Link to={`/sites/${encodeURIComponent(s.id)}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <span className="font-medium text-slate-900">{s.orgName}</span>
                <span className="text-xs text-slate-500">Updated {new Date(s.updatedAt).toLocaleDateString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {state.kind === "ready" && state.sites.length === 0 ? (
        <p className="mb-6 text-sm text-slate-600">You have no sites yet. Name your organization to start.</p>
      ) : null}

      <form onSubmit={(e) => void handleCreate(e)} className="space-y-2 rounded-md border border-slate-200 bg-white p-4">
        <label className="block">
          <span className={labelCls}>New site: organization name</span>
          <input
            className={inputCls}
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Grace Community Church"
            required
          />
        </label>
        {createError ? (
          <p role="alert" className="text-sm text-red-700">
            {createError}
          </p>
        ) : null}
        <button type="submit" className={btnPrimaryCls} disabled={creating || state.kind === "loading"}>
          {creating ? "Creating..." : "New site"}
        </button>
      </form>
    </div>
  );
}
