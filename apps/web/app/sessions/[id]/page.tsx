import { notFound } from "next/navigation";
import { getSession } from "@/lib/data";
import { SessionView } from "./session-view";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return notFound();

  // Strip the `raw` field from every event before serializing to the
  // client. The parser keeps `raw` around for the Debug tab, but it's a
  // full verbatim copy of the JSONL line — for an 8.7 MB session file
  // this roughly doubles the RSC payload sent over the wire. The Debug
  // tab can rebuild a useful view from the structured fields already on
  // the event (rawType, blocks, usage, model, requestId, etc.) without it.
  const stripped = {
    ...session,
    events: session.events.map((e) => ({ ...e, raw: undefined })),
  };

  return <SessionView session={stripped} />;
}
