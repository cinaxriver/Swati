#!/usr/bin/env node

import { Command } from "commander";
import { runKeygen } from "./commands/keygen.js";
import { runPublish } from "./commands/publish.js";
import { runJoin } from "./commands/join.js";
import { runRun } from "./commands/run.js";
import { runDaemon } from "./commands/daemon.js";
import { runVerify } from "./commands/verify.js";
import {
  runRegistryRegister,
  runRegistryRegisterRole,
  runRegistryLinkInvoke,
  runRegistryAnchorLog,
  runRegistryLookup,
  runRegistryVerifyRole,
  runRegistryGrantRole,
  runRegistrySetOpenRegistration,
} from "./commands/registry.js";
import { runEnsLookup, runEnsRegister, runEnsCheck } from "./commands/ens.js";

const program = new Command();

program
  .name("swati")
  .description(
    [
      "Choreographic multi-agent runtime.",
      "",
      "AUTHOR flow:",
      "  swati keygen                              — generate identity",
      "  swati publish score.choreo.ts --open     — publish + register on-chain",
      "",
      "PARTICIPANT flow:",
      "  swati join 0x<choreoId> --role <role>    — join + run as daemon",
      "",
      "INTEGRATION (library):",
      "  import { Conductor } from '@swati/core'",
      "  import { OnchainTrigger, requestRun } from '@swati/trigger-onchain'",
    ].join("\n"),
  )
  .version("0.1.0");

program
  .command("keygen")
  .description("Generate an ed25519 identity keypair")
  .option("--name <name>", "agent name", "swati-agent")
  .option("--out <file>", "write to file (recommended: ~/.swati/<name>.key.json)")
  .option("--json", "output as JSON")
  .action(async (opts: { name?: string; out?: string; json?: boolean }) => {
    await runKeygen(opts);
  });

program
  .command("publish <score>")
  .description(
    "Publish a choreography.\n" +
      "  Without --wallet-key: uploads source + manifest to storage only.\n" +
      "  With    --wallet-key: also registers on SwatiRegistry.sol → prints choreoId.",
  )
  .option("--wallet-key <hex>", "wallet private key for on-chain registration")
  .option("--open", "enable open self-registration (anyone can join)")
  .option("--network <net>", "mainnet or sepolia", "sepolia")
  .option("--rpc-url <url>", "custom RPC endpoint")
  .option("--contract-address <addr>", "override SwatiRegistry address")
  .option("--config <file>", "swati config file (for storage backend)")
  .option("--json", "output as JSON")
  .action(
    async (
      score: string,
      opts: {
        walletKey?: string;
        open?: boolean;
        network?: string;
        rpcUrl?: string;
        contractAddress?: string;
        config?: string;
        json?: boolean;
      },
    ) => {
      await runPublish({ score, ...opts });
    },
  );

program
  .command("join <target>")
  .description(
    "Join a choreography role and run as a daemon.\n" +
      "  <target>: 0x<choreoId> (on-chain) or manifest URI (local)\n\n" +
      "  On-chain mode (--wallet-key required):\n" +
      "    • fetches source from registry\n" +
      "    • generates identity if none found at ~/.swati/<role>.key.json\n" +
      "    • reads AXL peer ID from /topology\n" +
      "    • claims role on-chain\n" +
      "    • listens for RunRequested events → runs Conductor on each trigger\n\n" +
      "  Local mode (manifest URI):\n" +
      "    • fetches manifest, runs once",
  )
  .requiredOption("--role <name>", "role name (e.g. researcher)")
  .option("--wallet-key <hex>", "wallet private key (on-chain mode)")
  .option(
    "--identity-file <path>",
    "identity JSON from `swati keygen` (default: ~/.swati/<role>.key.json)",
  )
  .option(
    "--axl-endpoint <url>",
    "local AXL node (default: $AXL_ENDPOINT or http://localhost:9002)",
  )
  .option("--once", "run once instead of daemon mode")
  .option("--input <json>", "JSON input for one-shot mode")
  .option("--network <net>", "mainnet or sepolia", "sepolia")
  .option("--rpc-url <url>", "custom RPC endpoint")
  .option("--contract-address <addr>", "override SwatiRegistry address")
  .option("--config <file>", "swati config file (overrides defaults)")
  .action(
    async (
      target: string,
      opts: {
        role: string;
        walletKey?: string;
        identityFile?: string;
        axlEndpoint?: string;
        once?: boolean;
        input?: string;
        network?: string;
        rpcUrl?: string;
        contractAddress?: string;
        config?: string;
      },
    ) => {
      await runJoin({ target, ...opts });
    },
  );

program
  .command("run")
  .description("Run one conductor for a role (advanced / lib integration mode)")
  .requiredOption("--role <role>", "role name")
  .option("--score <file>", "local .choreo.ts file")
  .option("--id <uri>", "manifest URI")
  .option("--config <file>", "swati config file")
  .option("--input <json>", "JSON-encoded input")
  .option("--identity-file <path>", "identity JSON file")
  .option("--json", "output as JSON")
  .action(
    async (opts: {
      role: string;
      score?: string;
      id?: string;
      config?: string;
      input?: string;
      identityFile?: string;
      json?: boolean;
    }) => {
      await runRun(opts);
    },
  );

program
  .command("daemon")
  .description(
    "Start Swati HTTP daemon (port 7420) — accepts swati.submit / swati.getResult JSON-RPC",
  )
  .option("--port <n>", "HTTP port", "7420")
  .option("--config <file>", "swati config file")
  .action(async (opts: { port?: string; config?: string }) => {
    await runDaemon({ port: opts.port ? parseInt(opts.port, 10) : undefined, config: opts.config });
  });

program
  .command("verify <uri>")
  .description("Verify the ed25519 signature chain of a stored log")
  .option("--config <file>", "swati config file")
  .option("--json", "output as JSON")
  .action(async (uri: string, opts: { config?: string; json?: boolean }) => {
    await runVerify({ uri, ...opts });
  });

const reg = program
  .command("registry")
  .description("Advanced: manage SwatiRegistry.sol (publisher tooling)");

const REG_OPTS = (cmd: ReturnType<typeof reg.command>) =>
  cmd
    .option("--network <net>", "mainnet or sepolia", "sepolia")
    .option("--rpc-url <url>", "custom RPC endpoint")
    .option("--contract-address <addr>", "override registry contract address")
    .option("--json", "output as JSON");

REG_OPTS(reg.command("register"))
  .description("Register a manifest on-chain (included in `swati publish --wallet-key`)")
  .requiredOption("--manifest-id <id>", "swati manifest ID")
  .requiredOption("--wallet-key <hex>", "publisher wallet key")
  .option("--source-uri <uri>", "override source URI")
  .option("--manifest-uri <uri>", "override manifest URI")
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
  .description("Publisher-side role registration (included in `swati join` for participants)")
  .requiredOption("--choreo-id <id>", "bytes32 choreoId")
  .requiredOption("--role <name>", "role name")
  .requiredOption("--pubkey <hex>", "ed25519 pubkey hex")
  .requiredOption("--wallet-key <hex>", "publisher wallet key")
  .option("--axl-peer-id <id>", "AXL peer ID")
  .option("--identity-locator <uri>", "metadata locator URI")
  .action(
    async (opts: {
      choreoId: string;
      role: string;
      pubkey: string;
      walletKey: string;
      axlPeerId?: string;
      identityLocator?: string;
      network?: string;
      rpcUrl?: string;
      contractAddress?: string;
      json?: boolean;
    }) => {
      await runRegistryRegisterRole(opts);
    },
  );

REG_OPTS(reg.command("grant-role"))
  .description("Grant a specific wallet permission to claim a role")
  .requiredOption("--choreo-id <id>", "bytes32 choreoId")
  .requiredOption("--role <name>", "role name")
  .requiredOption("--grantee <addr>", "wallet address to grant")
  .requiredOption("--wallet-key <hex>", "publisher wallet key")
  .action(
    async (opts: {
      choreoId: string;
      role: string;
      grantee: string;
      walletKey: string;
      network?: string;
      rpcUrl?: string;
      contractAddress?: string;
      json?: boolean;
    }) => {
      await runRegistryGrantRole(opts);
    },
  );

REG_OPTS(reg.command("set-open"))
  .description("Enable/disable open self-registration for a choreography")
  .requiredOption("--choreo-id <id>", "bytes32 choreoId")
  .requiredOption("--wallet-key <hex>", "publisher wallet key")
  .option("--open", "enable (omit to disable)")
  .action(
    async (opts: {
      choreoId: string;
      walletKey: string;
      open?: boolean;
      network?: string;
      rpcUrl?: string;
      contractAddress?: string;
      json?: boolean;
    }) => {
      await runRegistrySetOpenRegistration(opts);
    },
  );

REG_OPTS(reg.command("lookup <id>"))
  .description("Look up a choreography on-chain")
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
  .description("Verify a role pubkey on-chain")
  .requiredOption("--id <id>", "choreoId or manifest ID")
  .requiredOption("--role <name>", "role name")
  .requiredOption("--pubkey <hex>", "ed25519 pubkey hex")
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

REG_OPTS(reg.command("anchor-log"))
  .description("Anchor an execution log hash on-chain")
  .requiredOption("--manifest-id <id>", "swati manifest ID")
  .requiredOption("--log-uri <uri>", "storage URI of the JSONL log")
  .requiredOption("--wallet-key <hex>", "signing wallet key")
  .option("--log-file <path>", "log file to hash")
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

REG_OPTS(reg.command("link-invoke"))
  .description("Declare that a parent choreography may invoke a child")
  .requiredOption("--parent-id <id>", "parent choreoId")
  .requiredOption("--child-id <id>", "child choreoId")
  .requiredOption("--wallet-key <hex>", "publisher wallet key")
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

const ens = program
  .command("ens")
  .description("Advanced: manage ENS text records for swati identities");

ens
  .command("lookup <name>")
  .option("--network <net>", "mainnet or sepolia", "mainnet")
  .option("--rpc-url <url>", "custom RPC endpoint")
  .option("--json", "output as JSON")
  .action(async (name: string, opts: { network?: string; rpcUrl?: string; json?: boolean }) => {
    await runEnsLookup({ name, ...opts });
  });

ens
  .command("register <name>")
  .requiredOption("--pubkey <hex>", "ed25519 pubkey hex")
  .requiredOption("--axl-pubkey <base64>", "AXL peer ID")
  .requiredOption("--wallet-key <hex>", "wallet key")
  .option("--choreographies <ids>", "comma-separated choreography IDs")
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
        choreographies?: string;
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
  .requiredOption("--choreo-id <id>", "choreography ID to check against")
  .option("--network <net>", "mainnet or sepolia", "mainnet")
  .option("--rpc-url <url>", "custom RPC endpoint")
  .option("--json", "output as JSON")
  .action(
    async (
      name: string,
      opts: { choreoId: string; network?: string; rpcUrl?: string; json?: boolean },
    ) => {
      await runEnsCheck({ name, ...opts });
    },
  );

program.parse(process.argv);
