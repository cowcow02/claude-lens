/** CLI arg helpers shared across commands. */

/** Parse YYYYMMDD or YYYY-MM-DD; null on anything else. */
export function parseDateArg(raw: string | undefined): Date | null {
  if (!raw) return null;
  const compact = raw.replace(/-/g, "");
  if (!/^\d{8}$/.test(compact)) return null;
  const d = new Date(`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Value following a --flag in `args`, or undefined. */
export function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}
