import { writeFileSync } from "node:fs";
import { generateIdentity, pubkeyToHex } from "@swati/core";
import { ui } from "../ui.js";

export async function runKeygen(options: {
  name?: string;
  out?: string;
  json?: boolean;
}): Promise<void> {
  const name = options.name ?? "swati-agent";
  const identity = await generateIdentity(name);

  const output = {
    name,
    pubkey: pubkeyToHex(identity.pubkey),
    privateKey: Buffer.from(identity.privateKey).toString("hex"),
    note: "Keep privateKey secret. pubkey goes in identities.json or ENS text record swati.pubkey.",
  };

  if (options.json || options.out) {
    const json = JSON.stringify(output, null, 2);
    if (options.out) {
      writeFileSync(options.out, json, "utf-8");
      ui.ok(`Key pair written to ${options.out}`);
    } else {
      ui.json(output);
    }
    return;
  }

  ui.header("Generated identity");
  ui.dim(`  name:       ${output.name}`);
  ui.dim(`  pubkey:     ${output.pubkey}`);
  ui.dim(`  privateKey: ${output.privateKey.slice(0, 16)}...`);
  ui.warn("Store the private key securely. Do not commit it.");
}
