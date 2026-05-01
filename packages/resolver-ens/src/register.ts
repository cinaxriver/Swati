import {
  createPublicClient,
  createWalletClient,
  http,
  type Hash,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { normalize, namehash } from "viem/ens";
import { TEXT_RECORD_KEYS } from "./text-records.js";

const RESOLVER_ABI = [
  {
    name: "setText",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "multicall",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
] as const;

export interface RegisterOptions {
  name: string;
  pubkeyHex: string;
  axlPubkey: string;
  capsUrl?: string;
  choreographies?: string[];
  repUrl?: string;
  walletPrivateKey: string;
  rpcUrl?: string;
  network?: "mainnet" | "sepolia";
}

export interface RegisterResult {
  txHash: Hash;
  recordsSet: string[];
}

export async function registerEnsRecords(
  opts: RegisterOptions,
): Promise<RegisterResult> {
  const network = opts.network ?? "mainnet";
  const chain = network === "mainnet" ? mainnet : sepolia;
  const defaultRpc =
    network === "mainnet"
      ? "https://eth.llamarpc.com"
      : "https://rpc.sepolia.org";
  const rpcUrl = opts.rpcUrl ?? process.env["ETH_RPC_URL"] ?? defaultRpc;

  const normalizedName = normalize(opts.name);
  const node = namehash(normalizedName);

  const rawKey = opts.walletPrivateKey.startsWith("0x")
    ? opts.walletPrivateKey
    : `0x${opts.walletPrivateKey}`;
  const account = privateKeyToAccount(rawKey as `0x${string}`);

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const resolverAddress = await publicClient.getEnsResolver({
    name: normalizedName,
  });
  if (!resolverAddress) {
    throw new Error(
      `No resolver found for "${opts.name}". Make sure the name is registered and has a resolver set.`,
    );
  }

  const records: Record<string, string> = {
    [TEXT_RECORD_KEYS.PUBKEY]: opts.pubkeyHex,
    [TEXT_RECORD_KEYS.AXL_PUBKEY]: opts.axlPubkey,
  };
  if (opts.capsUrl) records[TEXT_RECORD_KEYS.CAPS] = opts.capsUrl;
  if (opts.choreographies && opts.choreographies.length > 0) {
    records[TEXT_RECORD_KEYS.CHOREOGRAPHIES] = opts.choreographies.join(",");
  }
  if (opts.repUrl) records[TEXT_RECORD_KEYS.REP] = opts.repUrl;

  const { encodeFunctionData } = await import("viem");
  const calldata = Object.entries(records).map(([key, value]) =>
    encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [node, key, value],
    }),
  );

  const txHash = await walletClient.writeContract({
    address: resolverAddress as Address,
    abi: RESOLVER_ABI,
    functionName: "multicall",
    args: [calldata],
  });

  return { txHash, recordsSet: Object.keys(records) };
}

export interface LookupResult {
  name: string;
  records: Partial<Record<string, string>>;
  resolverAddress: string | null;
}

export async function lookupEnsRecords(
  name: string,
  opts: { rpcUrl?: string; network?: "mainnet" | "sepolia" } = {},
): Promise<LookupResult> {
  const network = opts.network ?? "mainnet";
  const chain = network === "mainnet" ? mainnet : sepolia;
  const defaultRpc =
    network === "mainnet"
      ? "https://eth.llamarpc.com"
      : "https://rpc.sepolia.org";
  const rpcUrl = opts.rpcUrl ?? process.env["ETH_RPC_URL"] ?? defaultRpc;

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const normalizedName = normalize(name);

  const resolverAddress = await publicClient
    .getEnsResolver({ name: normalizedName })
    .catch(() => null);

  const keys = Object.values(TEXT_RECORD_KEYS);
  const values = await Promise.all(
    keys.map((key) =>
      publicClient.getEnsText({ name: normalizedName, key }).catch(() => null),
    ),
  );

  const records: Partial<Record<string, string>> = {};
  keys.forEach((key, i) => {
    const v = values[i];
    if (v) records[key] = v;
  });

  return { name, records, resolverAddress: resolverAddress ?? null };
}
