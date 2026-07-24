import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { config } from "dotenv";

config({
  path: resolve(process.cwd(), "apps/dashboard/.env.local"),
  quiet: true,
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  process.stderr.write(
    "TEST_DATABASE_URL is required for integration tests.\n",
  );
  process.exit(1);
}

const environment = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  TEST_DATABASE_URL: testDatabaseUrl,
};

function runNodeScript(script: string, arguments_: string[]) {
  const result = spawnSync(process.execPath, [script, ...arguments_], {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runNodeScript(
  resolve(
    process.cwd(),
    "packages/database/node_modules/prisma/build/index.js",
  ),
  [
    "migrate",
    "deploy",
    "--config",
    resolve(process.cwd(), "packages/database/prisma.config.ts"),
    "--schema",
    resolve(process.cwd(), "packages/database/prisma/schema.prisma"),
  ],
);

runNodeScript(resolve(process.cwd(), "node_modules/vitest/vitest.mjs"), [
  "run",
  "--config",
  resolve(process.cwd(), "vitest.integration.config.ts"),
]);
