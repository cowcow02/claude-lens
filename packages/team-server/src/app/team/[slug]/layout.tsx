import { getPool } from "../../../db/pool.js";
import { notFound } from "next/navigation";

export default async function TeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pool = getPool();
  const team = await pool.query("SELECT name FROM teams WHERE slug = $1", [slug]);
  if (!team.rowCount) notFound();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav style={{
        width: 220,
        padding: 20,
        borderRight: "1px solid #e5e7eb",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 16 }}>Fleetlens</div>
        <div style={{ color: "#6b7280", fontSize: 14, marginBottom: 16 }}>{team.rows[0].name}</div>
        <a href={`/team/${slug}`} style={{ textDecoration: "none", color: "#111", padding: "6px 0" }}>Roster</a>
        <a href={`/team/${slug}/settings`} style={{ textDecoration: "none", color: "#111", padding: "6px 0" }}>Settings</a>
      </nav>
      <main style={{ flex: 1, padding: 24 }}>
        {children}
      </main>
    </div>
  );
}
