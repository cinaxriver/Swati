import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Hash,
  type Address,
  type Chain,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { SWATI_REGISTRY_ABI, REGISTRY_ADDRESSES } from "./abi.js";
import { manifestIdToBytes32, pubkeyToHash } from "./choreo-id.js";
import type { Manifest } from "@swati/core";

export interface RegistryConfig {
  network?: "mainnet" | "sepolia";
  rpcUrl?: string;

  walletPrivateKey?: string;

  contractAddress?: `0x${string}`;
}

export interface RegisterChoreographyResult {
  txHash: Hash;
  choreoId: `0x${string}`;
}

export interface RegisterRoleResult {
  txHash: Hash;
}

export interface ChoreographyInfo {
  choreoId: `0x${string}`;
  name: string;
  manifestHash: `0x${string}`;
  sourceUri: string;
  manifestUri: string;
  publisher: Address;
  registeredAt: Date;
  roles: string[];
}

export interface RoleInfo {
  pubkeyHash: `0x${string}`;
  ensName: string;
  axlPeerId: string;
  registeredAt: Date;
}

export interface LogAnchorResult {
  txHash: Hash;
}

export interface LogAnchorInfo {
  logRootHash: `0x${string}`;
  logUri: string;
  anchoredBy: Address;
  anchoredAt: Date;
}

export class OnchainRegistry {
  private readonly publicClient: ReturnType<typeof createPublicClient>;
  private readonly walletClient: ReturnType<typeof createWalletClient> | null;
  private readonly account: Account | null;
  private readonly contractAddress: Address;
  private readonly network: "mainnet" | "sepolia";
  private readonly chain: Chain;

  constructor(cfg: RegistryConfig = {}) {
    this.network = cfg.network ?? "mainnet";
    const chain = this.network === "mainnet" ? mainnet : sepolia;
    this.chain = chain;
    const defaultRpc =
      this.network === "mainnet" ? "https://eth.llamarpc.com" : "https://rpc.sepolia.org";
    const rpcUrl = cfg.rpcUrl ?? process.env["ETH_RPC_URL"] ?? defaultRpc;

    this.contractAddress =
      cfg.contractAddress ??
      REGISTRY_ADDRESSES[this.network] ??
      "0x0000000000000000000000000000000000000000";

    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

    if (cfg.walletPrivateKey) {
      const rawKey = cfg.walletPrivateKey.startsWith("0x")
        ? cfg.walletPrivateKey
        : `0x${cfg.walletPrivateKey}`;
      this.account = privateKeyToAccount(rawKey as `0x${string}`);
      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(rpcUrl),
      });
    } else {
      this.account = null;
      this.walletClient = null;
    }
  }

  async registerChoreography(
    manifest: Manifest,
    opts: { sourceUri?: string; manifestUri?: string } = {},
  ): Promise<RegisterChoreographyResult> {
    this.requireWallet();

    const choreoId = manifestIdToBytes32(manifest.id);
    const txHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account!,
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "registerChoreography",
      args: [
        choreoId,
        manifest.name,
        [...manifest.roles],
        opts.sourceUri ?? manifest.sourceUri ?? "",
        opts.manifestUri ?? manifest.storageUri ?? "",
      ],
    });

    return { txHash, choreoId };
  }

  async registerRole(
    choreoId: `0x${string}`,
    role: string,
    pubkeyHex: string,
    opts: { ensName?: string; axlPeerId?: string } = {},
  ): Promise<RegisterRoleResult> {
    this.requireWallet();

    const txHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account!,
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "registerRole",
      args: [choreoId, role, pubkeyToHash(pubkeyHex), opts.ensName ?? "", opts.axlPeerId ?? ""],
    });

    return { txHash };
  }

  async linkInvoke(parentManifestId: string, childManifestId: string): Promise<{ txHash: Hash }> {
    this.requireWallet();

    const parentId = manifestIdToBytes32(parentManifestId);
    const childId = manifestIdToBytes32(childManifestId);

    const txHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account!,
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "linkInvoke",
      args: [parentId, childId],
    });

    return { txHash };
  }

  async anchorLog(manifestId: string, logJsonl: string, logUri: string): Promise<LogAnchorResult> {
    this.requireWallet();

    const choreoId = manifestIdToBytes32(manifestId);
    const logRootHash = keccak256(toHex(logJsonl));

    const txHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account!,
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "anchorLog",
      args: [choreoId, logRootHash, logUri],
    });

    return { txHash };
  }

  async getChoreography(manifestIdOrBytes32: string): Promise<ChoreographyInfo | null> {
    const choreoId = manifestIdOrBytes32.startsWith("swati:")
      ? manifestIdToBytes32(manifestIdOrBytes32)
      : (manifestIdOrBytes32 as `0x${string}`);

    const [name, manifestHash, sourceUri, manifestUri, publisher, registeredAt, , exists] =
      (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: SWATI_REGISTRY_ABI,
        functionName: "choreographies",
        args: [choreoId],
      })) as [string, `0x${string}`, string, string, Address, bigint, number, boolean];

    if (!exists) return null;

    const roles = (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "getChoreoRoles",
      args: [choreoId],
    })) as string[];

    return {
      choreoId,
      name,
      manifestHash,
      sourceUri,
      manifestUri,
      publisher,
      registeredAt: new Date(Number(registeredAt) * 1000),
      roles,
    };
  }

  async getRole(manifestIdOrBytes32: string, role: string): Promise<RoleInfo | null> {
    const choreoId = manifestIdOrBytes32.startsWith("swati:")
      ? manifestIdToBytes32(manifestIdOrBytes32)
      : (manifestIdOrBytes32 as `0x${string}`);

    const [pubkeyHash, ensName, axlPeerId, registeredAt, exists] =
      (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: SWATI_REGISTRY_ABI,
        functionName: "roleIdentities",
        args: [choreoId, role],
      })) as [`0x${string}`, string, string, bigint, boolean];

    if (!exists) return null;

    return {
      pubkeyHash,
      ensName,
      axlPeerId,
      registeredAt: new Date(Number(registeredAt) * 1000),
    };
  }

  async verifyRole(manifestIdOrBytes32: string, role: string, pubkeyHex: string): Promise<boolean> {
    const choreoId = manifestIdOrBytes32.startsWith("swati:")
      ? manifestIdToBytes32(manifestIdOrBytes32)
      : (manifestIdOrBytes32 as `0x${string}`);

    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "verifyRole",
      args: [choreoId, role, pubkeyToHash(pubkeyHex)],
    }) as Promise<boolean>;
  }

  async canInvoke(parentManifestId: string, childManifestId: string): Promise<boolean> {
    const parentId = manifestIdToBytes32(parentManifestId);
    const childId = manifestIdToBytes32(childManifestId);

    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "canInvoke",
      args: [parentId, childId],
    }) as Promise<boolean>;
  }

  async getPublisherChoreos(publisherAddress: Address): Promise<`0x${string}`[]> {
    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "getPublisherChoreos",
      args: [publisherAddress],
    }) as Promise<`0x${string}`[]>;
  }

  async getLogAnchors(manifestIdOrBytes32: string): Promise<LogAnchorInfo[]> {
    const choreoId = manifestIdOrBytes32.startsWith("swati:")
      ? manifestIdToBytes32(manifestIdOrBytes32)
      : (manifestIdOrBytes32 as `0x${string}`);

    const anchors = (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "getLogAnchors",
      args: [choreoId],
    })) as Array<{
      logRootHash: `0x${string}`;
      logUri: string;
      anchoredBy: Address;
      anchoredAt: bigint;
    }>;

    return anchors.map((a) => ({
      logRootHash: a.logRootHash,
      logUri: a.logUri,
      anchoredBy: a.anchoredBy,
      anchoredAt: new Date(Number(a.anchoredAt) * 1000),
    }));
  }

  private requireWallet(): void {
    if (!this.walletClient) {
      throw new Error("Write operation requires a walletPrivateKey in RegistryConfig.");
    }
  }
}

export { manifestIdToBytes32, bytes32ToHex, pubkeyToHash, verifyPubkeyHash } from "./choreo-id.js";
export { SWATI_REGISTRY_ABI, REGISTRY_ADDRESSES } from "./abi.js";
