import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getPool } from "../db/pool";
import { validateSession } from "../lib/auth";
import { instanceState } from "../lib/server-config";

export default async function RootPage() {
  const state = await instanceState();

  if (!state.hasAnyUser) redirect("/signup");

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  if (token) {
    const ctx = await validateSession(token, getPool());
    if (ctx && ctx.memberships.length > 0) {
      const slugRes = await getPool().query(
        "SELECT slug FROM teams WHERE id = $1",
        [ctx.memberships[0].team_id],
      );
      if (slugRes.rowCount) redirect(`/team/${slugRes.rows[0].slug}`);
    }
  }

  redirect("/login");
}
