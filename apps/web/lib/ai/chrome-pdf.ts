/**
 * Thin wrapper around system Chrome/Chromium headless for PDF rendering.
 *
 * We detect the browser binary at known paths (macOS / Linux / Windows);
 * override via CHROME_BIN env var. No node dependency on Puppeteer —
 * Fleetlens is a local-only tool so we assume the user has a browser
 * installed anyway.
 */
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES: string[] = [
  process.env.CHROME_BIN ?? "",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

let cached: string | null | undefined;

export function findChrome(): string | null {
  if (cached !== undefined) return cached;
  for (const p of CANDIDATES) {
    if (existsSync(p)) { cached = p; return p; }
  }
  cached = null;
  return null;
}

export async function renderPdf(url: string, outName: string): Promise<Buffer> {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error("Chrome/Chromium binary not found. Install Chrome or set CHROME_BIN.");
  }
  const safeName = outName.replace(/[^a-z0-9-]/gi, "_");
  const outPath = join(tmpdir(), `fleetlens-${safeName}-${Date.now()}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-pdf-header-footer",
      "--virtual-time-budget=5000",
      `--print-to-pdf=${outPath}`,
      url,
    ], { stdio: "ignore" });
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`chrome exited ${code}`)));
    proc.on("error", reject);
  });
  const bytes = await readFile(outPath);
  void unlink(outPath).catch(() => {});
  return bytes;
}
