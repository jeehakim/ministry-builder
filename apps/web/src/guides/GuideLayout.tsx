import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ArrowLeft, BookOpen, Globe, Sparkles } from "lucide-react";
import { Brand } from "../components/Brand";
import { ThemeToggle } from "../components/ThemeToggle";
import { UserMenu } from "../components/UserMenu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const GUIDES = [
  { path: "/guide/ai", label: "Using the AI copilot", Icon: Sparkles },
  { path: "/guide/domains", label: "Your own domain", Icon: Globe },
  { path: "/guide/publish", label: "Publishing and hosting", Icon: BookOpen },
] as const;

/** Shared frame for the in-app guides: brand header, guide nav, readable column. */
export function GuideLayout({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-1 lg:sticky lg:top-6 lg:self-start">
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/">
              <ArrowLeft />
              Your sites
            </Link>
          </Button>
          <p className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Guides</p>
          {GUIDES.map((g) => (
            <Link
              key={g.path}
              to={g.path}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                pathname === g.path ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              <g.Icon className="size-4" aria-hidden="true" />
              {g.label}
            </Link>
          ))}
        </aside>
        <main className="min-w-0">
          <article className="rounded-xl border bg-background p-6 shadow-xs sm:p-10">
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-muted-foreground">{intro}</p>
            <div className="guide-body mt-8 space-y-8">{children}</div>
          </article>
        </main>
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{i + 1}</span>
          <div className="min-w-0">{item}</div>
        </li>
      ))}
    </ol>
  );
}

export function Tip({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-brand/30 bg-brand-soft/50 px-4 py-3 text-sm">{children}</div>;
}

export function Code({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">{children}</code>;
}
