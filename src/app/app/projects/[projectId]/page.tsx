import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/interactive";
import { Badge, Denied, Money, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { budgetAction, createTaskAction, milestoneAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asMinorOrNull, asText, loadProject } from "@/server/load";

const STATUSES = ["backlog", "ready", "in_progress", "blocked", "done"];

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { user, org } = await requireOrg();
  if (!can(org.role, "projects.read")) return <Denied what="read projects" />;
  const { projectId } = await params;
  const bundle = await loadProject(user.id, org.organizationId, projectId);
  if (!bundle) notFound();
  const project = bundle.project;
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: org.name }, { href: "/app/projects", label: "Projects" }, { label: asText(project.name) }]}
        title={asText(project.name)}
        actions={
          <>
            <Link className="btn" href={`/app/projects/${projectId}`}>List</Link>
            <Link className="btn" href={`/app/projects/${projectId}/board`}>Board</Link>
            <Link className="btn" href={`/app/projects/${projectId}/calendar`}>Calendar</Link>
          </>
        }
      />
      <p className="muted">{asText(project.client_name)} · {asText(project.timezone)} · {asText(project.start_on) || "No start"} to {asText(project.end_on) || "no end"}</p>
      <p>{asText(project.description)}</p>
      <div className="table-wrap panel">
        <table>
          <caption className="muted">Tasks</caption>
          <thead><tr><th>Task</th><th>Status</th><th>Due</th><th>Assignees</th><th>Portal</th></tr></thead>
          <tbody>
            {bundle.tasks.map((task) => (
              <tr key={asText(task.id)}>
                <td><Link href={`/app/projects/${projectId}/tasks/${asText(task.id)}`}>{asText(task.title)}</Link></td>
                <td><Badge>{asText(task.status)}</Badge></td>
                <td className="num">{asText(task.due_on)}</td>
                <td>{asText(task.assignees)}</td>
                <td>{task.client_visible ? "Visible" : "Staff"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can(org.role, "tasks.write") ? (
        <section className="panel">
          <h2>Add task</h2>
          <ActionForm action={createTaskAction} submit="Add task">
            <input type="hidden" name="projectId" value={projectId} />
            <label className="field">Title<input name="title" required /></label>
            <label className="field">Detail<textarea name="detail" /></label>
            <label className="field">Status<select name="status" defaultValue="backlog">{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
            <label className="field">Due<input name="dueOn" type="date" /></label>
            <label className="field">Parent
              <select name="parentTaskId"><option value="">None</option>{bundle.tasks.map((task) => <option key={asText(task.id)} value={asText(task.id)}>{asText(task.title)}</option>)}</select>
            </label>
            <label className="field">Milestone
              <select name="milestoneId"><option value="">None</option>{bundle.milestones.map((milestone) => <option key={asText(milestone.id)} value={asText(milestone.id)}>{asText(milestone.name)}</option>)}</select>
            </label>
            <label><input type="checkbox" name="clientVisible" /> Visible on the client portal</label>
          </ActionForm>
        </section>
      ) : null}
      <section className="panel">
        <h2>Milestones</h2>
        <ul>{bundle.milestones.map((milestone) => <li key={asText(milestone.id)}>{asText(milestone.name)} <span className="num">{asText(milestone.due_on)}</span></li>)}</ul>
        {can(org.role, "projects.write") ? (
          <form action={milestoneAction} className="row-actions">
            <input type="hidden" name="projectId" value={projectId} />
            <input name="name" aria-label="Milestone name" required />
            <input name="dueOn" type="date" aria-label="Milestone date" />
            <button className="btn" type="submit">Add milestone</button>
          </form>
        ) : null}
      </section>
      {can(org.role, "finance.internal") ? (
        <section className="panel">
          <h2>Internal budget</h2>
          <p>Revenue budget {bundle.budget ? <Money minor={asMinorOrNull(bundle.budget.revenue_budget_minor) ?? 0} currency={org.currency} /> : "not set"}. Cost budget {bundle.budget && bundle.budget.cost_budget_minor != null ? <Money minor={asMinorOrNull(bundle.budget.cost_budget_minor) ?? 0} currency={org.currency} /> : "not set"}.</p>
          <ActionForm action={budgetAction} submit="Save budget">
            <input type="hidden" name="projectId" value={projectId} />
            <label className="field">Revenue budget<input name="revenue" placeholder="0.00" /></label>
            <label className="field">Cost budget<input name="cost" placeholder="0.00" /></label>
          </ActionForm>
        </section>
      ) : null}
      <section className="panel">
        <h2>Files</h2>
        <ul>{bundle.files.map((file) => <li key={asText(file.id)}><a href={`/api/files/${asText(file.id)}`}>{asText(file.filename)}</a></li>)}</ul>
        {can(org.role, "files.write") ? (
          <form action="/api/files" method="post" encType="multipart/form-data" className="form-grid">
            <input type="hidden" name="entityType" value="project" />
            <input type="hidden" name="entityId" value={projectId} />
            <input type="file" name="file" required aria-label="Project file" />
            <label><input type="checkbox" name="internal" defaultChecked /> Internal</label>
            <button className="btn" type="submit">Upload</button>
          </form>
        ) : null}
      </section>
    </>
  );
}
