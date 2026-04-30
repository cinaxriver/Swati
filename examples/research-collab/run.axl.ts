
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conductor } from "@swati/core";
import { StaticResolver, LocalFileStorage, LocalGate, MockLLM } from "@swati/core/adapters";
import { generateIdentity, pubkeyToHex } from "@swati/core";
import { AxlTransport } from "@swati/transport-axl";
import score from "./score.choreo.js";

const KEY1 = "1d072bf105a10a44a3ceb17775ec81afdeeab59c31b08fd1d5067434d3c66328"; // node1 → researcher
const KEY2 = "f2c073c462eeb0f2362124b822ee559e8a5616ef21baeb1542a4afb10f08c6ed"; // node2 → critic
const KEY3 = "c3362a308abcb7a4f9765a7799f63768b568cb9b97639272f882b4fc73d3daa6"; // node3 → executor

const LOG_DIR = join(tmpdir(), "swati-research-collab-axl");
const storage = new LocalFileStorage(join(LOG_DIR, "storage"));
const gates   = { local: new LocalGate({ timeoutMs: 30_000, retries: 1 }) };

const idResearcher = await generateIdentity("researcher");
const idCritic     = await generateIdentity("critic");
const idExecutor   = await generateIdentity("executor");

const resolver = new StaticResolver({
  researcher: { pubkey: pubkeyToHex(idResearcher.pubkey), transportId: KEY1 },
  critic:     { pubkey: pubkeyToHex(idCritic.pubkey),     transportId: KEY2 },
  executor:   { pubkey: pubkeyToHex(idExecutor.pubkey),   transportId: KEY3 },
});

const tResearcher = new AxlTransport({ endpoint: "http://localhost:9002", knownPeers: [KEY2, KEY3] });
const tCritic     = new AxlTransport({ endpoint: "http://localhost:9012", knownPeers: [KEY1, KEY3] });
const tExecutor   = new AxlTransport({ endpoint: "http://localhost:9022", knownPeers: [KEY1, KEY2] });

console.log("--- research-collab AXL run ---\n");
console.log("Waiting for AXL mesh...");
await Promise.all([tResearcher.waitForReady(), tCritic.waitForReady(), tExecutor.waitForReady()]);
await Promise.all([tResearcher.waitForPeers(1), tCritic.waitForPeers(1), tExecutor.waitForPeers(1)]);
console.log("Mesh ready.\n");

const researcherCond = new Conductor({
  choreography: score, role: "researcher", identity: idResearcher,
  transport: tResearcher, resolver, storage, gateProviders: gates,
  logPath: join(LOG_DIR, "logs"),
  llm: new MockLLM({ responses: [
    "Investigating neural plasticity mechanisms in adult hippocampal neurogenesis using CRISPR-based fate mapping.",
  ]}),
});

const criticCond = new Conductor({
  choreography: score, role: "critic", identity: idCritic,
  transport: tCritic, resolver, storage, gateProviders: gates,
  logPath: join(LOG_DIR, "logs"),
  llm: new MockLLM({ responses: [
    "APPROVE: The proposal is specific, uses established methodology, and has clear measurable outcomes.",
    "approve",
  ]}),
});

const executorCond = new Conductor({
  choreography: score, role: "executor", identity: idExecutor,
  transport: tExecutor, resolver, storage, gateProviders: gates,
  logPath: join(LOG_DIR, "logs"),
  llm: new MockLLM({ responses: [
    "Executed: Set up CRISPR lentiviral vectors, injected into dentate gyrus, scheduled 4-week fate mapping window.",
  ]}),
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
