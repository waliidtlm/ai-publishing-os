import { getDatabaseClient } from "./client";

export async function checkDatabaseConnection(
  databaseUrl?: string,
): Promise<void> {
  const database = getDatabaseClient(databaseUrl);
  await database.$queryRaw`SELECT 1`;
}
