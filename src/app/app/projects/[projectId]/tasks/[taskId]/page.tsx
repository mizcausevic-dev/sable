import { notFound } from "next/navigation";
import { ActionForm } from "@/components/interactive";
import { Badge, Denied, PageHeader } from "@/components/ui";
import { formatTimestamp } from "@/lib/time";
import { can } from "@/lib/permissions";
import { assignAction, commentAction, dependencyAction, labelAction, statusAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asText, loadMembers, loadTask } from "@/server/load";

const STATUSES = ["backlog", "ready", "in_progress", "blocked", "done"];

export default async function TaskPage({ params }: { params: Promise<{ projectId: string; taskId: string }> }) {
  const { user, org } = await requireOrg();
  if (!can(org.role, "projects.read")) return <Denied what="read projects" />;
  const { projectId, taskId } = await params;
  const bundle = await loadTask(user.id, org.organizationId, taskId);
  if (!bundle || asText(bundle.task.project_id) !== projectId) notFound();
  const members = can(org.role, "tasks.write") ? await loadMembers(user.id, org.organizationId) : null;
  const task = bundle.task;
  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/app", label: org.name },
          { href: "/app/projects", label: "Projects" },
          { href: `/app/projects/${projectId}`, label: asText(task.project_name) },
          { label: asText(task.title) },
        ]}
        title={asText(task.title)}
        actions={<Badge>{asText(task.status)}</Badge>}
      />
      <p>{asText(task.detail) || "No detail."}</p>
      <p className="muted">Due {asText(task.due_on) || "unset"} · timezone {asText(task.timezone)} · {task.client_visible ? "client visible" : "staff only"}</p>
      {can(org.role, "tasks.write") ? (
        <form action={statusAction} className="row-actions">
          <input type="hidden" name="taskId" value={taskId} />
          <select name="status" defaultValue={asText(task.status)} aria-label="Status">{STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
          <button className="btn primary" type="submit">Update status</button>
        </form>
      ) : null}
      <section className="panel">
        <h2>Assignees</h2>
        <ul>{bundle.assignees.map((person) => <li key={asText(person.id)}>{asText(person.name)}</li>)}</ul>
        {members ? (
          <form action={assignAction} className="row-actions">
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="title" value={asText(task.title)} />
            <select name="userId" aria-label="Assignee">
              {(org.role === "contributor" ? members.members.filter((member) => asText(member.id) === user.id) : members.members.filter((member) => member.role !== "client")).map((member) => (
                <option key={asText(member.id)} value={asText(member.id)}>{asText(member.name)}</option>
              ))}
            </select>
            <button className="btn" type="submit">Assign</button>
          </form>
        ) : null}
      </section>
      <section className="panel">
        <h2>Dependencies</h2>
        <ul>
          {bundle.dependencies.map((dependency) => (
            <li key={`${asText(dependency.predecessor_id)}-${asText(dependency.successor_id)}`}>
              {asText(dependency.predecessor)} blocks {asText(dependency.successor)}
            </li>
          ))}
        </ul>
        {can(org.role, "tasks.write") ? (
          <ActionForm action={dependencyAction} submit="Add dependency">
            <input type="hidden" name="successorId" value={taskId} />
            <label className="field">Blocked by
              <select name="predecessorId">{bundle.siblings.map((sibling) => <option key={asText(sibling.id)} value={asText(sibling.id)}>{asText(sibling.title)}</option>)}</select>
            </label>
          </ActionForm>
        ) : null}
      </section>
      {can(org.role, "tasks.write") ? (
        <form action={labelAction} className="row-actions">
          <input type="hidden" name="taskId" value={taskId} />
          <input name="name" aria-label="Label name" required />
          <input name="color" defaultValue="#8a8175" aria-label="Label color" />
          <button className="btn" type="submit">Add label</button>
        </form>
      ) : null}
      <section className="panel">
        <h2>Comments</h2>
        <ul>
          {bundle.comments.map((comment) => (
            <li key={asText(comment.id)}>
              <strong>{asText(comment.author)}</strong> {comment.internal ? <Badge tone="warn">Internal</Badge> : null}
              <p>{asText(comment.body)}</p>
              <span className="muted">{formatTimestamp(String(comment.created_at), asText(task.timezone))}</span>
            </li>
          ))}
        </ul>
        <ActionForm action={commentAction} submit="Comment">
          <input type="hidden" name="taskId" value={taskId} />
          <label className="field">Comment<textarea name="body" required /></label>
          {org.role !== "client" ? <label><input type="checkbox" name="internal" defaultChecked /> Internal</label> : null}
        </ActionForm>
      </section>
    </>
  );
}
