import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conductor } from "@swati/core";
import { InMemoryTransport, StaticResolver, LocalGate, MockLLM } from "@swati/core/adapters";
import { generateIdentity, pubkeyToHex } from "@swati/core";
import { BlobVault } from "@swati/storage-0g";
import score from "./score.choreo.js";

const PRIVATE_KEY =
  process.env["ZEROG_PRIVATE_KEY"] ??
  "PKX";

const storage = new BlobVault({ signingKey: PRIVATE_KEY });

console.log("--- research-collab 0G Storage run ---\n");
console.log("Checking 0G connectivity...");
const connectivity = await storage.checkConnectivity();
if (!connectivity.chainReachable || !connectivity.nodeReachable) {
  console.error("0G unreachable:", connectivity);
  process.exit(1);
}
console.log(`0G OK — wallet: ${connectivity.signerAddress}  block: ${connectivity.latestBlock}\n`);

InMemoryTransport.reset();
const LOG_DIR = join(tmpdir(), "swati-research-collab-0g");
const gates = { local: new LocalGate() };

const idResearcher = await generateIdentity("researcher");
const idCritic = await generateIdentity("critic");
const idExecutor = await generateIdentity("executor");

const resolver = new StaticResolver({
  researcher: { pubkey: pubkeyToHex(idResearcher.pubkey), transportId: "researcher" },
  critic: { pubkey: pubkeyToHex(idCritic.pubkey), transportId: "critic" },
  executor: { pubkey: pubkeyToHex(idExecutor.pubkey), transportId: "executor" },
});

const makeTransport = (id: string) => new InMemoryTransport(id);

const researcherCond = new Conductor({
  choreography: score,
  role: "researcher",
  identity: idResearcher,
  transport: makeTransport("researcher"),
  resolver,
  storage,
  gateProviders: gates,
  logPath: join(LOG_DIR, "logs"),
  llm: new MockLLM({
    responses: [
      "Investigating neural plasticity via CRISPR fate mapping in adult hippocampal neurogenesis.",
    ],
  }),
});

const criticCond = new Conductor({
  choreography: score,
  role: "critic",
  identity: idCritic,
  transport: makeTransport("critic"),
  resolver,
  storage,
  gateProviders: gates,
  logPath: join(LOG_DIR, "logs"),
  llm: new MockLLM({
    responses: [
      "APPROVE: specific methodology, measurable outcomes, feasible timeline.",
      "approve",
    ],
  }),
});

const executorCond = new Conductor({
  choreography: score,
  role: "executor",
  identity: idExecutor,
  transport: makeTransport("executor"),
  resolver,
  storage,
  gateProviders: gates,
  logPath: join(LOG_DIR, "logs"),
  llm: new MockLLM({
    responses: [
      "Executed: CRISPR vectors prepared, injected into dentate gyrus, 4-week window scheduled.",
    ],
  }),
});

const input = { topic: "hippocampal neurogenesis", maxIterations: 1 };

console.log("Running choreography (logs will upload to 0G at completion)...");
const [result] = await Promise.all([
  researcherCond.run(input),
  criticCond.run(input),
  executorCond.run(input),
]);

if (result.ok) {
  const out = result.value as { result: string; iterations: number };
  console.log(`\niterations : ${out.iterations}`);
  console.log(`result     : ${out.result}`);
  console.log("\n0G Storage: OK (log snapshots uploaded)");
} else {
  console.error("FAILED:", result.error);
  process.exit(1);
}
