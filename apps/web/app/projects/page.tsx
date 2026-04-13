import { listSessions } from "@/lib/data";
import { groupByProject } from "@claude-lens/parser";
import { ProjectsView } from "./projects-view";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const sessions = await listSessions();
  const projects = groupByProject(sessions);

  return (
    <div style={{ maxWidth: 1280, padding: "32px 40px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
          Projects
        </h1>
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
          {projects.length} project{projects.length === 1 ? "" : "s"} across{" "}
          {sessions.length} session{sessions.length === 1 ? "" : "s"}.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="af-empty">No projects found.</div>
      ) : (
        <ProjectsView projects={projects} />
      )}
    </div>
  );
}
