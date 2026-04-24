import { cookies } from "next/headers";
import { getPool } from "../db/pool";
import { validateSession } from "../lib/auth";
import { getStatus } from "../lib/self-update/service";

// Server component. Renders nothing unless the current session is staff AND
// an update is available. Appears globally above every page via the root layout.
export async function UpdateBanner() {
  try {
    const pool = getPool();
    const cookieStore = await cookies();
    const token = cookieStore.get("fleetlens_session")?.value;
    if (!token) return null;
    const session = await validateSession(token, pool);
    if (!session?.user.is_staff) return null;
    const status = await getStatus();
    if (!status.updateAvailable || !status.latestVersion) return null;
    return (
      <div
        style={{
          background: "var(--ink)",
          color: "var(--paper)",
          padding: "8px 40px",
          fontFamily: "\"JetBrains Mono\", monospace",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          borderBottom: "1px solid var(--ink)",
        }}
      >
        <span>
          Team-server v{status.latestVersion} is available (running v{status.currentVersion})
        </span>
        <a
          href={`/admin/updates/${status.latestVersion}`}
          style={{ color: "var(--paper)", textDecoration: "underline" }}
        >
          Review update →
        </a>
      </div>
    );
  } catch {
    // Banner must never break the page. If the DB or session lookup errors,
    // silently render nothing; the /admin/updates page is still reachable.
    return null;
  }
}
