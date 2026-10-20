import Link from "next/link";
import { ActionForm } from "@/components/interactive";
import { PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { fieldsAction, updateOrganizationAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { withUser } from "@/lib/db";
import { asText } from "@/server/load";

export default async function SettingsPage() {
  const { user, org } = await requireOrg();
  const definitions = can(org.role, "clients.read")
    ? await withUser(user.id, (db) =>
        db.query(
          `select key, label, field_type, required from client_field_definitions where organization_id = $1 and archived = false order by label`,
          [org.organizationId],
        ),
      )
    : [];
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { label: "Settings" }]} title="Settings" />
      <nav className="row-actions" aria-label="Settings">
        <Link className="btn" href="/app/settings/members">Members</Link>
        <Link className="btn" href="/app/settings/notifications">Notifications</Link>
        <Link className="btn" href="/app/settings/billing">Billing</Link>
        <Link className="btn" href="/app/settings/audit">Audit</Link>
      </nav>
      <section className="panel">
        <h2>Organization</h2>
        <p>Currency is {org.currency}. It is fixed at creation so reports never mix currencies. Your role is {org.role}.</p>
        {can(org.role, "org.settings") ? (
          <ActionForm action={updateOrganizationAction} submit="Save settings">
            <label className="field">Name<input name="name" defaultValue={org.name} required /></label>
            <label className="field">Timezone<input name="timezone" defaultValue={org.timezone} required /></label>
          </ActionForm>
        ) : (
          <p className="muted">{org.name} · {org.timezone}. Organization settings require the owner or admin role.</p>
        )}
      </section>
      <section className="panel">
        <h2>Client custom fields</h2>
        {definitions.length === 0 ? <p className="muted">No active field definitions.</p> : (
          <ul>{definitions.map((field) => <li key={asText(field.key)}>{asText(field.label)} · {asText(field.field_type)}{field.required ? " · required" : ""}</li>)}</ul>
        )}
        {can(org.role, "clients.write") ? (
          <ActionForm action={fieldsAction} submit="Add field">
            <label className="field">Key<input name="key" required placeholder="industry" /></label>
            <label className="field">Label<input name="label" required /></label>
            <label className="field">Type
              <select name="fieldType" defaultValue="text">
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="date">date</option>
                <option value="select">select</option>
              </select>
            </label>
            <label className="field">Select options<input name="options" placeholder="Logistics, Publishing" /></label>
            <label><input type="checkbox" name="required" /> Required</label>
          </ActionForm>
        ) : null}
      </section>
    </>
  );
}
