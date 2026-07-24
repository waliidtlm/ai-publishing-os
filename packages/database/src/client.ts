import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

const globalDatabase = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createDatabaseClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });

  return new PrismaClient({
    adapter,
  });
}

export function getDatabaseClient(
  databaseUrl = process.env.DATABASE_URL,
): PrismaClient {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create the database client.");
  }

  if (!globalDatabase.prisma) {
    globalDatabase.prisma = createDatabaseClient(databaseUrl);
  }

  return globalDatabase.prisma;
}
