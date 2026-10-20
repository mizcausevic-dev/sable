import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/interactive";
import { Badge, Denied, PageHeader } from "@/components/ui";
import { formatTimestamp } from "@/lib/time";
import { can } from "@/lib/permissions";
import { contactAction, customFieldsAction, grantClientAccessAction, noteAction, stageAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asText, loadClient, loadMembers, mapDefinitions } from "@/server/load";

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { user, org } = await requireOrg();
  if (!can(org.role, "clients.read")) return <Denied what="read clients" />;
  const { clientId } = await params;
  const bundle = await loadClient(user.id, org.organizationId, clientId);
  if (!bundle) notFound();
  const definitions = mapDefinitions(bundle.definitions);
  const fields = (bundle.client.custom_fields ?? {}) as Record<string, string>;
  const members = can(org.role, "finance.write") ? await loadMembers(user.id, org.organizationId) : null;
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: org.name }, { href: "/app/clients", label: "Clients" }, { label: asText(bundle.client.name) }]}
        title={asText(bundle.client.name)}
        actions={<Badge>{asText(bundle.client.stage)}</Badge>}
      />
      <div className="grid-2">
        <div className="panel">
          <h2>Contacts</h2>
          {bundle.contacts.length === 0 ? <p className="muted">No contacts yet.</p> : (
            <ul>{bundle.contacts.map((contact) => <li key={asText(contact.id)}>{asText(contact.name)} <span className="muted">{asText(contact.title)} {asText(contact.email)}</span></li>)}</ul>
          )}
          {can(org.role, "clients.write") ? (
            <ActionForm action={contactAction} submit="Add contact">
              <input type="hidden" name="clientId" value={clientId} />
              <label className="field">Name<input name="name" required /></label>
              <label className="field">Email<input name="email" type="email" /></label>
              <label className="field">Phone<input name="phone" /></label>
              <label className="field">Title<input name="title" /></label>
            </ActionForm>
          ) : null}
        </div>
        <div className="panel">
          <h2>Stage and fields</h2>
          {can(org.role, "clients.write") ? (
            <form action={stageAction} className="row-actions">
              <input type="hidden" name="clientId" value={clientId} />
              <select name="stage" defaultValue={asText(bundle.client.stage)} aria-label="Lifecycle stage">
                {["lead", "qualified", "active", "paused", "closed"].map((stage) => <option key={stage}>{stage}</option>)}
              </select>
              <button className="btn" type="submit">Update stage</button>
            </form>
          ) : null}
          {definitions.length === 0 ? <p className="muted">No custom fields configured.</p> : (
            <ActionForm action={customFieldsAction} submit="Save fields">
              <input type="hidden" name="clientId" value={clientId} />
              {definitions.map((definition) => (
                <label key={definition.key} className="field">{definition.label}
                  {definition.fieldType === "select" ? (
                    <select name={`field.${definition.key}`} defaultValue={fields[definition.key] ?? ""}>
                      <option value=""></option>
                      {definition.options.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  ) : <input name={`field.${definition.key}`} defaultValue={fields[definition.key] ?? ""} />}
                </label>
              ))}
            </ActionForm>
          )}
        </div>
      </div>
      <section className="panel">
        <h2>Notes</h2>
        <ul>
          {bundle.notes.map((note) => (
            <li key={asText(note.id)}>{note.internal ? <Badge tone="warn">Internal</Badge> : <Badge>Portal</Badge>} {asText(note.body)}</li>
          ))}
        </ul>
        {can(org.role, "clients.write") ? (
          <ActionForm action={noteAction} submit="Add note">
            <input type="hidden" name="clientId" value={clientId} />
            <label className="field">Note<textarea name="body" required /></label>
            <label><input type="checkbox" name="internal" defaultChecked /> Internal</label>
          </ActionForm>
        ) : null}
      </section>
      <section className="panel">
        <h2>Activity</h2>
        {bundle.activity.length === 0 ? <p className="muted">No activity yet.</p> : (
          <ul>{bundle.activity.map((item) => <li key={asText(item.id)}>{asText(item.summary)} <span className="muted">{formatTimestamp(String(item.created_at), org.timezone)}</span></li>)}</ul>
        )}
      </section>
      <section className="panel">
        <h2>Projects</h2>
        <ul>{bundle.projects.map((project) => <li key={asText(project.id)}><Link href={`/app/projects/${asText(project.id)}`}>{asText(project.name)}</Link></li>)}</ul>
      </section>
      <section className="panel">
        <h2>Files</h2>
        <ul>{bundle.files.map((file) => <li key={asText(file.id)}><a href={`/api/files/${asText(file.id)}`}>{asText(file.filename)}</a> {file.internal ? <Badge tone="warn">Internal</Badge> : null}</li>)}</ul>
        {can(org.role, "files.write") ? (
          <form action="/api/files" method="post" encType="multipart/form-data" className="form-grid">
            <input type="hidden" name="entityType" value="client" />
            <input type="hidden" name="entityId" value={clientId} />
            <label className="field">File<input type="file" name="file" required /></label>
            <label><input type="checkbox" name="internal" defaultChecked /> Internal</label>
            <button className="btn" type="submit">Upload</button>
          </form>
        ) : null}
      </section>
      {members ? (
        <section className="panel">
          <h2>Portal access</h2>
          <p className="muted">Client-role members only see clients and projects explicitly assigned here.</p>
          <form action={grantClientAccessAction} className="form-grid">
            <input type="hidden" name="clientId" value={clientId} />
            <label className="field">Client user
              <select name="userId">{members.members.filter((member) => member.role === "client").map((member) => <option key={asText(member.id)} value={asText(member.id)}>{asText(member.name)}</option>)}</select>
            </label>
            <label className="field">Project
              <select name="projectId"><option value="">Client only</option>{bundle.projects.map((project) => <option key={asText(project.id)} value={asText(project.id)}>{asText(project.name)}</option>)}</select>
            </label>
            <button className="btn" type="submit">Grant access</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
