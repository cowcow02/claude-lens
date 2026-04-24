import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { getReview, getStatus } from "../../../../lib/self-update/service";
import { UpdateReviewView } from "../../../../components/update-review-view";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const { version } = await params;
  if (!/^\d+\.\d+\.\d+$/.test(version)) notFound();

  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");
  if (!session.user.is_staff) redirect("/login");

  const [review, status] = await Promise.all([getReview(version), getStatus()]);

  return (
    <>
      <header className="masthead">
        <div className="masthead-logo">Fleet<em>lens</em></div>
        <div className="masthead-meta">
          <span className="mono">ADMIN</span>
          <span className="dot">·</span>
          <span className="mono">REVIEW UPDATE</span>
          <span className="dot">·</span>
          <span className="mono">v{version}</span>
        </div>
      </header>
      <div className="shell">
        <nav className="shell-nav">
          <div className="shell-nav-label">Admin</div>
          <a href="/admin/updates" aria-current="true">Updates <span className="mono">01</span></a>
          <div className="shell-nav-label">Account</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--mute)", padding: "4px 0 8px" }}>
            {session.user.email}
          </div>
          <a href="/logout">Sign out</a>
        </nav>
        <main className="shell-main">
          <div className="section-head">
            <div>
              <h1>Review <em>v{version}</em></h1>
              <div className="kicker" style={{ marginTop: 8 }}>
                Running v{status.currentVersion}
                {" · "}Target v{version}
              </div>
            </div>
            <div>
              <a href="/admin/updates" className="kicker">← Back</a>
            </div>
          </div>

          <UpdateReviewView
            version={version}
            changelog={review.changelog}
            migrations={review.migrations}
          />

          <footer className="page-footer">
            <span>Fleetlens · Team Edition</span>
            <span>{new Date().toISOString()}</span>
          </footer>
        </main>
      </div>
    </>
  );
}
