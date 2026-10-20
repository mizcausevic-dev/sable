"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { idleState, type ActionState } from "@/lib/action";

const THEMES = ["steel", "bento", "cosmic", "swiss", "aqua", "brutal", "parchment"] as const;

export function ThemeControls() {
  const [theme, setTheme] = useState("steel");
  const [mode, setMode] = useState("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || "steel");
    setMode(document.documentElement.dataset.mode || "dark");
  }, []);
  function apply(nextTheme: string, nextMode: string) {
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.dataset.mode = nextMode;
    localStorage.setItem("sable-theme", nextTheme);
    localStorage.setItem("sable-mode", nextMode);
    setTheme(nextTheme);
    setMode(nextMode);
  }
  return (
    <div className="row-actions">
      <label className="field">
        Theme
        <select aria-label="Theme" value={theme} onChange={(event) => apply(event.target.value, mode)}>
          {THEMES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <button className="btn" type="button" onClick={() => apply(theme, mode === "dark" ? "light" : "dark")}>
        {mode === "dark" ? "Light" : "Dark"}
      </button>
    </div>
  );
}

export function Shell({
  collapsedDefault,
  brand,
  links,
  children,
  tools,
}: {
  collapsedDefault?: boolean;
  brand: ReactNode;
  links: { href: string; label: string }[];
  children: ReactNode;
  tools: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(collapsedDefault ?? false);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem("sable-sidebar") === "1");
  }, []);
  return (
    <div className={`shell ${collapsed ? "collapsed" : ""} ${navOpen ? "nav-open" : ""}`}>
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">{brand}</div>
        <nav>
          {links.map((link) => {
            const current = link.href === "/app" ? pathname === "/app" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} className="nav-link" href={link.href} aria-current={current ? "page" : undefined} onClick={() => setNavOpen(false)}>
                {collapsed ? link.label.slice(0, 1) : link.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="btn" type="button" aria-expanded={!collapsed} onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            localStorage.setItem("sable-sidebar", next ? "1" : "0");
          }}>
            {collapsed ? "Expand" : "Collapse"} sidebar
          </button>
          <button className="btn" type="button" onClick={() => setNavOpen((open) => !open)}>Menu</button>
          {tools}
        </div>
        <div className="page" id="content">{children}</div>
      </div>
    </div>
  );
}

export function ActionForm({
  action,
  children,
  submit = "Save",
  className = "form-grid",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submit?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.notice ? <p role="status">Invitation link: <a href={state.notice}>{state.notice}</a>. Email delivery is not implemented.</p> : null}
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Saving" : submit}</button>
    </form>
  );
}

export function CommandPalette({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ kind: string; label: string; href: string }[]>([]);
  const [active, setActive] = useState(0);
  const commands = useMemo(() => [
    { kind: "Go", label: "Clients", href: "/app/clients" },
    { kind: "Go", label: "Projects", href: "/app/projects" },
    { kind: "Go", label: "New project", href: "/app/projects/new" },
    { kind: "Go", label: "Revenue", href: "/app/revenue" },
    { kind: "Go", label: "Reports", href: "/app/reports" },
    { kind: "Go", label: "Workload", href: "/app/reports/workload" },
    { kind: "Go", label: "Members", href: "/app/settings/members" },
    { kind: "Go", label: "Billing", href: "/app/settings/billing" },
  ], []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      void fetch(`/api/search?q=${encodeURIComponent(query)}`).then(async (response) => {
        if (!response.ok) return;
        setHits(await response.json());
        setActive(0);
      });
    }, 120);
    return () => clearTimeout(handle);
  }, [query, open, orgId]);
  const items = query.trim() ? hits : commands;
  if (!open) {
    return <button className="btn" type="button" onClick={() => setOpen(true)}>Search <span className="muted">Ctrl K</span></button>;
  }
  return (
    <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <input
        autoFocus
        aria-label="Search records and commands"
        value={query}
        placeholder="Clients, projects, invoices, or a destination"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, items.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
          if (event.key === "Enter" && items[active]) window.location.href = items[active].href;
        }}
      />
      <div>
        {items.map((item, index) => (
          <Link key={`${item.href}-${item.label}`} href={item.href} data-active={index === active} onClick={() => setOpen(false)}>
            <span className="muted">{item.kind} · </span>{item.label}
          </Link>
        ))}
        {query.trim() && hits.length === 0 ? <p className="muted">No matching records in this organization.</p> : null}
      </div>
      <button className="btn" type="button" onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}

export function ConfirmSubmit({
  label,
  title,
  confirm,
  action,
  fields,
}: {
  label: string;
  title: string;
  confirm: string;
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="btn danger" type="button" onClick={() => ref.current?.showModal()}>{label}</button>
      <dialog ref={ref} aria-labelledby="confirm-title">
        <form action={action}>
          <h2 id="confirm-title">{title}</h2>
          {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <div className="row-actions">
            <button className="btn danger" type="submit">{confirm}</button>
            <button className="btn" type="button" onClick={() => ref.current?.close()}>Cancel</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
