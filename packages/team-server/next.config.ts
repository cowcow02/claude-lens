import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
  reactStrictMode: true,
  transpilePackages: ["@claude-lens/parser"],
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};
export default config;
