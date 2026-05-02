import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conductor } from "@swati/core";
import {
  InMemoryTransport,
  StaticResolver,
  LocalFileStorage,
  LocalGate,
  MockLLM,
} from "@swati/core/adapters";
import { generateIdentity, pubkeyToHex } from "@swati/core";
import score from "./score.choreo.js";

const LOG_DIR = join(tmpdir(), "swati-research-collab");
const storage = new LocalFileStorage(join(LOG_DIR, "storage"));

const idResearcher = await generateIdentity("researcher");
const idCritic = await generateIdentity("critic");
const idExecutor = await generateIdentity("executor");

const resolver = new StaticResolver({
  researcher: { pubkey: pubkeyToHex(idResearcher.pubkey), transportId: "researcher" },
  critic: { pubkey: pubkeyToHex(idCritic.pubkey), transportId: "critic" },
  executor: { pubkey: pubkeyToHex(idExecutor.pubkey), transportId: "executor" },
});

const gates = { local: new LocalGate({ timeoutMs: 30_000, retries: 1 }) };

const researcherCond = new Conductor({
  choreography: score,
  role: "researcher",
  identity: idResearcher,
  transport: new InMemoryTransport("researcher"),
  resolver,
  storage,
  gateProviders: gates,
  logPath: join(LOG_DIR, "logs"),
  llm: new MockLLM({
    responses: [
      "Investigating neural plasticity mechanisms in adult hippocampal neurogenesis using CRISPR-based fate mapping.",
    ],
  }),
});

const criticCond = new Conductor({
  choreography: score,
  role: "critic",
  identity: idCritic,
  transport: new InMemoryTransport("critic"),
  resolver,
  storage,
  gateProviders: gates,
  logPath: join(LOG_DIR, "logs"),
  llm: new MockLLM({
    responses: [
      "APPROVE: The proposal is specific, uses established methodology, and has clear measurable outcomes.",

      "approve",
    ],
  }),
});

const executorCond = new Conductor({
  choreography: score,
  role: "executor",
  identity: idExecutor,
  transport: new InMemoryTransport("executor"),
  resolver,
  storage,
  gateProviders: gates,
  logPath: join(LOG_DIR, "logs"),
  llm: new MockLLM({
    responses: [
      "Executed: Set up CRISPR lentiviral vectors, injected into dentate gyrus, scheduled 4-week fate mapping window.",
    ],
  }),
});

console.log("--- research-collab vanilla run ---\n");

const input = { topic: "neurogenesis", maxIterations: 3 };

const [researcherResult] = await Promise.all([
  researcherCond.run(input),
  criticCond.run(input),
  executorCond.run(input),
]);

if (researcherResult.ok) {
  const out = researcherResult.value as { result: string; iterations: number };
  console.log(`iterations : ${out.iterations}`);
  console.log(`result     : ${out.result}`);
  console.log("\nVanilla core: OK");
} else {
  console.error("FAILED:", researcherResult.error);
  process.exit(1);
}

console.log("\n── LOG VERIFICATION ────────────────────────────────────────────────");
for (const [roleName, cond] of [
  ["researcher", researcherCond],
  ["critic", criticCond],
  ["executor", executorCond],
] as const) {
  const v = await cond.verifyLog();
  console.log(`  ${roleName}: ${v.ok ? "✔ chain intact" : "✖ " + v.error?.message}`);
}
