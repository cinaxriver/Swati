import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { SwatiConfig } from "@swati/core";

const CONFIG_DEFAULTS = [
  "swati.config.ts",
  "swati.config.js",
  "swati.config.vanilla.ts",
];

export async function loadConfig(configPath?: string): Promise<SwatiConfig> {
  const path = configPath ? resolve(configPath) : findDefaultConfig();

  if (!path || !existsSync(path)) {
    return makeVanillaConfig();
  }

  try {
    const url = pathToFileURL(path).href;
    const module = (await import(url)) as { default: SwatiConfig };
    return module.default;
  } catch (cause) {
    throw new Error(`Failed to load config from ${path}: ${String(cause)}`);
  }
}

function findDefaultConfig(): string | null {
  for (const name of CONFIG_DEFAULTS) {
    const p = resolve(name);
    if (existsSync(p)) return p;
  }
  return null;
}

async function makeVanillaConfig(): Promise<SwatiConfig> {
  const {
    InMemoryTransport,
    StaticResolver,
    LocalFileStorage,
    LocalGate,
    MockLLM,
  } = await import("@swati/core/adapters");
  const { defineConfig } = await import("@swati/core");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");

  return defineConfig({
    transport: new InMemoryTransport(),
    resolver: new StaticResolver({}),
    storage: new LocalFileStorage(
      join(process.env["SWATI_HOME"] ?? join(homedir(), ".swati"), "storage"),
    ),
    gates: { local: new LocalGate() },
    llm: new MockLLM(),
  });
}
