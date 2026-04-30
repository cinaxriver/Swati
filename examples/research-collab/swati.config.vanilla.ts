import { defineConfig, InMemoryTransport, StaticResolver, LocalFileStorage, LocalGate, MockLLM } from "@swati/core";
import { join } from "node:path";
import { homedir } from "node:os";

export default defineConfig({
  transport: new InMemoryTransport(),

  resolver: new StaticResolver({
    // in vanilla mode all roles resolve to the same in-process transport ID.
    // StaticResolver accepts a name → transportId map.
    researcher: "researcher",
    critic: "critic",
    executor: "executor",
  }),

  storage: new LocalFileStorage(
    join(process.env["SWATI_HOME"] ?? join(homedir(), ".swati"), "storage")
  ),

  gates: {
    local: new LocalGate({ timeoutMs: 30_000, retries: 1 }),
  },

  llm: new MockLLM({
    responses: [
      // researcher initial proposal
      "Investigating neural plasticity mechanisms in adult hippocampal neurogenesis using CRISPR-based fate mapping.",
      // critic review (approve path)
      "APPROVE: The proposal is specific, uses established methodology, and has clear measurable outcomes.",
      // executor result
      "Executed: Set up CRISPR lentiviral vectors, injected into dentate gyrus, scheduled 4-week fate mapping window.",
    ],
  }),
});
