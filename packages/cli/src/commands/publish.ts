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

  walletKey?: string;

  open?: boolean;
  network?: string;
  rpcUrl?: string;
  contractAddress?: string;
  json?: boolean;
}

export async function runPublish(opts: PublishOptions): Promise<void> {
  const spinner = ui.spinner("Publishing choreography…");
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

  spinner.text = "Uploading source…";
  const scorePath = resolve(opts.score);
  const sourceBytes = new Uint8Array(readFileSync(scorePath));
  const sourceHash = "sha256:" + createHash("sha256").update(sourceBytes).digest("hex");

  const sourceResult = await cfg.storage.putSource(sourceBytes);
  if (!sourceResult.ok) {
    spinner.fail("Failed to upload source");
    ui.error(sourceResult.error.message);
    process.exit(1);
  }

  spinner.text = "Publishing manifest…";
  const manifest = deriveManifest(choreo, {
    sourceHash,
    sourceUri: sourceResult.value.uri,
  });

  const manifestResult = await cfg.storage.putManifest(manifest);
  if (!manifestResult.ok) {
    spinner.fail("Failed to upload manifest");
    ui.error(manifestResult.error.message);
    process.exit(1);
  }

  let choreoId: string | undefined;

  if (opts.walletKey) {
    spinner.text = "Registering on-chain…";

    try {
      const { OnchainRegistry, manifestIdToBytes32 } = await import("@swati/registry-onchain");

      const network =
        opts.network === "mainnet" || opts.network === "sepolia" ? opts.network : "sepolia";

      const registry = new OnchainRegistry({
        network,
        walletPrivateKey: opts.walletKey,
        ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
        ...(opts.contractAddress ? { contractAddress: opts.contractAddress as `0x${string}` } : {}),
      });

      const regResult = await registry.registerChoreography(manifest, {
        sourceUri: sourceResult.value.uri,
        manifestUri: manifestResult.value.uri,
      });

      choreoId = regResult.choreoId;
      spinner.text = `Registered on-chain (${choreoId.slice(0, 14)}…)`;

      if (opts.open) {
        await (registry as any).setOpenRegistration(regResult.choreoId, true);
        spinner.text = "Open registration enabled";
      }

      spinner.succeed("Published + registered on-chain");
    } catch (cause) {
      spinner.warn(
        `Off-chain publish succeeded but on-chain registration failed: ${String(cause)}`,
      );
      spinner.warn(
        "Re-run: swati publish --score … --wallet-key $KEY  (or use `swati registry register`)",
      );
    }
  } else {
    spinner.succeed("Published");
  }

  if (opts.json) {
    ui.json({
      manifest,
      manifestUri: manifestResult.value.uri,
      sourceUri: sourceResult.value.uri,
      sourceHash,
      choreoId,
    });
    return;
  }

  ui.header(`Choreography: ${choreo.name}`);
  ui.dim(`  Roles:        ${manifest.roles.join(", ")}`);
  ui.dim(`  Source:       ${sourceResult.value.uri}`);
  ui.dim(`  Manifest URI: ${manifestResult.value.uri}`);
  if (choreoId) {
    ui.dim(`  choreoId:     ${choreoId}`);
    console.log();
    ui.ok("Share this choreoId with participants:");
    ui.info(`  ${choreoId}`);
    console.log();
    ui.dim("Participants run:");
    for (const role of manifest.roles) {
      ui.dim(`  swati join ${choreoId} --role ${role}`);
    }
    if (!opts.open) {
      console.log();
      ui.warn("Registration is CLOSED. Grant access with:");
      ui.dim(
        `  swati registry grant-role --choreo-id ${choreoId} --role <role> --grantee <wallet> --wallet-key $KEY`,
      );
      ui.dim("  Or open it: swati publish … --open");
    }
  } else {
    console.log();
    ui.info("To register on-chain (enables automatic discovery):");
    ui.dim(`  swati publish --score ${opts.score} --wallet-key $YOUR_WALLET_KEY --open`);
    ui.info("Or run locally:");
    ui.dim(`  swati run --role <role> --id ${manifestResult.value.uri}`);
  }
}
