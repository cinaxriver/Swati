import { ui } from "../ui.js";

export interface EnsLookupOptions {
  name: string;
  network?: string;
  rpcUrl?: string;
  json?: boolean;
}

export async function runEnsLookup(opts: EnsLookupOptions): Promise<void> {
  const { lookupEnsRecords } = await import("@swati/resolver-ens/register");
  const network = (opts.network ?? "mainnet") as "mainnet" | "sepolia";

  const spinner = ui.spinner(`Looking up ${opts.name}…`);
  spinner.start();

  let result: Awaited<ReturnType<typeof lookupEnsRecords>>;
  try {
    const lookupOpts: { network: "mainnet" | "sepolia"; rpcUrl?: string } = {
      network,
    };
    if (opts.rpcUrl) lookupOpts.rpcUrl = opts.rpcUrl;
    result = await lookupEnsRecords(opts.name, lookupOpts);
  } catch (cause) {
    spinner.fail("Lookup failed");
    ui.error(String(cause));
    process.exit(1);
  }

  spinner.stop();

  if (opts.json) {
    ui.json(result);
    return;
  }

  ui.header(`ENS records for ${result.name}`);
  ui.dim(`  resolver: ${result.resolverAddress ?? "none"}`);

  const ALL_KEYS = [
    "swati.pubkey",
    "swati.axl_pubkey",
    "swati.caps",
    "swati.choreographies",
    "swati.rep",
  ];

  for (const key of ALL_KEYS) {
    const val = result.records[key];
    if (val) {
      ui.ok(`  ${key}: ${val}`);
    } else {
      ui.dim(`  ${key}: (not set)`);
    }
  }

  const hasRequired =
    result.records["swati.pubkey"] && result.records["swati.axl_pubkey"];

  console.log();
  if (hasRequired) {
    ui.ok("Name is configured and ready to use as a swati role identity.");
  } else {
    ui.warn("Missing required records. Run:");
    ui.dim(
      `  swati ens register ${opts.name} --pubkey <hex> --axl-pubkey <base64> --wallet-key <hex>`,
    );
  }
}

export interface EnsRegisterOptions {
  name: string;
  pubkey: string;
  axlPubkey: string;
  walletKey: string;
  capsUrl?: string;
  choreographies?: string;
  repUrl?: string;
  network?: string;
  rpcUrl?: string;
  json?: boolean;
}

export async function runEnsRegister(opts: EnsRegisterOptions): Promise<void> {
  const { registerEnsRecords } = await import("@swati/resolver-ens/register");
  const network = (opts.network ?? "mainnet") as "mainnet" | "sepolia";

  const choreos = opts.choreographies
    ? opts.choreographies
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const spinner = ui.spinner(`Writing ENS records for ${opts.name}…`);
  spinner.start();

  let result: Awaited<ReturnType<typeof registerEnsRecords>>;
  try {
    const regOpts: import("@swati/resolver-ens/register").RegisterOptions = {
      name: opts.name,
      pubkeyHex: opts.pubkey,
      axlPubkey: opts.axlPubkey,
      walletPrivateKey: opts.walletKey,
      network,
    };
    if (opts.capsUrl) regOpts.capsUrl = opts.capsUrl;
    if (choreos) regOpts.choreographies = choreos;
    if (opts.repUrl) regOpts.repUrl = opts.repUrl;
    if (opts.rpcUrl) regOpts.rpcUrl = opts.rpcUrl;
    result = await registerEnsRecords(regOpts);
  } catch (cause) {
    spinner.fail("Registration failed");
    ui.error(String(cause));
    process.exit(1);
  }

  spinner.succeed(`Records written — tx: ${result.txHash}`);

  if (opts.json) {
    ui.json(result);
    return;
  }

  ui.header("Records set");
  for (const key of result.recordsSet) {
    ui.ok(`  ${key}`);
  }

  console.log();
  ui.info("Verify with:");
  ui.dim(`  swati ens lookup ${opts.name} --network ${network}`);
}

export interface EnsCheckOptions {
  name: string;
  choreoId: string;
  network?: string;
  rpcUrl?: string;
  json?: boolean;
}

export async function runEnsCheck(opts: EnsCheckOptions): Promise<void> {
  const { EnsResolver } = await import("@swati/resolver-ens");
  const network = (opts.network ?? "mainnet") as "mainnet" | "sepolia";

  const resolverCfg: import("@swati/resolver-ens").EnsResolverConfig = {
    network,
    allowedChoreoId: opts.choreoId,
    cacheTtlMs: 0,
  };
  if (opts.rpcUrl) resolverCfg.rpcUrl = opts.rpcUrl;
  const resolver = new EnsResolver(resolverCfg);

  const spinner = ui.spinner(
    `Checking ${opts.name} for choreo ${opts.choreoId}…`,
  );
  spinner.start();

  const result = await resolver.resolve(opts.name);
  spinner.stop();

  if (opts.json) {
    ui.json(
      result.ok
        ? { ok: true, identity: result.value }
        : { ok: false, error: result.error },
    );
    return;
  }

  if (result.ok) {
    ui.ok(`${opts.name} is authorized to join choreography "${opts.choreoId}"`);
    ui.dim(
      `  pubkey:      ${Buffer.from(result.value.pubkey).toString("hex").slice(0, 16)}…`,
    );
    ui.dim(`  transportId: ${result.value.transportId.slice(0, 20)}…`);
  } else {
    ui.error(result.error.message);
    process.exit(1);
  }
}
