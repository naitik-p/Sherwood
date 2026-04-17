import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

function candidateEnvPaths(importMetaUrl) {
  const startDir = dirname(fileURLToPath(importMetaUrl));
  const seen = new Set();
  const paths = [];

  let currentDir = startDir;
  while (!seen.has(currentDir)) {
    seen.add(currentDir);
    paths.push(resolve(currentDir, ".env"));
    const parentDir = resolve(currentDir, "..");
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return paths;
}

export function loadWorkspaceEnv(importMetaUrl) {
  loadDotenv();

  if (process.env.DATABASE_URL) {
    return;
  }

  for (const envPath of candidateEnvPaths(importMetaUrl)) {
    if (!existsSync(envPath)) {
      continue;
    }

    loadDotenv({ path: envPath });
    if (process.env.DATABASE_URL) {
      return;
    }
  }
}
