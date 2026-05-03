import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { Conductor } from "@swati/core";
import {
  InMemoryTransport,
  StaticResolver,
  LocalFileStorage,
  LocalGate,
  MockLLM,
} from "@swati/core/adapters";
import type { Identity } from "@swati/core";
import score from "./ai-courtroom.choreo.js";

const __dir = dirname(fileURLToPath(import.meta.url));

function loadIdentity(roleName: string): Identity {
  const raw = JSON.parse(readFileSync(join(__dir, `${roleName}.key.json`), "utf-8")) as {
    pubkey: string;
    privateKey: string;
  };

  return {
    name: roleName,
    pubkey: Buffer.from(raw.pubkey, "hex"),
    privateKey: Buffer.from(raw.privateKey, "hex"),
  };
}

const idProsecutor = loadIdentity("prosecutor");
const idDefender = loadIdentity("defender");
const idJudge = loadIdentity("judge");

const pubkeyHex = (id: Identity) => Buffer.from(id.pubkey).toString("hex");

const resolver = new StaticResolver({
  prosecutor: { pubkey: pubkeyHex(idProsecutor), transportId: "prosecutor" },
  defender: { pubkey: pubkeyHex(idDefender), transportId: "defender" },
  judge: { pubkey: pubkeyHex(idJudge), transportId: "judge" },
});

const storage = new LocalFileStorage(join(tmpdir(), "swati-ai-courtroom", "storage"));
const gates = { local: new LocalGate({ timeoutMs: 30_000, retries: 1 }) };
const logPath = join(tmpdir(), "swati-ai-courtroom", "logs");

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

const prosecutorCond = new Conductor({
  choreography: score,
  role: "prosecutor",
  identity: idProsecutor,
  transport: new InMemoryTransport("prosecutor"),
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
  transport: new InMemoryTransport("defender"),
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
  transport: new InMemoryTransport("judge"),
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
console.log("║              AI COURTROOM — swati choreography demo              ║");
console.log("╠══════════════════════════════════════════════════════════════════╣");
console.log(`║  Accusation: ${input.accusation.slice(0, 52)}  ║`);
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log();

const [_prosResult, _defResult, judgeResult] = await Promise.all([
  prosecutorCond.run(input),
  defenderCond.run(input),
  judgeCond.run(input),
]);

if (!judgeResult.ok) {
  console.error("FAILED:", judgeResult.error);
  process.exit(1);
}

const ruling = judgeResult.value as {
  accusation: string;
  prosecution: string;
  defense: string;
  verdict: string;
};

const VERDICT_ICON: Record<string, string> = {
  guilty: "⚖  GUILTY",
  "not-guilty": "✓  NOT GUILTY",
  "insufficient-evidence": "?  INSUFFICIENT EVIDENCE",
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

console.log();
console.log("── LOG VERIFICATION ────────────────────────────────────────────────");
for (const [roleName, cond] of [
  ["prosecutor", prosecutorCond],
  ["defender", defenderCond],
  ["judge", judgeCond],
] as const) {
  const v = await (cond as Conductor).verifyLog();
  console.log(`  ${roleName}: ${v.ok ? "✔ chain intact" : "✖ " + v.error?.message}`);
}
