import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { statusAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asText, loadProject } from "@/server/load";

const STATUSES = ["backlog", "ready", "in_progress", "blocked", "done"] as const;

export default async function BoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { user, org } = await requireOrg();
  if (!can(org.role, "projects.read")) return <Denied what="read projects" />;
  const { projectId } = await params;
  const bundle = await loadProject(user.id, org.organizationId, projectId);
  if (!bundle) notFound();
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: org.name }, { href: "/app/projects", label: "Projects" }, { href: `/app/projects/${projectId}`, label: asText(bundle.project.name) }, { label: "Board" }]}
        title="Board"
        actions={<Link className="btn" href={`/app/projects/${projectId}/calendar`}>Calendar</Link>}
      />
      <div className="kanban">
        {STATUSES.map((status) => (
          <section key={status} aria-label={status}>
            <h2>{status.replaceAll("_", " ")}</h2>
            {bundle.tasks.filter((task) => task.status === status).map((task) => (
              <article key={asText(task.id)} className="card">
                <Link href={`/app/projects/${projectId}/tasks/${asText(task.id)}`}>{asText(task.title)}</Link>
                <p className="muted">{asText(task.due_on) || "No due date"} · {asText(task.assignees) || "Unassigned"}</p>
                {can(org.role, "tasks.write") ? (
                  <form action={statusAction}>
                    <input type="hidden" name="taskId" value={asText(task.id)} />
                    <label className="field">Move
                      <select name="status" defaultValue={status}>{STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                    </label>
                    <button className="btn" type="submit">Update</button>
                  </form>
                ) : null}
              </article>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
