import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const configuredDistDir = process.env.FLOW_NEXT_DIST_DIR?.trim();
const systemWatchIgnoreGlobs = [
  "**/$RECYCLE.BIN/**",
  "**/System Volume Information/**",
];

function mergeWatchIgnores(
  ignored: string | RegExp | string[] | undefined,
): string | RegExp | string[] {
  if (Array.isArray(ignored)) {
    return [...ignored, ...systemWatchIgnoreGlobs];
  }

  if (typeof ignored === "string") {
    return [ignored, ...systemWatchIgnoreGlobs];
  }

  if (ignored instanceof RegExp) {
    return new RegExp(`${ignored.source}|(?:[/\\\\](?:\\$RECYCLE\\.BIN|System Volume Information)(?:[/\\\\]|$))`);
  }

  return systemWatchIgnoreGlobs;
}

const nextConfig: NextConfig = {
  typedRoutes: false,
  distDir: configuredDistDir && configuredDistDir.length > 0 ? configuredDistDir : ".next",
  experimental: {
    devtoolSegmentExplorer: false,
  },
  webpack(config, { dev }) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@flow-system/local-openclaw-contracts": path.resolve(appRoot, "../../packages/local-openclaw-contracts/dist/index.js"),
      "@flow-system/local-overlay-contracts": path.resolve(appRoot, "../../packages/local-overlay-contracts/dist/index.js"),
    };

    if (dev) {
      const currentIgnored = config.watchOptions?.ignored as string | RegExp | string[] | undefined;
      config.watchOptions = {
        ...(config.watchOptions ?? {}),
        ignored: mergeWatchIgnores(currentIgnored),
      };
    }

    return config;
  },
};

export default nextConfig;
