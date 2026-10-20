import Link from "next/link";
import { Badge, Denied, Empty, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireOrg } from "@/server/context";
import { asText, loadProjects } from "@/server/load";

export default async function ProjectsPage() {
  const { user, org } = await requireOrg();
  if (!can(org.role, "projects.read")) return <Denied what="read projects" />;
  const projects = await loadProjects(user.id, org.organizationId);
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: org.name }, { label: "Projects" }]}
        title="Projects"
        actions={can(org.role, "projects.write") ? <Link className="btn primary" href="/app/projects/new">New project</Link> : null}
      />
      {projects.length === 0 ? <Empty title="No projects yet" body="Projects stay attached to a client in this organization." href="/app/projects/new" action={can(org.role, "projects.write") ? "New project" : undefined} /> : (
        <div className="table-wrap panel">
          <table>
            <caption className="muted">Projects</caption>
            <thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Start</th><th>End</th></tr></thead>
            <tbody>
              {projects.map((project) => (
                <tr key={asText(project.id)}>
                  <td><Link href={`/app/projects/${asText(project.id)}`}>{asText(project.name)}</Link></td>
                  <td>{asText(project.client_name)}</td>
                  <td><Badge>{asText(project.status)}</Badge></td>
                  <td className="num">{asText(project.start_on)}</td>
                  <td className="num">{asText(project.end_on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
