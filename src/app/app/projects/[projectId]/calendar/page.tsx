import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { monthBounds, shiftMonth, todayInTimeZone } from "@/lib/time";
import { requireOrg } from "@/server/context";
import { asText, loadProject } from "@/server/load";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { user, org } = await requireOrg();
  if (!can(org.role, "projects.read")) return <Denied what="read projects" />;
  const { projectId } = await params;
  const bundle = await loadProject(user.id, org.organizationId, projectId);
  if (!bundle) notFound();
  const timezone = asText(bundle.project.timezone) || org.timezone;
  const today = todayInTimeZone(timezone);
  const requested = (await searchParams).month;
  const month = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : today.slice(0, 7);
  const bounds = monthBounds(month);
  const first = new Date(`${bounds.start}T00:00:00Z`);
  const lead = first.getUTCDay();
  const days = Number(bounds.end.slice(8, 10));
  const cells = Array.from({ length: lead + days }, (_, index) => {
    if (index < lead) return null;
    const day = index - lead + 1;
    return `${month}-${String(day).padStart(2, "0")}`;
  });
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: org.name }, { href: "/app/projects", label: "Projects" }, { href: `/app/projects/${projectId}`, label: asText(bundle.project.name) }, { label: "Calendar" }]}
        title={bounds.label}
        actions={
          <>
            <Link className="btn" href={`?month=${shiftMonth(month, -1)}`}>Previous</Link>
            <Link className="btn" href={`?month=${shiftMonth(month, 1)}`}>Next</Link>
          </>
        }
      />
      <p className="muted">Due dates are calendar dates in {timezone}. Today there is {today}.</p>
      <div className="calendar">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => <strong key={label}>{label}</strong>)}
        {cells.map((day, index) => (
          <div className="day" key={day ?? `blank-${index}`}>
            {day ? <strong>{day.slice(8)}{day === today ? " · today" : ""}</strong> : null}
            {day ? bundle.tasks.filter((task) => asText(task.due_on) === day).map((task) => (
              <Link key={asText(task.id)} href={`/app/projects/${projectId}/tasks/${asText(task.id)}`}>{asText(task.title)}</Link>
            )) : null}
          </div>
        ))}
      </div>
    </>
  );
}
