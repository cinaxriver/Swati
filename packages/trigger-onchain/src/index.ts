import {
  createPublicClient,
  createWalletClient,
  http,
  hexToBytes,
  keccak256,
  type Address,
  type Hash,
  type Chain,
  type WatchContractEventReturnType,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { SWATI_RUN_TRIGGER_ABI, TRIGGER_ADDRESSES } from "./abi.js";
import type { ChoreographyDef, SwatiRuntime } from "@swati/core";

export interface TriggerConfig {
  contractAddress?: Address;
  rpcUrl?: string;
  network?: "mainnet" | "sepolia";

  pollingInterval?: number;
}

export interface ListenOptions<I = unknown> {
  choreoId: `0x${string}`;

  role: string;

  choreo: ChoreographyDef<I, unknown>;

  runtime: SwatiRuntime;

  identityFile?: string;

  serializeResult?: (result: unknown, ok: boolean) => `0x${string}`;

  reportResults?: boolean;

  walletPrivateKey?: string;
}

export interface RequestRunOptions {
  contractAddress?: Address;

  choreoId: `0x${string}`;

  input: unknown;
  walletPrivateKey: string;
  rpcUrl?: string;
  network?: "mainnet" | "sepolia";
}

export interface RequestRunResult {
  txHash: Hash;
  runKey: `0x${string}`;
}

export interface ReportResultOptions {
  contractAddress?: Address;
  runKey: `0x${string}`;
  role: string;
  success: boolean;
  result: `0x${string}`;
  walletPrivateKey: string;
  rpcUrl?: string;
  network?: "mainnet" | "sepolia";
}

export class OnchainTrigger {
  private readonly cfg: Required<TriggerConfig>;
  private readonly publicClient: ReturnType<typeof createPublicClient>;
  private unwatches: WatchContractEventReturnType[] = [];

  constructor(cfg: TriggerConfig = {}) {
    const network = cfg.network ?? "sepolia";
    const chain: Chain = network === "mainnet" ? mainnet : sepolia;
    const defaultRpc =
      network === "mainnet" ? "https://eth.llamarpc.com" : "https://rpc.sepolia.org";

    const rpcUrl = cfg.rpcUrl ?? process.env["ETH_RPC_URL"] ?? defaultRpc;
    const contractAddress: Address =
      cfg.contractAddress ??
      TRIGGER_ADDRESSES[network] ??
      (() => {
        throw new Error("contractAddress required — deploy SwatiRunTrigger.sol first");
      })();

    this.cfg = {
      contractAddress,
      rpcUrl,
      network,
      pollingInterval: cfg.pollingInterval ?? 4_000,
    };

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl, { retryCount: 3 }),
      pollingInterval: this.cfg.pollingInterval,
    });
  }

  listen<I = unknown>(opts: ListenOptions<I>): this {
    const unwatch = this.publicClient.watchContractEvent({
      address: this.cfg.contractAddress,
      abi: SWATI_RUN_TRIGGER_ABI,
      eventName: "RunRequested",
      args: { choreoId: opts.choreoId },

      onLogs: (logs) => {
        for (const log of logs) {
          const { runKey, input } = log.args as {
            runKey: `0x${string}`;
            choreoId: `0x${string}`;
            input: `0x${string}`;
            requester: Address;
          };

          void this._handleRun(runKey, input, opts);
        }
      },

      onError: (err) => {
        console.error("[OnchainTrigger] event watch error:", err);
      },
    });

    this.unwatches.push(unwatch);
    return this;
  }

  stop(): void {
    for (const unwatch of this.unwatches) unwatch();
    this.unwatches = [];
  }

  private async _handleRun<I>(
    runKey: `0x${string}`,
    inputHex: `0x${string}`,
    opts: ListenOptions<I>,
  ): Promise<void> {
    let parsedInput: I;
    try {
      const bytes = hexToBytes(inputHex);
      parsedInput = JSON.parse(new TextDecoder().decode(bytes)) as I;
    } catch (e) {
      console.error(`[OnchainTrigger] failed to parse input for runKey=${runKey}:`, e);
      return;
    }

    console.log(`[OnchainTrigger] RunRequested runKey=${runKey} role=${opts.role}`);

    let swatiRunId: string;
    try {
      swatiRunId = await opts.runtime.submit(
        opts.choreo,
        opts.role,
        parsedInput,
        opts.identityFile,
      );
    } catch (e) {
      console.error(`[OnchainTrigger] runtime.submit failed:`, e);
      return;
    }

    const result = await opts.runtime.waitFor(swatiRunId).catch((e) => ({
      ok: false as const,
      error: { code: "WAIT_FAILED" as const, message: String(e) },
    }));

    console.log(`[OnchainTrigger] run complete runKey=${runKey} ok=${result.ok}`);

    const shouldReport = opts.reportResults ?? !!opts.walletPrivateKey;
    if (!shouldReport) return;

    const walletKey = opts.walletPrivateKey;
    if (!walletKey) {
      console.warn("[OnchainTrigger] reportResults=true but no walletPrivateKey — skipping");
      return;
    }

    const serialize = opts.serializeResult ?? defaultSerialize;
    const resultBytes = serialize(result.ok ? result.value : result.error, result.ok);

    try {
      await reportResult({
        contractAddress: this.cfg.contractAddress,
        runKey,
        role: opts.role,
        success: result.ok,
        result: resultBytes,
        walletPrivateKey: walletKey,
        rpcUrl: this.cfg.rpcUrl,
        network: this.cfg.network,
      });
      console.log(`[OnchainTrigger] result reported on-chain for runKey=${runKey}`);
    } catch (e) {
      console.error(`[OnchainTrigger] reportResult failed:`, e);
    }
  }
}

export async function requestRun(opts: RequestRunOptions): Promise<RequestRunResult> {
  const { chain, walletClient, account } = buildWalletClient(
    opts.walletPrivateKey,
    opts.network ?? "sepolia",
    opts.rpcUrl,
  );

  const contractAddress = resolveAddress(opts.contractAddress, opts.network ?? "sepolia");
  const inputBytes: `0x${string}` = `0x${Buffer.from(JSON.stringify(opts.input)).toString("hex")}`;

  const txHash = await walletClient.writeContract({
    chain,
    account,
    address: contractAddress,
    abi: SWATI_RUN_TRIGGER_ABI,
    functionName: "requestRun",
    args: [opts.choreoId, inputBytes],
  });

  const runKey = keccak256(txHash) as `0x${string}`;

  return { txHash, runKey };
}

export async function reportResult(opts: ReportResultOptions): Promise<{ txHash: Hash }> {
  const { chain, walletClient, account } = buildWalletClient(
    opts.walletPrivateKey,
    opts.network ?? "sepolia",
    opts.rpcUrl,
  );

  const contractAddress = resolveAddress(opts.contractAddress, opts.network ?? "sepolia");

  const txHash = await walletClient.writeContract({
    chain,
    account,
    address: contractAddress,
    abi: SWATI_RUN_TRIGGER_ABI,
    functionName: "reportResult",
    args: [opts.runKey, opts.role, opts.success, opts.result],
  });

  return { txHash };
}

function buildWalletClient(privateKey: string, network: "mainnet" | "sepolia", rpcUrl?: string) {
  const chain: Chain = network === "mainnet" ? mainnet : sepolia;
  const defaultRpc = network === "mainnet" ? "https://eth.llamarpc.com" : "https://rpc.sepolia.org";
  const url = rpcUrl ?? process.env["ETH_RPC_URL"] ?? defaultRpc;

  const rawKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(rawKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain, transport: http(url) });

  return { chain, walletClient, account };
}

function resolveAddress(addr: Address | undefined, network: "mainnet" | "sepolia"): Address {
  const resolved = addr ?? TRIGGER_ADDRESSES[network];
  if (!resolved) {
    throw new Error(
      `No SwatiRunTrigger contract address for ${network}. ` +
        `Deploy the contract first and pass contractAddress explicitly.`,
    );
  }
  return resolved;
}

function defaultSerialize(value: unknown, _ok: boolean): `0x${string}` {
  return `0x${Buffer.from(JSON.stringify(value)).toString("hex")}`;
}

export { SWATI_RUN_TRIGGER_ABI, TRIGGER_ADDRESSES } from "./abi.js";
export { deployTrigger } from "./deploy.js";
