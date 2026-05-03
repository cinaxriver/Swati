import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { ui } from "../ui.js";

export interface InitOptions {
  name?: string;

  choreoId?: string;
  network?: string;
  rpcUrl?: string;
  contractAddress?: string;
}

export async function runInit(options: InitOptions): Promise<void> {
  if (options.choreoId) {
    await runInitFromChain(options);
    return;
  }

  const name = options.name ?? "my-choreo";

  if (existsSync("swati.config.vanilla.ts")) {
    ui.warn("swati.config.vanilla.ts already exists. Skipping.");
    return;
  }

  const vanillaConfig = `import { defineConfig } from "@swati/core/config";
import { InMemoryTransport, StaticResolver, LocalFileStorage, LocalGate, MockLLM } from "@swati/core/adapters";

// Vanilla config — no external services needed.
// Swap adapters in swati.config.ts for production.
export default defineConfig({
  transport: new InMemoryTransport(),
  resolver: new StaticResolver("./identities.json"),
  storage: new LocalFileStorage(process.env.SWATI_HOME ?? "~/.swati/storage"),
  gates: { local: new LocalGate() },
  llm: new MockLLM({ response: "draft content" }),
});
`;

  const choreoTemplate = `import { choreography } from "@swati/core";

// ${name}: define your roles and their interactions.
export default choreography("${name}", {
  roles: ["role-a", "role-b"] as const,

  flow: async (c) => {
    // Role A does something.
    const result = await c.roles["role-a"]!.do("describe your task here");

    // Send the result to role B.
    const received = await c.send(result, "role-a", "role-b");

    // Role B makes a decision.
    const decision = await c.choose("role-b", ["approve", "revise"] as const, received);

    return { decision };
  },
});
`;

  const identities = `{
  "role-a": {
    "pubkey": "0000000000000000000000000000000000000000000000000000000000000001",
    "transportId": "mem-node-a"
  },
  "role-b": {
    "pubkey": "0000000000000000000000000000000000000000000000000000000000000002",
    "transportId": "mem-node-b"
  }
}
`;

  const runDemo = `// run-demo.mjs — run all roles in one process (vanilla / local mode)
// Usage: node run-demo.mjs
import { simulate } from "@swati/core";
import { MockLLM } from "@swati/core/adapters";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const { default: choreo } = await import(
  pathToFileURL(new URL("./${name}.choreo.ts", import.meta.url).pathname).href
);

const result = await simulate(choreo, {
  input: { topic: "hello from swati" },
  llm: new MockLLM({ responses: ["approved — looks good", "revised plan ready"] }),
});

for (const [role, outcome] of Object.entries(result)) {
  console.log(\`[\${role}]\`, outcome.ok ? JSON.stringify(outcome.value) : outcome.error?.message);
}
`;

  writeFileSync("swati.config.vanilla.ts", vanillaConfig, "utf-8");
  writeFileSync(`${name}.choreo.ts`, choreoTemplate, "utf-8");
  writeFileSync("run-demo.mjs", runDemo, "utf-8");

  if (!existsSync("identities.json")) {
    writeFileSync("identities.json", identities, "utf-8");
  }

  mkdirSync(".swati/logs", { recursive: true });

  ui.ok(`Initialized swati project: ${name}`);
  ui.dim(`  ${name}.choreo.ts       — choreography definition`);
  ui.dim(`  swati.config.vanilla.ts — vanilla configuration`);
  ui.dim(`  identities.json         — role identities (vanilla)`);
  ui.dim(`  run-demo.mjs            — run all roles locally (no AXL needed)`);
  ui.dim("");
  ui.info(`Quick start:  node run-demo.mjs`);
  ui.dim(`Production:   swati run --role role-a --score ${name}.choreo.ts`);
}

async function runInitFromChain(options: InitOptions): Promise<void> {
  const rawId = options.choreoId!;
  const network =
    options.network === "mainnet" || options.network === "sepolia" ? options.network : "sepolia";

  const spinner = ui.spinner(`Fetching choreography from on-chain registry…`);
  spinner.start();

  const { OnchainRegistry } = await import("@swati/registry-onchain");

  const registry = new OnchainRegistry({
    network,
    ...(options.rpcUrl ? { rpcUrl: options.rpcUrl } : {}),
    ...(options.contractAddress
      ? { contractAddress: options.contractAddress as `0x${string}` }
      : {}),
  });

  let choreoId: string;
  try {
    if (rawId.startsWith("0x") && rawId.length === 66) {
      choreoId = rawId;
    } else if (rawId.startsWith("swati:")) {
      const { manifestIdToBytes32 } = await import("@swati/registry-onchain");
      choreoId = manifestIdToBytes32(rawId);
    } else {
      spinner.fail(`Unrecognized choreography ID format: "${rawId}"`);
      ui.dim("  Expected: 0x<64-char hex>  or  swati:<hash>/<name>");
      process.exit(1);
    }
  } catch (cause) {
    spinner.fail("Failed to parse choreoId");
    ui.error(String(cause));
    process.exit(1);
  }

  let info: Awaited<ReturnType<typeof registry.getChoreography>>;
  try {
    info = await registry.getChoreography(choreoId);
  } catch (cause) {
    spinner.fail("Registry read failed");
    ui.error(String(cause));
    process.exit(1);
  }

  if (!info) {
    spinner.fail(`No choreography found for ${choreoId}`);
    ui.dim("  Make sure the choreoId is correct and you are on the right network.");
    process.exit(1);
  }

  spinner.text = `Found "${info.name}" — downloading source…`;

  let sourceTs = "";
  if (info.sourceUri) {
    try {
      sourceTs = await fetchText(info.sourceUri);
    } catch (cause) {
      spinner.warn(`Could not download source from ${info.sourceUri}: ${String(cause)}`);
    }
  }

  const choreoFileName = `${info.name.replace(/[^a-z0-9-_]/gi, "-").toLowerCase()}.choreo.ts`;

  if (sourceTs) {
    writeFileSync(choreoFileName, sourceTs, "utf-8");
    spinner.text = "Source downloaded — writing config…";
  } else {
    spinner.warn("Source URI unavailable — skipping source download. You can add it manually.");
  }

  const configFileName = "swati.config.onchain.ts";

  if (!existsSync(configFileName)) {
    const onchainConfig = buildOnchainConfig(choreoId, info.name, info.roles, network, options);
    writeFileSync(configFileName, onchainConfig, "utf-8");
  }

  mkdirSync(".swati/logs", { recursive: true });

  spinner.succeed(`Choreography "${info.name}" initialised`);

  ui.header(`Choreography: ${info.name}`);
  ui.dim(`  choreoId:  ${choreoId}`);
  ui.dim(`  roles:     ${info.roles.join(", ")}`);
  ui.dim(`  publisher: ${info.publisher}`);
  if (info.sourceUri) ui.dim(`  source:    ${info.sourceUri}`);
  if (info.manifestUri) ui.dim(`  manifest:  ${info.manifestUri}`);
  console.log();

  const isOpen = await (
    registry as unknown as { isOpenRegistration: (id: string) => Promise<boolean> }
  )
    .isOpenRegistration(choreoId)
    .catch(() => false);

  ui.header("Next steps");
  ui.info("1. Generate your identity (if you don't have one yet):");
  ui.dim("     swati keygen --name <your-name> --out ~/.swati/<name>.key.json");
  console.log();
  ui.info("2. Register for a role:");
  for (const role of info.roles) {
    ui.dim(`     swati join-role ${choreoId} \\`);
    ui.dim(`       --role ${role} \\`);
    ui.dim(`       --identity-file ~/.swati/<name>.key.json \\`);
    ui.dim(`       --axl-endpoint http://localhost:9002 \\`);
    ui.dim(`       --wallet-key $WALLET_KEY`);
    if (!isOpen) {
      ui.warn(`     (Registration is closed — publisher must grant you access first)`);
    }
    console.log();
  }
  ui.info("3. Run your role:");
  ui.dim(`     swati run --role <role> --id ${info.manifestUri || choreoId} \\`);
  ui.dim(`       --config ${configFileName} \\`);
  ui.dim(`       --identity-file ~/.swati/<name>.key.json`);
}

function buildOnchainConfig(
  choreoId: string,
  _name: string,
  _roles: string[],
  network: "mainnet" | "sepolia",
  opts: InitOptions,
): string {
  const contractLine = opts.contractAddress
    ? `\n  contractAddress: "${opts.contractAddress}" as \`0x\${string}\`,`
    : "";
  const rpcLine = opts.rpcUrl ? `\n  rpcUrl: "${opts.rpcUrl}",` : "";

  return `// Auto-generated by \`swati init ${choreoId}\`
// On-chain resolver: reads pubkeys + AXL peer IDs from SwatiRegistry.sol
// Each participant runs \`swati join-role\` once to register; no manual JSON needed.

import { defineConfig } from "@swati/core/config";
import { LocalFileStorage, LocalGate } from "@swati/core/adapters";
import { WireChannel } from "@swati/transport-axl";
import { AnthropicLLM } from "@swati/llm-anthropic";
import { OnchainRegistry } from "@swati/registry-onchain";
import { OnChainRegistryResolver } from "@swati/resolver-onchain";
import { homedir } from "node:os";
import { join } from "node:path";

const choreoId = "${choreoId}" as \`0x\${string}\`;

const registry = new OnchainRegistry({
  network: "${network}",${rpcLine}${contractLine}
});

// Reads pubkeyHex + axlPeerId directly from chain — no identities.json needed.
const resolver = new OnChainRegistryResolver({ choreoId, registry });

export default defineConfig({
  // WireChannel connects to your local AXL node.
  // Set AXL_ENDPOINT=http://localhost:<port> if using a non-default port.
  transport: new WireChannel(),

  resolver,

  storage: new LocalFileStorage(
    join(process.env["SWATI_HOME"] ?? join(homedir(), ".swati"), "storage")
  ),

  gates: { local: new LocalGate({ timeoutMs: 30_000, retries: 1 }) },

  llm: new AnthropicLLM(),
});
`;
}

async function fetchText(uri: string): Promise<string> {
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${uri}`);
    return res.text();
  }
  if (uri.startsWith("ipfs://")) {
    const cid = uri.slice(7);
    const gateway = process.env["IPFS_GATEWAY"] ?? "https://ipfs.io";
    const res = await fetch(`${gateway}/ipfs/${cid}`);
    if (!res.ok) throw new Error(`IPFS gateway HTTP ${res.status}`);
    return res.text();
  }
  throw new Error(`Unsupported URI scheme: ${uri}`);
}
