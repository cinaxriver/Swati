import { join } from "node:path";
import { tmpdir } from "node:os";
import { Conductor } from "@swati/core";
import { StaticResolver, LocalFileStorage, LocalGate, MockLLM } from "@swati/core/adapters";
import { generateIdentity, pubkeyToHex } from "@swati/core";
import { WireChannel } from "@swati/transport-axl";
import score from "./ai-courtroom.choreo.js";

const AXL_JUDGE = "http://localhost:9002";
const AXL_PROSECUTOR = "http://localhost:9012";
const AXL_DEFENDER = "http://localhost:9022";

const KEY_JUDGE = "0";
const KEY_PROSECUTOR = "0";
const KEY_DEFENDER = "0";

const idJudge = await generateIdentity("judge");
const idProsecutor = await generateIdentity("prosecutor");
const idDefender = await generateIdentity("defender");

const resolver = new StaticResolver({
  judge: { pubkey: pubkeyToHex(idJudge.pubkey), transportId: KEY_JUDGE },
  prosecutor: { pubkey: pubkeyToHex(idProsecutor.pubkey), transportId: KEY_PROSECUTOR },
  defender: { pubkey: pubkeyToHex(idDefender.pubkey), transportId: KEY_DEFENDER },
});

const storage = new LocalFileStorage(join(tmpdir(), "swati-ai-courtroom-axl", "storage"));
const gates = { local: new LocalGate({ timeoutMs: 30_000, retries: 1 }) };
const logPath = join(tmpdir(), "swati-ai-courtroom-axl", "logs");

const prosecutorLLM = new MockLLM({
  responses: [
    "FlashBot-9000 executed a deliberate sandwich attack, exploiting PoolX's stale " +
      "Chainlink feed to front-run $2.3M from liquidity providers who had no recourse.",
    "[placeholder]",
  ],
});
const defenderLLM = new MockLLM({
  responses: [
    "[placeholder]",
    "The oracle delay was an undocumented design flaw the protocol team later patched; " +
      "arbitraging publicly available price gaps is foundational to DeFi, not a crime.",
  ],
});
const judgeLLM = new MockLLM({
  responses: ["[placeholder]", "[placeholder]", "not-guilty"],
});

const prosecutorTransport = new WireChannel({
  endpoint: AXL_PROSECUTOR,
  targetNodes: [KEY_JUDGE, KEY_DEFENDER],
});
const defenderTransport = new WireChannel({
  endpoint: AXL_DEFENDER,
  targetNodes: [KEY_JUDGE, KEY_PROSECUTOR],
});
const judgeTransport = new WireChannel({
  endpoint: AXL_JUDGE,
  targetNodes: [KEY_PROSECUTOR, KEY_DEFENDER],
});

console.log("Waiting for AXL mesh to come up…");
await Promise.all([
  prosecutorTransport.awaitReady(),
  defenderTransport.awaitReady(),
  judgeTransport.awaitReady(),
]);

await Promise.all([
  prosecutorTransport.awaitPeers(1),
  defenderTransport.awaitPeers(1),
  judgeTransport.awaitPeers(1),
]);
console.log("Mesh ready — all 3 nodes connected.\n");

const prosecutorCond = new Conductor({
  choreography: score,
  role: "prosecutor",
  identity: idProsecutor,
  transport: prosecutorTransport,
  resolver,
  storage,
  gateProviders: gates,
  logPath,
  llm: prosecutorLLM,
});

const defenderCond = new Conductor({
  choreography: score,
  role: "defender",
  identity: idDefender,
  transport: defenderTransport,
  resolver,
  storage,
  gateProviders: gates,
  logPath,
  llm: defenderLLM,
});

const judgeCond = new Conductor({
  choreography: score,
  role: "judge",
  identity: idJudge,
  transport: judgeTransport,
  resolver,
  storage,
  gateProviders: gates,
  logPath,
  llm: judgeLLM,
});

const input = {
  accusation: "FlashBot-9000 extracted $2.3M from LiquidPool via a flash loan sandwich attack",
};

console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║           AI COURTROOM — swati × AXL distributed demo           ║");
console.log("╠══════════════════════════════════════════════════════════════════╣");
console.log(`║  Accusation: ${input.accusation.slice(0, 52)}  ║`);
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log();

const [, , judgeResult] = await Promise.all([
  prosecutorCond.run(input),
  defenderCond.run(input),
  judgeCond.run(input),
]).finally(async () => {
  await Promise.all([
    prosecutorTransport.close(),
    defenderTransport.close(),
    judgeTransport.close(),
  ]);
});

if (!judgeResult.ok) {
  console.error("FAILED:", judgeResult.ok === false ? judgeResult.error : "unknown");
  process.exit(1);
}

const ruling = judgeResult.value as {
  accusation: string;
  prosecution: string;
  defense: string;
  verdict: string;
};

const VERDICT_ICON: Record<string, string> = {
  guilty: "GUILTY",
  "not-guilty": "NOT GUILTY",
  "insufficient-evidence": "INSUFFICIENT EVIDENCE",
};

console.log("── PROSECUTION ─────────────────────────────────────────────────────");
console.log(ruling.prosecution);
console.log();
console.log("── DEFENSE ─────────────────────────────────────────────────────────");
console.log(ruling.defense);
console.log();
console.log("── VERDICT ─────────────────────────────────────────────────────────");
console.log(VERDICT_ICON[ruling.verdict] ?? ruling.verdict.toUpperCase());
console.log();
console.log("Choreography complete. Act log written to:", logPath);
