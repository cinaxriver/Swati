#!/usr/bin/env node

import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runKeygen } from "./commands/keygen.js";
import { runRun } from "./commands/run.js";
import { runPublish } from "./commands/publish.js";
import { runVerify } from "./commands/verify.js";
import { runJoin } from "./commands/join.js";
import { runWatch } from "./commands/watch.js";
import { runMint } from "./commands/mint.js";
import { runVisualize } from "./commands/visualize.js";
import { runEnsLookup, runEnsRegister, runEnsCheck } from "./commands/ens.js";
import {
  runRegistryRegister,
  runRegistryRegisterRole,
  runRegistryLinkInvoke,
  runRegistryAnchorLog,
  runRegistryLookup,
  runRegistryVerifyRole,
} from "./commands/registry.js";

const program = new Command();

program
  .name("swati")
  .description(
    [
      "A choreographic language and runtime for multi-agent AI workflows.",
      "Write the protocol once; run each role on a different machine.",
      "Structural deadlock prevention through choreographic interpretation.",
      "",
      "Usage groups:",
      "  Authoring:    swati init, swati keygen",
      "  Deployment:   swati publish, swati join",
      "  Execution:    swati run, swati watch",
      "  Verification: swati verify",
    ].join("\n"),
  )
  .version("0.1.0");

program
  .command("init")
  .description(
    "Initialize a new swati project with a template choreography and vanilla config",
  )
  .option("--name <name>", "choreography name", "my-choreo")
  .action(async (opts: { name?: string }) => {
    await runInit(opts);
  });

program
  .command("keygen")
  .description("Generate a new ed25519 identity keypair for an agent")
  .option("--name <name>", "agent name", "swati-agent")
  .option("--out <file>", "write keypair JSON to file")
  .option("--json", "output as JSON")
  .action(async (opts: { name?: string; out?: string; json?: boolean }) => {
    await runKeygen(opts);
  });

program
  .command("run")
  .description("Start a Conductor for the given role in a choreography")
  .requiredOption("--role <role>", "role name to execute (e.g. researcher)")
  .option("--score <file>", "path to .choreo.ts choreography file (local)")
  .option(
    "--id <uri>",
    "manifest URI from `swati publish` — fetches and verifies source automatically",
  )
  .option("--config <file>", "path to swati.config.ts (default: auto-detect)")
  .option("--input <json>", "JSON-encoded input for the choreography")
  .option("--json", "output result as JSON")
  .action(
    async (opts: {
      role: string;
      score?: string;
      id?: string;
      config?: string;
      input?: string;
      json?: boolean;
    }) => {
      await runRun(opts);
    },
  );

program
  .command("publish")
  .description("Publish a choreography manifest to storage (local or 0G)")
  .requiredOption("--score <file>", "path to .choreo.ts choreography file")
  .option("--config <file>", "path to swati.config.ts")
  .option("--mint", "also mint an ERC-7857 iNFT (requires 0G config)")
  .option("--json", "output as JSON")
  .action(
    async (opts: {
      score: string;
      config?: string;
      mint?: boolean;
      json?: boolean;
    }) => {
      await runPublish(opts);
    },
  );

program
  .command("verify <uri>")
  .description("Verify the signature chain of a log snapshot URI")
  .option("--config <file>", "path to swati.config.ts")
  .option("--json", "output as JSON")
  .action(async (uri: string, opts: { config?: string; json?: boolean }) => {
    await runVerify({ uri, ...opts });
  });

program
  .command("join <uri>")
  .description(
    "Fetch a choreography manifest by URI and validate local plugin availability",
  )
  .option("--config <file>", "path to swati.config.ts")
  .option("--json", "output as JSON")
  .action(async (uri: string, opts: { config?: string; json?: boolean }) => {
    await runJoin({ uri, ...opts });
  });

program
  .command("watch")
  .description(
    "Tail the live act log of a running choreography (not yet implemented)",
  )
  .requiredOption("--score <file>", "path to .choreo.ts choreography file")
  .option("--role <role>", "filter to a specific role")
  .option("--config <file>", "path to swati.config.ts")
  .action(async (opts: { score: string; role?: string; config?: string }) => {
    await runWatch(opts);
  });

program
  .command("visualize")
  .description(
    "Visualize the choreography flow as ASCII art or Mermaid diagram",
  )
  .requiredOption("--score <file>", "path to .choreo.ts choreography file")
  .option("--format <type>", "output format: 'ascii' or 'mermaid'", "ascii")
  .option("--mermaid-out <file>", "export mermaid diagram to file")
  .action(
    async (opts: { score: string; format?: string; mermaidOut?: string }) => {
      await runVisualize(opts);
    },
  );

program
  .command("mint <uri>")
  .description(
    "Mint an ERC-7857 iNFT for a published choreography manifest (requires 0G + EVM wallet)",
  )
  .option("--config <file>", "path to swati.config.ts")
  .option("--json", "output as JSON")
  .action(async (uri: string, opts: { config?: string; json?: boolean }) => {
    await runMint({ uri, ...opts });
  });

const ens = program
  .command("ens")
  .description("Manage ENS text records for swati agent identities");

ens
  .command("lookup <name>")
  .description("Display swati text records registered under an ENS name")
  .option("--network <net>", "mainnet or sepolia", "mainnet")
  .option("--rpc-url <url>", "custom RPC endpoint")
  .option("--json", "output as JSON")
  .action(
    async (
      name: string,
      opts: { network?: string; rpcUrl?: string; json?: boolean },
    ) => {
      await runEnsLookup({ name, ...opts });
    },
  );

ens
  .command("register <name>")
  .description(
    "Write swati identity records to an ENS name (requires wallet key)",
  )
  .requiredOption("--pubkey <hex>", "ed25519 pubkey hex from `swati keygen`")
  .requiredOption("--axl-pubkey <base64>", "AXL peer ID from AXL node config")
  .requiredOption(
    "--wallet-key <hex>",
    "private key of the wallet that owns the ENS name",
  )
  .option("--caps-url <url>", "URL to capability manifest JSON")
  .option(
    "--choreographies <ids>",
    "comma-separated choreography IDs this name may join",
  )
  .option("--rep-url <url>", "URL to reputation oracle")
  .option("--network <net>", "mainnet or sepolia", "mainnet")
  .option("--rpc-url <url>", "custom RPC endpoint")
  .option("--json", "output as JSON")
  .action(
    async (
      name: string,
      opts: {
        pubkey: string;
        axlPubkey: string;
        walletKey: string;
        capsUrl?: string;
        choreographies?: string;
        repUrl?: string;
        network?: string;
        rpcUrl?: string;
        json?: boolean;
      },
    ) => {
      await runEnsRegister({ name, ...opts });
    },
  );

ens
  .command("check <name>")
  .description(
    "Verify that an ENS name is authorized to join a specific choreography",
  )
  .requiredOption(
    "--choreo-id <id>",
    "choreography manifest ID to check against",
  )
  .option("--network <net>", "mainnet or sepolia", "mainnet")
  .option("--rpc-url <url>", "custom RPC endpoint")
  .option("--json", "output as JSON")
  .action(
    async (
      name: string,
      opts: {
        choreoId: string;
        network?: string;
        rpcUrl?: string;
        json?: boolean;
      },
    ) => {
      await runEnsCheck({ name, ...opts });
    },
  );

const reg = program
  .command("registry")
  .description(
    "Manage choreographies, role identities, and invoke links in the on-chain SwatiRegistry",
  );

const REG_OPTS = (cmd: ReturnType<typeof reg.command>) =>
  cmd
    .option("--network <net>", "mainnet or sepolia", "mainnet")
    .option("--rpc-url <url>", "custom RPC endpoint")
    .option("--contract-address <addr>", "override registry contract address")
    .option("--json", "output as JSON");

REG_OPTS(reg.command("register"))
  .description("Register a published choreography manifest on-chain")
  .requiredOption(
    "--manifest-id <id>",
    "swati manifest ID (from `swati publish`)",
  )
  .requiredOption(
    "--wallet-key <hex>",
    "private key of the wallet that owns the registration",
  )
  .option("--source-uri <uri>", "override source URI stored in the manifest")
  .option(
    "--manifest-uri <uri>",
    "override manifest URI stored in the manifest",
  )
  .action(
    async (opts: {
      manifestId: string;
      walletKey: string;
      sourceUri?: string;
      manifestUri?: string;
      network?: string;
      rpcUrl?: string;
      contractAddress?: string;
      json?: boolean;
    }) => {
      await runRegistryRegister(opts);
    },
  );

REG_OPTS(reg.command("register-role"))
  .description("Register an ed25519 role identity for a choreography")
  .requiredOption(
    "--choreo-id <bytes32>",
    "on-chain choreoId from `registry register`",
  )
  .requiredOption("--role <name>", "role name (e.g. analyst)")
  .requiredOption("--pubkey <hex>", "ed25519 pubkey hex from `swati keygen`")
  .requiredOption(
    "--wallet-key <hex>",
    "private key of the choreography publisher",
  )
  .option("--ens-name <name>", "optional ENS subname (e.g. analyst.alice.eth)")
  .option("--axl-peer-id <id>", "optional AXL peer ID")
  .action(
    async (opts: {
      choreoId: string;
      role: string;
      pubkey: string;
      walletKey: string;
      ensName?: string;
      axlPeerId?: string;
      network?: string;
      rpcUrl?: string;
      contractAddress?: string;
      json?: boolean;
    }) => {
      await runRegistryRegisterRole(opts);
    },
  );

REG_OPTS(reg.command("link-invoke"))
  .description(
    "Declare on-chain that a parent choreography may invoke a child (mirrors c.invoke())",
  )
  .requiredOption(
    "--parent-id <id>",
    "parent choreography manifest ID or bytes32",
  )
  .requiredOption(
    "--child-id <id>",
    "child choreography manifest ID or bytes32",
  )
  .requiredOption(
    "--wallet-key <hex>",
    "private key of the parent choreography publisher",
  )
  .action(
    async (opts: {
      parentId: string;
      childId: string;
      walletKey: string;
      network?: string;
      rpcUrl?: string;
      contractAddress?: string;
      json?: boolean;
    }) => {
      await runRegistryLinkInvoke(opts);
    },
  );

REG_OPTS(reg.command("anchor-log"))
  .description(
    "Anchor an execution log hash on-chain for verifiable audit trail",
  )
  .requiredOption("--manifest-id <id>", "swati manifest ID of the choreography")
  .requiredOption(
    "--log-uri <uri>",
    "storage URI where the full JSONL log is stored",
  )
  .requiredOption(
    "--wallet-key <hex>",
    "private key to sign the anchor transaction",
  )
  .option(
    "--log-file <path>",
    "path to JSONL log file (used to compute log root hash)",
  )
  .action(
    async (opts: {
      manifestId: string;
      logUri: string;
      logFile?: string;
      walletKey: string;
      network?: string;
      rpcUrl?: string;
      contractAddress?: string;
      json?: boolean;
    }) => {
      await runRegistryAnchorLog(opts);
    },
  );

REG_OPTS(reg.command("lookup <id>"))
  .description("Look up a choreography by manifest ID or bytes32 choreoId")
  .action(
    async (
      id: string,
      opts: {
        network?: string;
        rpcUrl?: string;
        contractAddress?: string;
        json?: boolean;
      },
    ) => {
      await runRegistryLookup({ id, ...opts });
    },
  );

REG_OPTS(reg.command("verify-role"))
  .description("Verify that a role pubkey matches what is registered on-chain")
  .requiredOption("--id <id>", "choreography manifest ID or bytes32")
  .requiredOption("--role <name>", "role name")
  .requiredOption("--pubkey <hex>", "ed25519 pubkey hex to verify")
  .action(
    async (opts: {
      id: string;
      role: string;
      pubkey: string;
      network?: string;
      rpcUrl?: string;
      contractAddress?: string;
      json?: boolean;
    }) => {
      await runRegistryVerifyRole(opts);
    },
  );

program.parse(process.argv);
