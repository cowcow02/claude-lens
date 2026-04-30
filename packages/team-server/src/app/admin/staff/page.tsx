import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../db/pool";
import { validateSession } from "../../../lib/auth";
import { listStaff } from "../../../lib/staff";
import { StaffTable } from "../../../components/staff-table";

export default async function StaffPage() {
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");
  if (!session.user.is_staff) redirect("/login");

  const users = await listStaff(pool);
  const staffCount = users.filter((u) => u.is_staff).length;

  return (
    <>
      <header className="masthead">
        <div className="masthead-logo">Fleet<em>lens</em></div>
        <div className="masthead-meta">
          <span className="mono">ADMIN</span>
          <span className="dot">·</span>
          <span className="mono">STAFF</span>
        </div>
      </header>
      <div className="shell">
        <nav className="shell-nav">
          <div className="shell-nav-label">Admin</div>
          <a href="/admin/updates">Updates</a>
          <a href="/admin/staff" aria-current="true">Staff <span className="mono">{String(staffCount).padStart(2, "0")}</span></a>
          <div className="shell-nav-label">Account</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--mute)", padding: "4px 0 8px" }}>
            {session.user.email}
          </div>
          <a href="/logout">Sign out</a>
        </nav>
        <main className="shell-main">
          <div className="section-head">
            <div>
              <h1>Staff <em>Access</em></h1>
              <div className="kicker" style={{ marginTop: 8 }}>
                {staffCount} staff · {users.length} total user{users.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="kicker">Staff only</div>
          </div>

          {staffCount === 1 && (
            <section
              style={{
                marginBottom: 24,
                padding: "12px 16px",
                background: "var(--paper)",
                border: "1px solid var(--rule)",
                borderLeft: "3px solid var(--danger)",
              }}
            >
              <strong>Only one staff user.</strong>{" "}
              Consider promoting another user so you&rsquo;re not locked out if this account is lost.
            </section>
          )}

          <section>
            <StaffTable
              users={users.map((u) => ({
                id: u.id,
                email: u.email,
                display_name: u.display_name,
                is_staff: u.is_staff,
                created_at: u.created_at instanceof Date ? u.created_at.toISOString() : String(u.created_at),
              }))}
              currentUserId={session.user.id}
            />
          </section>

          <footer className="page-footer">
            <span>Fleetlens · Team Edition</span>
            <span>{new Date().toISOString()}</span>
          </footer>
        </main>
      </div>
    </>
  );
}
