import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deriveManifest } from "@swati/core";
import { loadConfig } from "../config-loader.js";
import { ui } from "../ui.js";
import type { ChoreographyDef } from "@swati/core";

export interface PublishOptions {
  score: string;
  config?: string;
  mint?: boolean;
  json?: boolean;
}

export async function runPublish(opts: PublishOptions): Promise<void> {
  const spinner = ui.spinner("Publishing choreography...");
  spinner.start();

  let choreo: ChoreographyDef;
  try {
    const scorePath = pathToFileURL(resolve(opts.score)).href;
    const mod = (await import(scorePath)) as { default: ChoreographyDef };
    choreo = mod.default;
  } catch (cause) {
    spinner.fail("Failed to load choreography");
    ui.error(String(cause));
    process.exit(1);
  }

  const cfg = await loadConfig(opts.config);

  spinner.text = "Uploading source...";
  const scorePath = resolve(opts.score);
  const sourceBytes = new Uint8Array(readFileSync(scorePath));
  const sourceHash = "sha256:" + createHash("sha256").update(sourceBytes).digest("hex");

  const sourceResult = await cfg.storage.putSource(sourceBytes);
  if (!sourceResult.ok) {
    spinner.fail("Failed to upload source");
    ui.error(sourceResult.error.message);
    process.exit(1);
  }

  spinner.text = "Publishing manifest...";
  const manifest = deriveManifest(choreo, {
    sourceHash,
    sourceUri: sourceResult.value.uri,
  });

  const result = await cfg.storage.putManifest(manifest);
  if (!result.ok) {
    spinner.fail("Failed to upload manifest");
    ui.error(result.error.message);
    process.exit(1);
  }

  spinner.succeed(`Published: ${manifest.id}`);
  ui.dim(`  Manifest URI: ${result.value.uri}`);
  ui.dim(`  Source URI:   ${sourceResult.value.uri}`);
  ui.dim(`  Source hash:  ${sourceHash}`);
  ui.dim(`  Roles:        ${manifest.roles.join(", ")}`);
  ui.info(`Run without source: swati run --id ${result.value.uri} --role <role>`);

  if (opts.mint) {
    ui.info(
      "iNFT minting — use `swati mint <uri>` after setting ZEROG_PRIVATE_KEY and contract address.",
    );
  }

  if (opts.json) {
    ui.json({
      manifest,
      manifestUri: result.value.uri,
      sourceUri: sourceResult.value.uri,
      sourceHash,
    });
  }
}
