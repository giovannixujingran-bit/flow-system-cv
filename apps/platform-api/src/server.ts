import { createPlatformApiRuntime } from "./app.js";
import { closeDbClient } from "./db/client.js";

async function main(): Promise<void> {
  const runtime = createPlatformApiRuntime();
  await runtime.ready;
  const bootstrapToken = [...runtime.state.bootstrapTokens.values()][0]?.tokenPlaintext;

  if (bootstrapToken) {
    console.log(`Flow System bootstrap token: ${bootstrapToken}`);
  }

  const interval = setInterval(() => {
    runtime.scanRisks();
  }, runtime.config.riskScanSeconds * 1000);
  interval.unref();

  await runtime.app.listen({
    host: runtime.config.host,
    port: runtime.config.port,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await closeDbClient();
});
