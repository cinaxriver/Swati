import { createWalletClient, http, type Address, type Hash, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { SWATI_RUN_TRIGGER_ABI } from "./abi.js";

const BYTECODE = "0x" as `0x${string}`;

export interface DeployOptions {
  walletPrivateKey: string;
  network?: "mainnet" | "sepolia";
  rpcUrl?: string;
}

export interface DeployResult {
  txHash: Hash;
  address: Address;
}

export async function deployTrigger(opts: DeployOptions): Promise<DeployResult> {
  const network = opts.network ?? "sepolia";
  const chain: Chain = network === "mainnet" ? mainnet : sepolia;
  const defaultRpc = network === "mainnet" ? "https://eth.llamarpc.com" : "https://rpc.sepolia.org";
  const rpcUrl = opts.rpcUrl ?? process.env["ETH_RPC_URL"] ?? defaultRpc;

  const rawKey = opts.walletPrivateKey.startsWith("0x")
    ? opts.walletPrivateKey
    : `0x${opts.walletPrivateKey}`;
  const account = privateKeyToAccount(rawKey as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const txHash = await walletClient.deployContract({
    chain,
    account,
    abi: SWATI_RUN_TRIGGER_ABI,
    bytecode: BYTECODE,
  });

  return { txHash, address: "0x0000000000000000000000000000000000000000" };
}
