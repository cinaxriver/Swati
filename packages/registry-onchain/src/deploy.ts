import { createWalletClient, createPublicClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet } from "viem/chains";

const BYTECODE = "0x" as `0x${string}`;

export async function deployRegistry(opts: {
  network: "mainnet" | "sepolia";
  walletPrivateKey: string;
  rpcUrl?: string;
}): Promise<{ address: Address; txHash: `0x${string}` }> {
  const chain = opts.network === "mainnet" ? mainnet : sepolia;
  const defaultRpc =
    opts.network === "mainnet" ? "https://eth.llamarpc.com" : "https://rpc.sepolia.org";
  const rpcUrl = opts.rpcUrl ?? process.env["ETH_RPC_URL"] ?? defaultRpc;

  const rawKey = opts.walletPrivateKey.startsWith("0x")
    ? opts.walletPrivateKey
    : `0x${opts.walletPrivateKey}`;
  const account = privateKeyToAccount(rawKey as `0x${string}`);

  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const txHash = await walletClient.deployContract({
    abi: [],
    bytecode: BYTECODE,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (!receipt.contractAddress) {
    throw new Error(`Deployment tx ${txHash} confirmed but contractAddress is null`);
  }

  return { address: receipt.contractAddress, txHash };
}
