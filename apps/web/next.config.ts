import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // We read files under ~/.claude/projects at runtime; no special config needed.
  transpilePackages: ["@claude-lens/parser"],
};

export default nextConfig;
