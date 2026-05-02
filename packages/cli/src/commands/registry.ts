import { ui } from "../ui.js";

function parseNetwork(n?: string): "mainnet" | "sepolia" {
  if (n === "mainnet" || n === "sepolia") return n;
  return "mainnet";
}

export interface RegistryRegisterOptions {
  manifestId: string;
  sourceUri?: string;
  manifestUri?: string;
  walletKey: string;
  network?: string;
  rpcUrl?: string;
  contractAddress?: string;
  json?: boolean;
}

export async function runRegistryRegister(
  opts: RegistryRegisterOptions,
): Promise<void> {
  const { OnchainRegistry } = await import("@swati/registry-onchain");

  const registry = new OnchainRegistry({
    network: parseNetwork(opts.network),
    walletPrivateKey: opts.walletKey,
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    ...(opts.contractAddress
      ? { contractAddress: opts.contractAddress as `0x${string}` }
      : {}),
  });

  const { loadConfig } = await import("../config-loader.js");
  const cfg = await loadConfig();
  const manifestResult = await cfg.storage.getManifest(opts.manifestId);
  if (!manifestResult.ok) {
    ui.error(`Could not fetch manifest: ${manifestResult.error.message}`);
    process.exit(1);
  }
  const manifest = manifestResult.value;

  const spinner = ui.spinner(`Registering ${manifest.name} on-chain…`);
  spinner.start();

  let result: Awaited<ReturnType<typeof registry.registerChoreography>>;
  try {
    const regOpts: { sourceUri?: string; manifestUri?: string } = {};
    if (opts.sourceUri) regOpts.sourceUri = opts.sourceUri;
    if (opts.manifestUri) regOpts.manifestUri = opts.manifestUri;
    result = await registry.registerChoreography(manifest, regOpts);
  } catch (cause) {
    spinner.fail("Registration failed");
    ui.error(String(cause));
    process.exit(1);
  }

  spinner.succeed(`Registered — tx: ${result.txHash}`);

  if (opts.json) {
    ui.json(result);
    return;
  }

  ui.header("Choreography registered on-chain");
  ui.dim(`  choreoId:    ${result.choreoId}`);
  ui.dim(`  manifestId:  ${manifest.id}`);
  ui.dim(`  roles:       ${manifest.roles.join(", ")}`);
  ui.dim(`  tx:          ${result.txHash}`);
  console.log();
  ui.info("Next: register role identities with:");
  ui.dim(
    `  swati registry register-role --choreo-id ${result.choreoId} --role <role> --pubkey <hex> --wallet-key <hex>`,
  );
}

export interface RegistryRegisterRoleOptions {
  choreoId: string;
  role: string;
  pubkey: string;
  ensName?: string;
  axlPeerId?: string;
  walletKey: string;
  network?: string;
  rpcUrl?: string;
  contractAddress?: string;
  json?: boolean;
}

export async function runRegistryRegisterRole(
  opts: RegistryRegisterRoleOptions,
): Promise<void> {
  const { OnchainRegistry } = await import("@swati/registry-onchain");

  const registry = new OnchainRegistry({
    network: parseNetwork(opts.network),
    walletPrivateKey: opts.walletKey,
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    ...(opts.contractAddress
      ? { contractAddress: opts.contractAddress as `0x${string}` }
      : {}),
  });

  const spinner = ui.spinner(`Registering role "${opts.role}" on-chain…`);
  spinner.start();

  let result: Awaited<ReturnType<typeof registry.registerRole>>;
  try {
    const roleOpts: { ensName?: string; axlPeerId?: string } = {};
    if (opts.ensName) roleOpts.ensName = opts.ensName;
    if (opts.axlPeerId) roleOpts.axlPeerId = opts.axlPeerId;
    result = await registry.registerRole(
      opts.choreoId as `0x${string}`,
      opts.role,
      opts.pubkey,
      roleOpts,
    );
  } catch (cause) {
    spinner.fail("Role registration failed");
    ui.error(String(cause));
    process.exit(1);
  }

  spinner.succeed(`Role registered — tx: ${result.txHash}`);
  if (opts.json) ui.json(result);
}

export interface RegistryLinkInvokeOptions {
  parentId: string;
  childId: string;
  walletKey: string;
  network?: string;
  rpcUrl?: string;
  contractAddress?: string;
  json?: boolean;
}

export async function runRegistryLinkInvoke(
  opts: RegistryLinkInvokeOptions,
): Promise<void> {
  const { OnchainRegistry } = await import("@swati/registry-onchain");

  const registry = new OnchainRegistry({
    network: parseNetwork(opts.network),
    walletPrivateKey: opts.walletKey,
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    ...(opts.contractAddress
      ? { contractAddress: opts.contractAddress as `0x${string}` }
      : {}),
  });

  const spinner = ui.spinner("Linking invoke relationship on-chain…");
  spinner.start();

  let result: Awaited<ReturnType<typeof registry.linkInvoke>>;
  try {
    result = await registry.linkInvoke(opts.parentId, opts.childId);
  } catch (cause) {
    spinner.fail("Link failed");
    ui.error(String(cause));
    process.exit(1);
  }

  spinner.succeed(`Linked — tx: ${result.txHash}`);

  if (opts.json) {
    ui.json(result);
    return;
  }

  ui.dim(`  parent: ${opts.parentId}`);
  ui.dim(`  child:  ${opts.childId}`);
}

export interface RegistryAnchorLogOptions {
  manifestId: string;
  logUri: string;
  logFile?: string;
  walletKey: string;
  network?: string;
  rpcUrl?: string;
  contractAddress?: string;
  json?: boolean;
}

export async function runRegistryAnchorLog(
  opts: RegistryAnchorLogOptions,
): Promise<void> {
  const { OnchainRegistry } = await import("@swati/registry-onchain");
  const { readFileSync } = await import("node:fs");

  const logJsonl = opts.logFile ? readFileSync(opts.logFile, "utf-8") : "";

  const registry = new OnchainRegistry({
    network: parseNetwork(opts.network),
    walletPrivateKey: opts.walletKey,
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    ...(opts.contractAddress
      ? { contractAddress: opts.contractAddress as `0x${string}` }
      : {}),
  });

  const spinner = ui.spinner("Anchoring execution log on-chain…");
  spinner.start();

  let result: Awaited<ReturnType<typeof registry.anchorLog>>;
  try {
    result = await registry.anchorLog(opts.manifestId, logJsonl, opts.logUri);
  } catch (cause) {
    spinner.fail("Anchor failed");
    ui.error(String(cause));
    process.exit(1);
  }

  spinner.succeed(`Log anchored — tx: ${result.txHash}`);
  if (opts.json) ui.json(result);
}

export interface RegistryLookupOptions {
  id: string;
  network?: string;
  rpcUrl?: string;
  contractAddress?: string;
  json?: boolean;
}

export async function runRegistryLookup(
  opts: RegistryLookupOptions,
): Promise<void> {
  const { OnchainRegistry } = await import("@swati/registry-onchain");

  const registry = new OnchainRegistry({
    network: parseNetwork(opts.network),
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    ...(opts.contractAddress
      ? { contractAddress: opts.contractAddress as `0x${string}` }
      : {}),
  });

  const spinner = ui.spinner(`Looking up ${opts.id}…`);
  spinner.start();

  let info: Awaited<ReturnType<typeof registry.getChoreography>>;
  try {
    info = await registry.getChoreography(opts.id);
  } catch (cause) {
    spinner.fail("Lookup failed");
    ui.error(String(cause));
    process.exit(1);
  }

  spinner.stop();

  if (!info) {
    ui.warn(`No choreography found for: ${opts.id}`);
    process.exit(1);
  }

  if (opts.json) {
    ui.json(info);
    return;
  }

  ui.header(`Choreography: ${info.name}`);
  ui.dim(`  choreoId:     ${info.choreoId}`);
  ui.dim(`  manifestHash: ${info.manifestHash}`);
  ui.dim(`  publisher:    ${info.publisher}`);
  ui.dim(`  registered:   ${info.registeredAt.toISOString()}`);
  ui.dim(`  roles:        ${info.roles.join(", ")}`);
  if (info.sourceUri) ui.dim(`  sourceUri:    ${info.sourceUri}`);
  if (info.manifestUri) ui.dim(`  manifestUri:  ${info.manifestUri}`);

  let anchors: Awaited<ReturnType<typeof registry.getLogAnchors>>;
  try {
    anchors = await registry.getLogAnchors(opts.id);
  } catch {
    anchors = [];
  }

  if (anchors.length > 0) {
    ui.header(`Execution logs (${anchors.length})`);
    for (const a of anchors) {
      ui.ok(`  ${a.anchoredAt.toISOString()} — ${a.logUri}`);
      ui.dim(`       hash: ${a.logRootHash}`);
      ui.dim(`       by:   ${a.anchoredBy}`);
    }
  } else {
    ui.dim("  No execution logs anchored yet.");
  }
}

export interface RegistryVerifyRoleOptions {
  id: string;
  role: string;
  pubkey: string;
  network?: string;
  rpcUrl?: string;
  contractAddress?: string;
  json?: boolean;
}

export async function runRegistryVerifyRole(
  opts: RegistryVerifyRoleOptions,
): Promise<void> {
  const { OnchainRegistry } = await import("@swati/registry-onchain");

  const registry = new OnchainRegistry({
    network: parseNetwork(opts.network),
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    ...(opts.contractAddress
      ? { contractAddress: opts.contractAddress as `0x${string}` }
      : {}),
  });

  const spinner = ui.spinner(`Verifying role "${opts.role}"…`);
  spinner.start();

  let valid: boolean;
  try {
    valid = await registry.verifyRole(opts.id, opts.role, opts.pubkey);
  } catch (cause) {
    spinner.fail("Verification failed");
    ui.error(String(cause));
    process.exit(1);
  }

  spinner.stop();

  if (opts.json) {
    ui.json({ role: opts.role, pubkey: opts.pubkey, valid });
    return;
  }

  if (valid) {
    ui.ok(`Role "${opts.role}" pubkey is registered and matches.`);
  } else {
    ui.error(`Role "${opts.role}" pubkey does NOT match the registry.`);
    process.exit(1);
  }
}
