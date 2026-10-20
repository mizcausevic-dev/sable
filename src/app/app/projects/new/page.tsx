import { ActionForm } from "@/components/interactive";
import { Denied, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { createProjectAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asText, loadClients, loadTemplates } from "@/server/load";

export default async function NewProjectPage() {
  const { user, org } = await requireOrg();
  if (!can(org.role, "projects.write")) return <Denied what="create projects" />;
  const [clients, templates] = await Promise.all([
    loadClients(user.id, org.organizationId, ""),
    loadTemplates(user.id, org.organizationId),
  ]);
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { href: "/app/projects", label: "Projects" }, { label: "New" }]} title="New project" />
      <div className="panel">
        <ActionForm action={createProjectAction} submit="Create project">
          <label className="field">Client
            <select name="clientId" required>{clients.map((client) => <option key={asText(client.id)} value={asText(client.id)}>{asText(client.name)}</option>)}</select>
          </label>
          <label className="field">Name<input name="name" required /></label>
          <label className="field">Status
            <select name="status" defaultValue="planned">{["planned", "active", "on_hold", "completed", "canceled"].map((status) => <option key={status}>{status}</option>)}</select>
          </label>
          <label className="field">Timezone<input name="timezone" defaultValue={org.timezone} required /></label>
          <label className="field">Start<input name="startOn" type="date" /></label>
          <label className="field">End<input name="endOn" type="date" /></label>
          <label className="field">Template
            <select name="templateId"><option value="">None</option>{templates.map((template) => <option key={asText(template.id)} value={asText(template.id)}>{asText(template.name)}</option>)}</select>
          </label>
          <label className="field">Description<textarea name="description" /></label>
        </ActionForm>
        <p className="muted">Template dates are calendar days after the start date, in the project timezone. They are stored as dates, not timestamps.</p>
      </div>
    </>
  );
}
