import type { FastifyInstance } from "fastify";

import type { PlatformApiConfig } from "./config.js";
import type { AppState } from "./types.js";

export type PlatformRuntime = {
  app: FastifyInstance;
  state: AppState;
  config: PlatformApiConfig;
  scanRisks: () => void;
  ready: Promise<void>;
  persistState: () => Promise<void>;
};
