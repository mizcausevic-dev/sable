import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  crumbs,
  title,
  actions,
}: {
  crumbs: { href?: string; label: string }[];
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`}>
              {index > 0 ? <span aria-hidden="true"> / </span> : null}
              {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span>{crumb.label}</span>}
            </span>
          ))}
        </nav>
        <h1>{title}</h1>
      </div>
      {actions ? <div className="row-actions">{actions}</div> : null}
    </header>
  );
}

export function Empty({ title, body, href, action }: { title: string; body: string; href?: string; action?: string }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      {href && action ? <Link className="btn primary" href={href}>{action}</Link> : null}
    </div>
  );
}

export function Denied({ what }: { what: string }) {
  return (
    <div className="denied" role="alert">
      <h2>Permission denied</h2>
      <p>Your role in this organization cannot {what}. The record was not loaded.</p>
    </div>
  );
}

export function Money({ minor, currency }: { minor: number; currency: string }) {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % 100).toString().padStart(2, "0");
  return <span className="num">{negative ? "-" : ""}{currency} {whole}.{fraction}</span>;
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return <span className={`badge ${tone ?? ""}`}>{children}</span>;
}
