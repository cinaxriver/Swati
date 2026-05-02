import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  generateIdentity,
  loadIdentityFromFile,
  loadIdentityFromHex,
} from "@swati/core";
import { Conductor } from "@swati/core";
import { loadConfig } from "../config-loader.js";
import { ui } from "../ui.js";
import type { ChoreographyDef } from "@swati/core";

export interface RunOptions {
  role: string;
  score?: string;
  id?: string;
  config?: string;
  input?: string;
  json?: boolean;
  identityFile?: string;
}

export async function runRun(opts: RunOptions): Promise<void> {
  if (!opts.score && !opts.id) {
    ui.error("Provide either --score <file> or --id <manifest-uri>");
    process.exit(1);
  }

  const spinner = ui.spinner(`Starting conductor for role: ${opts.role}`);
  spinner.start();

  let tmpScorePath: string | null = null;
  let resolvedChoreoId: string | undefined;

  if (opts.id) {
    const cfg = await loadConfig(opts.config);

    spinner.text = "Fetching manifest...";
    const manifestResult = await cfg.storage.getManifest(opts.id);
    if (!manifestResult.ok) {
      spinner.fail(`Failed to fetch manifest: ${opts.id}`);
      ui.error(manifestResult.error.message);
      process.exit(1);
    }

    const manifest = manifestResult.value;
    if (!manifest.sourceUri) {
      spinner.fail(
        "Manifest has no sourceUri — was it published with `swati publish`?",
      );
      process.exit(1);
    }

    spinner.text = "Fetching source...";
    const sourceResult = await cfg.storage.getSource(manifest.sourceUri);
    if (!sourceResult.ok) {
      spinner.fail(`Failed to fetch source from ${manifest.sourceUri}`);
      ui.error(sourceResult.error.message);
      process.exit(1);
    }

    if (manifest.sourceHash) {
      const expected = manifest.sourceHash.replace(/^sha256:/, "");
      const actual = createHash("sha256")
        .update(sourceResult.value)
        .digest("hex");
      if (expected !== actual) {
        spinner.fail("Source integrity check failed — hash mismatch");
        ui.error(`Expected: ${expected}`);
        ui.error(`Got:      ${actual}`);
        process.exit(1);
      }

      resolvedChoreoId = `${manifest.name}@${manifest.sourceHash}`;
    }

    tmpScorePath = join(
      tmpdir(),
      `swati-run-${manifest.name}-${Date.now()}.choreo.ts`,
    );
    writeFileSync(tmpScorePath, sourceResult.value);
    opts = { ...opts, score: tmpScorePath };
    spinner.text = `Source verified: ${manifest.name} (${manifest.sourceHash?.slice(0, 20)}…)`;
  }

  let choreo: ChoreographyDef;
  try {
    const scorePath = pathToFileURL(resolve(opts.score!)).href;
    const mod = (await import(scorePath)) as { default: ChoreographyDef };
    choreo = mod.default;
    spinner.text = `Loaded choreography: ${choreo.name}`;
  } catch (cause) {
    spinner.fail(`Failed to load choreography from ${opts.score}`);
    ui.error(String(cause));
    if (tmpScorePath) {
      try {
        unlinkSync(tmpScorePath);
      } catch {}
    }
    process.exit(1);
  }

  if (!resolvedChoreoId && opts.score && !tmpScorePath) {
    const scoreBytes = readFileSync(resolve(opts.score));
    const hash =
      "sha256:" + createHash("sha256").update(scoreBytes).digest("hex");
    resolvedChoreoId = `${choreo.name}@${hash}`;
  }

  if (!choreo.roles.includes(opts.role)) {
    spinner.fail(
      `Role "${opts.role}" is not defined in choreography "${choreo.name}"`,
    );
    ui.info(`Available roles: ${choreo.roles.join(", ")}`);
    if (tmpScorePath) {
      try {
        unlinkSync(tmpScorePath);
      } catch {}
    }
    process.exit(1);
  }

  const cfg = await loadConfig(opts.config);

  let identity: Awaited<ReturnType<typeof generateIdentity>>;
  if (opts.identityFile) {
    identity = await loadIdentityFromFile(opts.identityFile);
  } else if (process.env["SWATI_PRIVKEY_HEX"]) {
    identity = await loadIdentityFromHex(
      process.env["SWATI_PRIVKEY_HEX"],
      opts.role,
    );
  } else {
    ui.warn(
      "No --identity-file or SWATI_PRIVKEY_HEX — generating ephemeral identity (log chain will not persist across restarts)",
    );
    identity = await generateIdentity(opts.role);
  }

  const input = opts.input ? (JSON.parse(opts.input) as unknown) : {};

  spinner.text = "Pre-flight checks...";
  for (const r of choreo.roles) {
    const resolved = await cfg.resolver.resolve(r);
    if (!resolved.ok) {
      spinner.fail(
        `Role "${r}" not found in resolver — add it to identities.json`,
      );
      if (tmpScorePath) {
        try {
          unlinkSync(tmpScorePath);
        } catch {}
      }
      process.exit(1);
    }
  }
  if (
    typeof (cfg.transport as Record<string, unknown>)["awaitReady"] ===
    "function"
  ) {
    const ready = await Promise.race([
      (cfg.transport as unknown as { awaitReady(): Promise<void> })
        .awaitReady()
        .then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 5000)),
    ]);
    if (!ready) {
      spinner.fail(
        "Transport endpoint unreachable within 5s — is AXL running?",
      );
      if (tmpScorePath) {
        try {
          unlinkSync(tmpScorePath);
        } catch {}
      }
      process.exit(1);
    }
  }
  spinner.succeed("Pre-flight OK");

  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const conductor = new Conductor({
    choreography: choreo,
    ...(resolvedChoreoId !== undefined ? { choreoId: resolvedChoreoId } : {}),
    runId,
    role: opts.role,
    identity,
    transport: cfg.transport,
    resolver: cfg.resolver,
    storage: cfg.storage,
    gateProviders: cfg.gates,
    llm: cfg.llm,
  });

  const shutdown = async (code = 1) => {
    await cfg.transport.close().catch(() => {});
    process.exit(code);
  };
  process.once("SIGINT", () => {
    void shutdown(130);
  });
  process.once("SIGTERM", () => {
    void shutdown(143);
  });

  const choreoIdDisplay = resolvedChoreoId
    ? `${choreo.name} (${resolvedChoreoId.split("@")[1]?.slice(0, 20)}…)`
    : choreo.name;
  ui.info(
    `Conductor ready — role: ${opts.role}, choreo: ${choreoIdDisplay}, runId: ${runId}`,
  );
  ui.info(`Waiting for peers and executing steps...`);

  const start = Date.now();
  let result: Awaited<ReturnType<typeof conductor.run>>;
  try {
    result = await conductor.run(input);
  } finally {
    await cfg.transport.close().catch(() => {});
    if (tmpScorePath) {
      try {
        unlinkSync(tmpScorePath);
      } catch {}
    }
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  if (result.ok) {
    ui.ok(`Run completed in ${elapsed}s`);
    if (opts.json) {
      ui.json(result.value);
    }
  } else {
    ui.error(`Run failed: ${result.error.message}`);
    if (opts.json) {
      ui.json(result.error);
    }
    process.exit(1);
  }
}
