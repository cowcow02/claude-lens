import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;
const COST = 16384;
const BLOCK = 8;
const PARALLEL = 1;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, KEY_LEN, { N: COST, r: BLOCK, p: PARALLEL });
  return `scrypt$${COST}$${BLOCK}$${PARALLEL}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  const actual = scryptSync(plain.normalize("NFKC"), salt, expected.length, { N, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
