# Swati

> Write the protocol once. Every agent runs its own part — automatically.

Most multi-agent AI systems are held together with shared state, manual retries, and hope. Swati takes a different approach: you define the entire conversation as a single **choreography**, and each agent's behavior is derived from that. No duplicated logic, no silent deadlocks, no out-of-sync participants.

Under the hood, every act is ed25519-signed and hash-chained (Secure Scuttlebutt-style). Every branch is broadcast to all roles so they always agree on which path was taken. Gated actions are irreversible by design — wrap a Uniswap swap or an on-chain call in `gate()` and it either happens with a proof or not at all.

### Architecture diagrams

The [`architecture/`](architecture/) directory contains diagrams you can reuse in overview: [system overview](architecture/system-overview.png), [network topology](architecture/network-topology.png), [Conductor internals](architecture/conductor-internals.png), [DSL primitives](architecture/dsl-primitives.png), and [lifecycle](architecture/lifecycle.png). 

---

## How it works

You write a `flow` function over a `ChoreoContext`. That function *is* the global protocol — Swati projects it down to each agent at runtime.

```ts
// aligned with examples/research-collab/score.choreo.ts (shorter prompts)
import { choreography } from "@swati/core";

export interface ResearchInput {
  topic: string;
  maxIterations?: number;
}

export default choreography<ResearchInput, { result: string; iterations: number }>(
  "research-collab",
  {
    roles: ["researcher", "critic", "executor"],

    async flow(c) {
      const { researcher, critic } = c.roles;
      let iterations = 0;
      const maxIter = c.input.maxIterations ?? 3;

      let proposal = (await researcher.do(
        `Concise proposal for "${c.input.topic}". Proposal text only.`,
      )) as string;

      await c.send(proposal, "researcher", "critic");

      while (iterations < maxIter) {
        iterations++;

        const review = (await critic.do(
          `APPROVE or REVISE?\nProposal:\n${proposal}`,
        )) as string;

        await c.send(review, "critic", "researcher");
        await c.send(review, "critic", "executor");

        const decision = await c.choose("critic", ["approve", "revise"] as const, review);

        if (decision === "approve") {
          const executionResult = await c.gate("executor", "local", async () =>
            c.roles.executor.do(`Summarize executing:\n${proposal}`),
          );
          const summary = executionResult.ok
            ? String(executionResult.value)
            : "execution failed";

          await c.persist("last-result", summary);
          return { result: summary, iterations };
        }

        proposal = (await researcher.do(
          `Revise proposal from feedback:\n${review}\nOriginal:\n${proposal}`,
        )) as string;
        await c.send(proposal, "researcher", "critic");
      }

      return { result: proposal, iterations };
    },
  },
);
```

Run each role separately — on the same machine or across the network:

```bash
cd examples/research-collab
pnpm exec swati run --role researcher --score ./score.choreo.ts --config ./swati.config.vanilla.ts --input '{"topic":"quantum error correction"}'
pnpm exec swati run --role critic     --score ./score.choreo.ts --config ./swati.config.vanilla.ts
pnpm exec swati run --role executor   --score ./score.choreo.ts --config ./swati.config.vanilla.ts
```

---

## Install

**From this monorepo (development):**

```bash
pnpm install
pnpm build
# optional: pnpm --filter @swati/cli link -g
pnpm exec swati -- --help
```

Requires **Node ≥ 20.10** and **pnpm ≥ 9** (see root `package.json`).

**As a library:** `pnpm add @swati/core` (or `npm install @swati/core`) once published from your registry.

---

## CLI

| Command | What it does |
|---------|--------------|
| `swati init` | Scaffold a choreography project (`--name`, optional `--choreo-id` for on-chain bootstrap) |
| `swati keygen` | Generate an ed25519 identity keypair (`--out`, `--json`) |
| `swati publish <score>` | Publish a `.choreo.ts`; with `--wallet-key` (or env) registers on `SwatiRegistry.sol` (`--open` for open registration) |
| `swati join <target>` | Daemon: `<target>` = `0x<choreoId>` or manifest URI; `--role` required; `--once` / `--input` for one-shot |
| `swati run` | Single-role Conductor: `--role`, and either `--score <file>` or `--id <uri>` |
| `swati daemon` | HTTP JSON-RPC on port 7420 (`--port`) |
| `swati verify <uri>` | Verify the ed25519 signature chain of a stored log |
| `swati visualize --score <file>` | ASCII or Mermaid sequence diagram (`--format`, `--mermaid-out`) |
| `swati watch --score <file>` | Watch file and tail the live log (`--role` to filter) |
| `swati mint --uri <uri>` | Mint an ERC-7857 iNFT on 0G for a manifest |
| `swati registry …` | Low-level registry: `register`, `register-role`, `grant-role`, `set-open`, `lookup`, `verify-role`, `anchor-log`, `link-invoke` |
| `swati ens …` | ENS text records: `lookup`, `register`, `check` |

### Common flags

```bash
--config <file>        # swati.config.ts / .js (run, watch, verify, mint, publish, join)
--input <json>         # choreography input JSON
--json                 # machine-readable CLI output
--peer-timeout-ms <n> # run: wait longer for peers (e.g. remote storage)
--wallet-key <hex>     # publish / join: EVM key (or SWATI_WALLET_KEY / ZEROG_PRIVATE_KEY)
```

---

## DSL primitives

```ts
c.roles.analyst.do(prompt)               // LLM call as a role
c.send(value, "from", "to")              // directed message
c.choose("role", ["a","b"], evidence)    // branching decision, broadcast to all
c.chooseIf("role", condition)            // boolean branch, no LLM
c.locally("role", () => compute())       // local computation → Located<T>
c.computeSend("from", "to", () => fn()) // compute + send in one step
c.gate("role", "provider", () => fn())   // irreversible action with proof
c.persist(key, value)                   // shared choreography state
c.recall(key)                            // read persisted value
c.invoke(subChoreo, input)              // compose a sub-choreography inline
c.recurse(newInput)                     // loop back with new input
```

---

## Configuration

Swati is adapter-driven. `@swati/core` ships **`InMemoryTransport`**, **`StaticResolver`**, **`LocalFileStorage`**, **`LocalGate`**, **`MockLLM`**. Plug in optional packages (`@swati/transport-axl`, `@swati/storage-0g`, etc.) where you need them.

Example (local/dev), aligned with `examples/ai-courtroom/swati.config.vanilla.ts`:

```ts
import { defineConfig } from "@swati/core/config";
import {
  InMemoryTransport,
  StaticResolver,
  LocalFileStorage,
  LocalGate,
  MockLLM,
} from "@swati/core/adapters";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  transport: new InMemoryTransport(),
  resolver: new StaticResolver(join(__dir, "identities.json")), // pubkey + transportId per role
  storage: new LocalFileStorage("./swati-data"),
  gates: { local: new LocalGate({ timeoutMs: 30_000, retries: 1 }) },
  llm: new MockLLM({ responses: ["…"] }),
});
```

`identities.json` maps each role to `{ "pubkey": "<hex>", "transportId": "<peer id>" }`.

Distributed / production-shaped stack (package names → main types):

| Layer | Local / bundled | Distributed |
|-------|-----------------|-------------|
| Transport | `InMemoryTransport` | `WireChannel` (`@swati/transport-axl`) |
| Resolver | `StaticResolver` | `EnsResolver` (`@swati/resolver-ens`), `OnChainRegistryResolver` (`@swati/resolver-onchain`) |
| Storage | `LocalFileStorage` | `BlobVault` (`@swati/storage-0g`) |
| Gate | `LocalGate` | (custom `GateProvider` implementations) |
| LLM | `MockLLM` | Any implementation of `@swati/core`’s LLM interface |

---

## Examples

| Example | What it demonstrates |
|---------|---------------------|
| `examples/research-collab` | Propose → review loop with `choose()`, `gate()`, `score.choreo.ts`; scripts use `pnpm exec swati` with `--config ./swati.config.vanilla.ts` |
| `examples/ai-courtroom` | Prosecutor / defender / judge; programmatic multi-Conductor demo via `tsx run-all.ts`; CLI run uses `ai-courtroom.choreo.ts` |

**Courtroom — three terminals (same pattern as research-collab):**

```bash
cd examples/ai-courtroom
pnpm exec swati run --role prosecutor --score ./ai-courtroom.choreo.ts --config ./swati.config.vanilla.ts --input '{"accusation":"flash loan exploit on USDC pool"}'
pnpm exec swati run --role defender   --score ./ai-courtroom.choreo.ts --config ./swati.config.vanilla.ts
pnpm exec swati run --role judge      --score ./ai-courtroom.choreo.ts --config ./swati.config.vanilla.ts
```

Or run the bundled orchestration demo (after `pnpm build` at repo root):

```bash
cd examples/ai-courtroom
pnpm run run   # tsx run-all.ts
```

---

## Packages

| Package | Description |
|---------|-------------|
| `@swati/core` | DSL, Conductor runtime, bundled adapters (`@swati/core/adapters`), types |
| `@swati/cli` | `swati` binary |
| `@swati/transport-axl` | `WireChannel` over AXL |
| `@swati/resolver-ens` | `EnsResolver` |
| `@swati/resolver-onchain` | `OnChainRegistryResolver` (SwatiRegistry) |
| `@swati/storage-0g` | `BlobVault`, 0G iNFT mint helpers |
| `@swati/registry-onchain` | Ethereum registry client, ABI, deploy helpers |
| `@swati/trigger-onchain` | On-chain run triggers (`SwatiRunTrigger`) |

---

## Deadlock freedom by construction

Swati choreographies cannot deadlock due to mismatched sends and receives — this is a structural guarantee, not a runtime check.

Every `send`, `choose`, and `chooseIf` call in the DSL describes a globally coordinated communication step: the sending role transmits, all receiving roles await. Because the entire system is one choreography — not N independent programs — every message sent is paired with a corresponding receive at definition time. There is no way to write a `send` without an implicit `recv` on the other side.

This is the core theorem of choreographic programming (Qiu et al. 2007; Carbone & Montesi 2013) and the primary motivation behind HasChor (Shen et al., ICFP 2023), on which Swati's DSL is based.

> **Note:** FLP (1985) impossibility still applies to async networks. Swati does not claim consensus under arbitrary failures — it claims that *correctly written* choreographies cannot deadlock from mismatched communication.

## Theoretical foundation

Swati draws from three bodies of work:

- **Choreographic Programming** — Montesi (2013): write the global protocol once, project it to each participant
- **HasChor** — Shen, Kashiwa & Kuper (ICFP 2023): `Located<T>`, `locally`, `computeSend`, `invoke` primitives
- **Secure Scuttlebutt** — Tarr et al. (2014): per-role append-only signed log with hash-chained entries
