/**
 * Server-only data access layer.
 *
 * Wraps @claude-lens/parser/fs with a per-request cache so that a
 * single RSC render doesn't re-scan ~/.claude/projects for every page
 * component that needs the session list.
 */

import "server-only";
import { cache } from "react";
import { listSessions as rawListSessions, getSession as rawGetSession } from "@claude-lens/parser/fs";

export const listSessions = cache(async () => {
  return rawListSessions({ limit: 1000 });
});

export const getSession = cache(async (id: string) => {
  return rawGetSession(id);
});
