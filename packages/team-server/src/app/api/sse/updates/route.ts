import { NextRequest } from "next/server";
import { addClient } from "../../../../lib/sse";
import { validateSession } from "../../../../lib/auth";
import { getPool } from "../../../../db/pool";

export async function GET(req: NextRequest) {
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) return new Response("Unauthorized", { status: 401 });

  const ctx = await validateSession(cookieToken, getPool());
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return new Response("team slug required", { status: 400 });

  const teamRes = await getPool().query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return new Response("Team not found", { status: 404 });
  const teamId = teamRes.rows[0].id;

  if (!ctx.memberships.some((m) => m.team_id === teamId)) {
    return new Response("Forbidden", { status: 403 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const remove = addClient(controller, teamId);
      const hb = setInterval(() => {
        try { controller.enqueue(new TextEncoder().encode(": heartbeat\n\n")); }
        catch { clearInterval(hb); remove(); }
      }, 15000);
      req.signal.addEventListener("abort", () => { clearInterval(hb); remove(); });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
