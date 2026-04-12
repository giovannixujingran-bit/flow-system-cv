import { migrate } from "drizzle-orm/node-postgres/migrator";

import { closeDbClient, getDbClient } from "./client.js";
import { migrationsFolder } from "./constants.js";

async function main(): Promise<void> {
  const db = getDbClient();
  await migrate(db, {
    migrationsFolder,
  });
  console.log(`Applied PostgreSQL migrations from ${migrationsFolder}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbClient();
  });
