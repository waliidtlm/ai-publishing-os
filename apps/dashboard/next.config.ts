import { resolve } from "node:path";

import type { NextConfig } from "next";

const monorepoRoot = resolve(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  reactStrictMode: true,
  turbopack: {
    root: monorepoRoot,
  },
  transpilePackages: [
    "@ai-publishing-os/database",
    "@ai-publishing-os/schemas",
    "@ai-publishing-os/shared",
  ],
};

export default nextConfig;
