/**
 * Server-side filesystem scanner for Claude Code JSONL transcripts.
 *
 * Lives in its own subpath (`@claude-sessions/parser/fs`) so pure browser
 * consumers can use the rest of the package without importing node:fs.
 *
 * ----------------------------------------------------------------------
 *  Caching
 * ----------------------------------------------------------------------
 * A module-scoped in-memory cache makes repeated scans near-instant. Any
 * file whose `mtimeMs` and `sizeBytes` match a previously-parsed entry
 * short-circuits the read+parse path entirely. First scan is unavoidable
 * (one-time cost); subsequent scans only touch files that actually changed
 * on disk.
 *
 * The cache lives in module scope, which means it's shared across ALL
 * Next.js RSC requests in the same process, including page navigation
 * and both the Sidebar (layout.tsx) and page-level data fetches. It's
 * cleared only when the process restarts.
 *
 * Inspired by ccboard's mtime-based cache (reported 89x speedup) — see
 * https://github.com/FlorianBruniaux/ccboard.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTranscript } from "./parser.js";
import type { SessionDetail, SessionMeta } from "./types.js";

export const DEFAULT_ROOT = path.join(os.homedir(), ".claude", "projects");

/** Claude Code encodes cwd as `-Users-me-Repo-foo`. Decode → `/Users/me/Repo/foo`. */
export function decodeProjectName(dir: string): string {
  if (!dir.startsWith("-")) return dir;
  return "/" + dir.slice(1).replace(/-/g, "/");
}

/** Parse a JSONL file into one raw object per line, skipping malformed lines. */
export async function readJsonlFile(filePath: string): Promise<unknown[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines rather than failing the whole session.
    }
  }
  return out;
}

export type FileRef = {
  projectDir: string;
  fileName: string;
  fullPath: string;
  mtimeMs: number;
  sizeBytes: number;
};

/* ================================================================= */
/*  Module-scoped caches                                             */
/* ================================================================= */

type MetaCacheEntry = { meta: SessionMeta; mtimeMs: number; sizeBytes: number };
type DetailCacheEntry = { detail: SessionDetail; mtimeMs: number; sizeBytes: number };

/** Per-file meta cache. Key = fullPath. Invalidates on mtime OR size change. */
const metaCache = new Map<string, MetaCacheEntry>();

/** Per-file detail cache. Key = fullPath. Same invalidation rule. */
const detailCache = new Map<string, DetailCacheEntry>();

/** Short-lived file-list cache so multiple calls within the same request
 *  don't re-stat the directory. TTL is 1 second by default — enough to
 *  cover an entire RSC render pass without caching stale data for long. */
let fileListCache: { files: FileRef[]; capturedAtMs: number; root: string } | null = null;
const FILE_LIST_TTL_MS = 1_000;

export type CacheStats = {
  metaEntries: number;
  detailEntries: number;
};

/** Expose cache stats — useful for debug endpoints or logging. */
export function cacheStats(): CacheStats {
  return { metaEntries: metaCache.size, detailEntries: detailCache.size };
}

/** Drop all caches. Tests use this; hooks on file watch could too. */
export function clearCaches(): void {
  metaCache.clear();
  detailCache.clear();
  fileListCache = null;
}

/* ================================================================= */
/*  File walking                                                     */
/* ================================================================= */

/**
 * Walk `~/.claude/projects/<encoded-cwd>/*.jsonl`, returning one ref per file
 * with mtime + size stats. Uses fs.readdir + withFileTypes for project-dir
 * detection (one syscall instead of N stats), and parallelizes the inner
 * file-stat calls per project.
 */
export async function walkJsonlFiles(root: string = DEFAULT_ROOT): Promise<FileRef[]> {
  // Short-TTL cache so a single RSC render doesn't re-walk for every
  // data-loader call (layout + page + nested components all calling
  // listSessions / getSession / listProjects).
  if (
    fileListCache &&
    fileListCache.root === root &&
    Date.now() - fileListCache.capturedAtMs < FILE_LIST_TTL_MS
  ) {
    return fileListCache.files;
  }

  let topEntries: import("node:fs").Dirent[] = [];
  try {
    topEntries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const projectDirs = topEntries.filter((e) => e.isDirectory()).map((e) => e.name);

  // Walk all project directories in parallel. Inside each, stat all .jsonl
  // files in parallel too. On my machine with 44 projects / 658 files this
  // drops from ~600ms (sequential) to ~80ms.
  const perProject = await Promise.all(
    projectDirs.map(async (projectDir): Promise<FileRef[]> => {
      const projectPath = path.join(root, projectDir);
      let files: string[];
      try {
        files = await fs.readdir(projectPath);
      } catch {
        return [];
      }
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      const refs = await Promise.all(
        jsonlFiles.map(async (f): Promise<FileRef | null> => {
          const fullPath = path.join(projectPath, f);
          try {
            const stat = await fs.stat(fullPath);
            return {
              projectDir,
              fileName: f,
              fullPath,
              mtimeMs: stat.mtimeMs,
              sizeBytes: stat.size,
            };
          } catch {
            return null;
          }
        }),
      );
      return refs.filter((r): r is FileRef => r !== null);
    }),
  );

  const all = perProject.flat();
  fileListCache = { files: all, capturedAtMs: Date.now(), root };
  return all;
}

export function sessionIdFromFileName(fileName: string): string {
  return fileName.replace(/\.jsonl$/i, "");
}

/* ================================================================= */
/*  Meta / detail loaders with caching                               */
/* ================================================================= */

/** Load (or reuse) the SessionMeta for a single file ref. */
async function getCachedMeta(f: FileRef): Promise<SessionMeta | null> {
  const cached = metaCache.get(f.fullPath);
  if (cached && cached.mtimeMs === f.mtimeMs && cached.sizeBytes === f.sizeBytes) {
    return cached.meta;
  }
  try {
    const rawLines = await readJsonlFile(f.fullPath);
    const { meta } = parseTranscript(rawLines);
    const full: SessionMeta = {
      ...meta,
      id: sessionIdFromFileName(f.fileName),
      filePath: f.fullPath,
      projectDir: f.projectDir,
      projectName: decodeProjectName(f.projectDir),
    };
    metaCache.set(f.fullPath, { meta: full, mtimeMs: f.mtimeMs, sizeBytes: f.sizeBytes });
    return full;
  } catch {
    return null;
  }
}

/** Load (or reuse) the full SessionDetail for a single file ref. */
async function getCachedDetail(f: FileRef): Promise<SessionDetail | null> {
  const cached = detailCache.get(f.fullPath);
  if (cached && cached.mtimeMs === f.mtimeMs && cached.sizeBytes === f.sizeBytes) {
    return cached.detail;
  }
  try {
    const rawLines = await readJsonlFile(f.fullPath);
    const { meta, events } = parseTranscript(rawLines);
    const detail: SessionDetail = {
      ...meta,
      id: sessionIdFromFileName(f.fileName),
      filePath: f.fullPath,
      projectDir: f.projectDir,
      projectName: decodeProjectName(f.projectDir),
      events,
    };
    detailCache.set(f.fullPath, { detail, mtimeMs: f.mtimeMs, sizeBytes: f.sizeBytes });
    // Populate the meta cache from the detail so a later listSessions
    // doesn't have to re-parse the file too.
    const metaOnly: SessionMeta = { ...detail };
    delete (metaOnly as SessionMeta & { events?: unknown }).events;
    metaCache.set(f.fullPath, { meta: metaOnly, mtimeMs: f.mtimeMs, sizeBytes: f.sizeBytes });
    return detail;
  } catch {
    return null;
  }
}

export type ListOptions = {
  /** Override the ~/.claude/projects root */
  root?: string;
  /** Max number of sessions to return. Sorted newest-first by mtime. */
  limit?: number;
  /** Only include sessions with this projectDir prefix (filters by cwd) */
  projectDir?: string;
};

/**
 * List parsed session metadata, sorted newest-first by file mtime.
 *
 * Uses the module-scoped cache, so after the first call only files whose
 * mtime/size changed are re-parsed.
 */
export async function listSessions(opts: ListOptions = {}): Promise<SessionMeta[]> {
  const { root = DEFAULT_ROOT, limit = 500, projectDir } = opts;
  let files = await walkJsonlFiles(root);
  if (projectDir) files = files.filter((f) => f.projectDir === projectDir);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sliced = files.slice(0, limit);

  // Parallelize — at first load this is CPU-bound (JSON.parse), but it
  // still overlaps the fs.readFile calls nicely.
  const metas = await Promise.all(sliced.map((f) => getCachedMeta(f)));
  return metas.filter((m): m is SessionMeta => m !== null);
}

/** Load a single session by id. Returns null if not found. */
export async function getSession(
  id: string,
  opts: { root?: string } = {},
): Promise<SessionDetail | null> {
  const { root = DEFAULT_ROOT } = opts;
  const files = await walkJsonlFiles(root);
  const hit = files.find((f) => sessionIdFromFileName(f.fileName) === id);
  if (!hit) return null;
  return getCachedDetail(hit);
}

/* ================================================================= */
/*  Lightweight projects list for the sidebar                        */
/* ================================================================= */

export type ProjectRefLite = {
  projectDir: string;
  projectName: string;
  sessionCount: number;
  /** ms timestamp of the most recently-modified JSONL in this project */
  lastActiveMs: number;
};

/**
 * Return one entry per project directory with a session count and a
 * "last active" mtime. Uses only fs.stat — no JSONL parsing at all, so it
 * runs in <100ms even on a cold cache with hundreds of sessions. Use this
 * for the sidebar / navigation; use `listSessions` when you actually need
 * session content (tokens, previews, etc.).
 */
export async function listProjects(root: string = DEFAULT_ROOT): Promise<ProjectRefLite[]> {
  const files = await walkJsonlFiles(root);
  const byProject = new Map<string, { count: number; lastActiveMs: number }>();
  for (const f of files) {
    const cur = byProject.get(f.projectDir) ?? { count: 0, lastActiveMs: 0 };
    cur.count++;
    if (f.mtimeMs > cur.lastActiveMs) cur.lastActiveMs = f.mtimeMs;
    byProject.set(f.projectDir, cur);
  }
  return Array.from(byProject.entries())
    .map(([projectDir, { count, lastActiveMs }]) => ({
      projectDir,
      projectName: decodeProjectName(projectDir),
      sessionCount: count,
      lastActiveMs,
    }))
    .sort((a, b) => b.lastActiveMs - a.lastActiveMs);
}
