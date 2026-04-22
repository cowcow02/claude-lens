import { statSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parseTranscript } from "@claude-lens/parser";
import type { SessionDetail } from "@claude-lens/parser";
import { buildEntries } from "@claude-lens/entries";
import { writeEntry } from "@claude-lens/entries/fs";
import { readSettings, runEnrichmentQueue } from "@claude-lens/entries/node";
import {
  readState, updateCheckpoint, markSweepStart, markSweepEnd, isSweepStale,
} from "./state.js";
import { listAllSessionJsonls } from "./scan.js";

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.error(`[perception] ${msg}`);
}

/**
 * Decode a URL-encoded Claude Code project directory name into a human-readable path.
 * Claude Code encodes cwd by replacing "/" with "-"; the leading "-" represents the
 * leading "/". Example: `-Users-alice-Repo-foo` → `/Users/alice/Repo/foo`.
 */
function decodeProjectDirName(projectDir: string): string {
  if (projectDir.startsWith("-")) {
    return "/" + projectDir.slice(1).replace(/-/g, "/");
  }
  return projectDir.replace(/-/g, "/");
}

export type SweepResult = {
  sessionsProcessed: number;
  entriesWritten: number;
  errors: number;
};

export type SweepOptions = {
  /** Override ~/.claude/projects for testing. */
  projectsRoot?: string;
};

export async function runPerceptionSweep(opts: SweepOptions = {}): Promise<SweepResult> {
  const state = readState();
  if (state.sweep_in_progress && !isSweepStale()) {
    return { sessionsProcessed: 0, entriesWritten: 0, errors: 0 };
  }
  markSweepStart();

  let sessions = 0;
  let entries = 0;
  let errors = 0;

  try {
    const files = await listAllSessionJsonls(opts.projectsRoot);
    for (const f of files) {
      try {
        const stat = statSync(f);
        const prev = state.file_checkpoints[f];
        if (prev && prev.byte_offset >= stat.size) continue;

        const raw = readFileSync(f, "utf8");
        const rawLines: unknown[] = raw
          .split("\n")
          .filter(Boolean)
          .map(l => {
            try { return JSON.parse(l); } catch { return null; }
          })
          .filter((x): x is object => x !== null);

        if (rawLines.length === 0) continue;

        const { meta, events } = parseTranscript(rawLines);
        const fileName = basename(f);
        const projectDir = basename(dirname(f));
        const sessionId = fileName.replace(/\.jsonl$/, "");

        const sd: SessionDetail = {
          ...meta,
          id: sessionId,
          filePath: f,
          projectDir,
          projectName: meta.cwd ?? decodeProjectDirName(projectDir),
          events,
        };

        const built = buildEntries(sd);
        for (const e of built) {
          // Stamp real byte_offset so enrichment readers have accurate provenance
          e.source_checkpoint.byte_offset = stat.size;
          writeEntry(e);
          entries++;
        }
        updateCheckpoint(f, {
          byte_offset: stat.size,
          last_event_ts: built.at(-1)?.end_iso ?? null,
          affects_days: built.map(e => e.local_day),
        });
        sessions++;
      } catch (err) {
        errors++;
        log(`skipped ${f}: ${(err as Error).message}`);
      }
    }
    // Phase 1b enrichment — guarded by settings. Failure here is logged
    // but not fatal to the deterministic sweep result.
    try {
      const settings = readSettings();
      const r = await runEnrichmentQueue(settings.ai_features);
      if ("skipped" in r && typeof r.skipped === "string") {
        log(`enrichment: skipped (${r.skipped})`);
      } else if ("enriched" in r) {
        log(`enrichment: enriched=${r.enriched} errors=${r.errors} skipped=${r.skipped}`);
      }
    } catch (err) {
      log(`enrichment failed: ${(err as Error).message}`);
    }
  } finally {
    markSweepEnd();
  }

  return { sessionsProcessed: sessions, entriesWritten: entries, errors };
}
