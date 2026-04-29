import { AppendLog } from "@swati/core";
import { loadConfig } from "../config-loader.js";
import { ui } from "../ui.js";

export interface VerifyOptions {
  uri: string;
  config?: string;
  json?: boolean;
}

export async function runVerify(opts: VerifyOptions): Promise<void> {
  const spinner = ui.spinner("Fetching log snapshot...");
  spinner.start();

  const cfg = await loadConfig(opts.config);
  const result = await cfg.storage.getLogSnapshot(opts.uri);

  if (!result.ok) {
    spinner.fail("Failed to fetch log snapshot");
    ui.error(result.error.message);
    process.exit(1);
  }

  spinner.text = "Verifying signatures...";

  const { writeFileSync, unlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const tmpPath = join(tmpdir(), `swati-verify-${Date.now()}.jsonl`);
  writeFileSync(tmpPath, result.value, "utf-8");

  const log = new AppendLog(tmpPath);
  const verifyResult = await log.verifyChain();

  try {
    unlinkSync(tmpPath);
  } catch {}

  if (verifyResult.ok) {
    spinner.succeed("Log chain verified — all signatures valid");
    const acts = log.all();
    ui.dim(`  ${acts.length} acts verified`);
    if (opts.json) {
      ui.json({ ok: true, acts: acts.length });
    }
  } else {
    spinner.fail("Log chain verification FAILED");
    ui.error(verifyResult.error.message);
    if (opts.json) {
      ui.json({ ok: false, error: verifyResult.error });
    }
    process.exit(1);
  }
}
