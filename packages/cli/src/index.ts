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

program.parse(process.argv);
