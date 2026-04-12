import { readLocalAgentConfig } from "./config.js";
import { AgentDatabase } from "./db.js";
import { createLocalAgentApp } from "./http-server.js";
import { AgentLogger } from "./logger.js";
import { LocalAgentRuntime } from "./agent.js";

async function main(): Promise<void> {
  const config = readLocalAgentConfig();
  const logger = new AgentLogger(config.logFilePath);
  const db = new AgentDatabase(config);
  const runtime = new LocalAgentRuntime(config, db, logger);
  await runtime.start();

  const app = createLocalAgentApp(runtime, config);
  await app.listen({
    host: config.uiHost,
    port: config.uiPort,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
