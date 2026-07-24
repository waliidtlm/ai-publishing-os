import { resolve } from "node:path";

import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({
  path: resolve(process.cwd(), "apps/dashboard/.env.local"),
  quiet: true,
});

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    sequence: {
      concurrent: false,
    },
  },
});
