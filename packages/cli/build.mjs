import { build, context } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["fsevents"],
  define: { CLI_VERSION: JSON.stringify(pkg.version) },
};

const entries = [
  {
    ...shared,
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    ...shared,
    entryPoints: ["src/daemon-worker.ts"],
    outfile: "dist/daemon-worker.js",
  },
];

if (process.argv.includes("--watch")) {
  const contexts = await Promise.all(entries.map((opts) => context(opts)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("Watching for changes...");
} else {
  await Promise.all(entries.map((opts) => build(opts)));
}
