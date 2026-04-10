import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { listProjects, walkJsonlFiles } from "@claude-sessions/parser/fs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Sessions",
  description: "Local-only dashboard for Claude Code sessions.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Fast-path: listProjects() only does fs.stat — no JSONL parsing —
  // so the layout adds ~50ms instead of ~14s (vs. the old listSessions
  // + groupByProject combo).
  const [projects, allFiles] = await Promise.all([listProjects(), walkJsonlFiles()]);
  const totalSessions = allFiles.length;

  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <Sidebar projects={projects} totalSessions={totalSessions} />
          <main
            style={{
              flex: 1,
              minWidth: 0,
              padding: "32px 40px",
              overflow: "auto",
            }}
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
