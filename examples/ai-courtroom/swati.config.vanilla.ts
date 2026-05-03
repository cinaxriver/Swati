import { defineConfig } from "@swati/core/config";
import {
  InMemoryTransport,
  StaticResolver,
  LocalFileStorage,
  LocalGate,
  MockLLM,
} from "@swati/core/adapters";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  transport: new InMemoryTransport(),

  resolver: new StaticResolver(join(__dir, "identities.json")),

  storage: new LocalFileStorage(
    join(process.env["SWATI_HOME"] ?? join(homedir(), ".swati"), "storage"),
  ),

  gates: { local: new LocalGate({ timeoutMs: 30_000, retries: 1 }) },

  llm: new MockLLM({
    responses: [
      "The flash loan maneuver was a deliberate exploit targeting PoolX's oracle.",
      "The arbitrage strategy was permissionless and legally permitted by the protocol.",
      "not-guilty",
    ],
  }),
});
