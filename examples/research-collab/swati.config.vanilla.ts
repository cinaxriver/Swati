import {
  defineConfig,
  InMemoryTransport,
  StaticResolver,
  LocalFileStorage,
  LocalGate,
  MockLLM,
} from "@swati/core";
import { join } from "node:path";
import { homedir } from "node:os";

export default defineConfig({
  transport: new InMemoryTransport(),

  resolver: new StaticResolver({
    researcher: "researcher",
    critic: "critic",
    executor: "executor",
  }),

  storage: new LocalFileStorage(
    join(process.env["SWATI_HOME"] ?? join(homedir(), ".swati"), "storage"),
  ),

  gates: {
    local: new LocalGate({ timeoutMs: 30_000, retries: 1 }),
  },

  llm: new MockLLM({
    responses: [
      "Investigating neural plasticity mechanisms in adult hippocampal neurogenesis using CRISPR-based fate mapping.",

      "APPROVE: The proposal is specific, uses established methodology, and has clear measurable outcomes.",

      "Executed: Set up CRISPR lentiviral vectors, injected into dentate gyrus, scheduled 4-week fate mapping window.",
    ],
  }),
});
