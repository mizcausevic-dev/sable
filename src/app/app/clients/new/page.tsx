import { ActionForm } from "@/components/interactive";
import { Denied, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { createClientAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { loadClient, mapDefinitions } from "@/server/load";
import { withUser } from "@/lib/db";

export default async function NewClientPage() {
  const { user, org } = await requireOrg();
  if (!can(org.role, "clients.write")) return <Denied what="create clients" />;
  const definitions = mapDefinitions(await withUser(user.id, (db) =>
    db.query(`select key, label, field_type, required, options, archived from client_field_definitions where organization_id = $1 and archived = false`, [org.organizationId]),
  ));
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { href: "/app/clients", label: "Clients" }, { label: "New" }]} title="New client" />
      <div className="panel">
        <ActionForm action={createClientAction} submit="Create client">
          <label className="field">Name<input name="name" required /></label>
          <label className="field">Stage
            <select name="stage" defaultValue="lead">{["lead", "qualified", "active", "paused", "closed"].map((stage) => <option key={stage}>{stage}</option>)}</select>
          </label>
          <label className="field">Website<input name="website" /></label>
          {definitions.map((definition) => (
            <label className="field" key={definition.key}>{definition.label}
              {definition.fieldType === "select" ? (
                <select name={`field.${definition.key}`} defaultValue="">{definition.options.map((option) => <option key={option}>{option}</option>)}</select>
              ) : (
                <input name={`field.${definition.key}`} required={definition.required} />
              )}
            </label>
          ))}
        </ActionForm>
      </div>
    </>
  );
}
