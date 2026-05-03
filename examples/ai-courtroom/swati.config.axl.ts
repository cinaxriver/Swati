import { defineConfig } from "@swati/core/config";
import { StaticResolver, LocalFileStorage, LocalGate } from "@swati/core/adapters";
import { WireChannel } from "@swati/transport-axl";
import { AnthropicLLM } from "@swati/llm-anthropic";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

import { readFileSync } from "node:fs";

const idsPath = join(__dir, "identities.axl.json");
const ids = JSON.parse(readFileSync(idsPath, "utf-8"));
const targetNodes = Object.values(ids)
  .map((i: any) => i.transportId)
  .filter((id) => id && id.length > 32);

export default defineConfig({
  transport: new WireChannel({ targetNodes }),

  resolver: new StaticResolver(join(__dir, "identities.axl.json")),

  storage: new LocalFileStorage(
    join(process.env["SWATI_HOME"] ?? join(homedir(), ".swati"), "storage"),
  ),

  gates: { local: new LocalGate({ timeoutMs: 30_000, retries: 1 }) },

  llm: new AnthropicLLM(),
});
