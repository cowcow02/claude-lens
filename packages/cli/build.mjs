import { build, context } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const opts = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  external: ["fsevents"],
  banner: { js: "#!/usr/bin/env node" },
  define: { CLI_VERSION: JSON.stringify(pkg.version) },
};

if (process.argv.includes("--watch")) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await build(opts);
}
