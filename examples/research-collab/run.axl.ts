import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conductor } from "@swati/core";
import { StaticResolver, LocalFileStorage, LocalGate, MockLLM } from "@swati/core/adapters";
import { generateIdentity, pubkeyToHex } from "@swati/core";
import { WireChannel } from "@swati/transport-axl";
import score from "./score.choreo.js";

const KEY1 = "0x0";
const KEY2 = "0x0";
const KEY3 = "0x0";

const LOG_DIR = join(tmpdir(), "swati-research-collab-axl");
const storage = new LocalFileStorage(join(LOG_DIR, "storage"));
const gates = { local: new LocalGate({ timeoutMs: 30_000, retries: 1 }) };

const idResearcher = await generateIdentity("researcher");
const idCritic = await generateIdentity("critic");
const idExecutor = await generateIdentity("executor");

const resolver = new StaticResolver({
  researcher: { pubkey: pubkeyToHex(idResearcher.pubkey), transportId: KEY1 },
  critic: { pubkey: pubkeyToHex(idCritic.pubkey), transportId: KEY2 },
  executor: { pubkey: pubkeyToHex(idExecutor.pubkey), transportId: KEY3 },
});

const tResearcher = new WireChannel({
  endpoint: "http://localhost:9002",
  targetNodes: [KEY2, KEY3],
});
const tCritic = new WireChannel({ endpoint: "http://localhost:9012", targetNodes: [KEY1, KEY3] });
const tExecutor = new WireChannel({ endpoint: "http://localhost:9022", targetNodes: [KEY1, KEY2] });

console.log("--- research-collab AXL run ---\n");
console.log("Waiting for AXL mesh...");
await Promise.all([tResearcher.awaitReady(), tCritic.awaitReady(), tExecutor.awaitReady()]);
await Promise.all([tResearcher.awaitPeers(1), tCritic.awaitPeers(1), tExecutor.awaitPeers(1)]);
console.log("Mesh ready.\n");

const researcherCond = new Conductor({
  choreography: score,
  role: "researcher",
  identity: idResearcher,
  transport: tResearcher,
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
  transport: tCritic,
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
  transport: tExecutor,
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

const input = { topic: "neurogenesis", maxIterations: 3 };

const [researcherResult] = await Promise.all([
  researcherCond.run(input),
  criticCond.run(input),
  executorCond.run(input),
]).finally(() => Promise.all([tResearcher.close(), tCritic.close(), tExecutor.close()]));

if (researcherResult.ok) {
  const out = researcherResult.value as { result: string; iterations: number };
  console.log(`iterations : ${out.iterations}`);
  console.log(`result     : ${out.result}`);
  console.log("\nAXL: OK");
} else {
  console.error("FAILED:", researcherResult.error);
  process.exit(1);
}
