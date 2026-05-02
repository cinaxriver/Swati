import { loadConfig } from "../config-loader.js";
import { ui } from "../ui.js";
import type { Manifest } from "@swati/core";

export interface JoinOptions {
  uri: string;
  config?: string;
  json?: boolean;
}

export async function runJoin(opts: JoinOptions): Promise<void> {
  const spinner = ui.spinner(`Fetching manifest: ${opts.uri}`);
  spinner.start();

  const cfg = await loadConfig(opts.config);

  const result = await cfg.storage.getManifest(opts.uri);
  if (!result.ok) {
    spinner.fail("Failed to fetch manifest");
    ui.error(result.error.message);
    process.exit(1);
  }

  const manifest: Manifest = result.value;
  spinner.succeed(`Manifest loaded: ${manifest.id}`);

  ui.header("Choreography");
  ui.dim(`  Name:    ${manifest.name}`);
  ui.dim(`  Version: ${manifest.version}`);
  ui.dim(`  Roles:   ${manifest.roles.join(", ")}`);

  const missingGates = manifest.plugins.filter((p) => !cfg.gates[p]);

  if (missingGates.length > 0) {
    ui.warn(`Missing gate providers: ${missingGates.join(", ")}`);
    ui.info("Register these gate providers in your swati.config.ts before running.");
  } else {
    ui.ok("All required gate providers are available");
  }

  ui.info(`Run a role with: swati run --role <role> --score <score.choreo.ts>`);
  ui.dim(`  Available roles: ${manifest.roles.join(", ")}`);

  if (opts.json) {
    ui.json({ manifest, missingGates });
  }
}
