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
import { defineChain } from "viem";
import { SWATI_REGISTRY_ABI, REGISTRY_ADDRESSES } from "./abi.js";
import { manifestIdToBytes32, pubkeyToHash } from "./choreo-id.js";
import type { Manifest } from "@swati/core";

export const zeroGTestnet = defineChain({
  id: 16602,
  name: "0G Newton Testnet",
  nativeCurrency: { name: "0G", symbol: "A0GI", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
});

export interface RegistryConfig {
  network?: "mainnet" | "sepolia" | number;
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

  pubkeyHex: string;

  ensName: string;

  identityLocator?: string;
  axlPeerId: string;
  claimedBy: Address;
  registeredAt: Date;
}

export interface ClaimRoleResult {
  txHash: Hash;
}

export interface GrantRoleResult {
  txHash: Hash;
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

export interface RegisterRoleFromTopologyOptions extends RegistryConfig {
  choreoId: string;
  role: string;
  pubkeyHex: string;
  axlEndpoint: string;
  ensName?: string;
  identityLocator?: string;
}

export interface RegisterRoleFromTopologyResult extends RegisterRoleResult {
  choreoId: `0x${string}`;
  axlPeerId: string;
}

export interface ClaimRoleFromTopologyOptions extends RegistryConfig {
  choreoId: string;
  role: string;

  pubkeyHex: string;

  axlEndpoint: string;
}

export interface ClaimRoleFromTopologyResult {
  txHash: Hash;
  choreoId: `0x${string}`;
  axlPeerId: string;
}

export class OnchainRegistry {
  private readonly publicClient: ReturnType<typeof createPublicClient>;
  private readonly walletClient: ReturnType<typeof createWalletClient> | null;
  private readonly account: Account | null;
  private readonly contractAddress: Address;
  private readonly network: "mainnet" | "sepolia" | number;
  private readonly chain: Chain;

  constructor(cfg: RegistryConfig = {}) {
    this.network = cfg.network ?? "mainnet";

    if (this.network === "mainnet") {
      this.chain = mainnet;
    } else if (this.network === "sepolia") {
      this.chain = sepolia;
    } else if (this.network === 16602) {
      this.chain = zeroGTestnet;
    } else {
      this.chain = defineChain({
        id: this.network as number,
        name: `Chain-${this.network}`,
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [cfg.rpcUrl ?? ""] } },
      });
    }

    const defaultRpc =
      this.network === "mainnet"
        ? "https://eth.llamarpc.com"
        : this.network === "sepolia"
          ? "https://rpc.sepolia.org"
          : this.network === 16602
            ? "https://evmrpc-testnet.0g.ai"
            : "";
    const rpcUrl = cfg.rpcUrl ?? process.env["ETH_RPC_URL"] ?? defaultRpc;

    const networkKey = typeof this.network === "string" ? this.network : "sepolia";
    this.contractAddress =
      cfg.contractAddress ??
      REGISTRY_ADDRESSES[networkKey] ??
      "0x0000000000000000000000000000000000000000";

    this.publicClient = createPublicClient({ chain: this.chain, transport: http(rpcUrl) });

    if (cfg.walletPrivateKey) {
      const rawKey = cfg.walletPrivateKey.startsWith("0x")
        ? cfg.walletPrivateKey
        : `0x${cfg.walletPrivateKey}`;
      this.account = privateKeyToAccount(rawKey as `0x${string}`);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: this.chain,
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
    opts: { ensName?: string; identityLocator?: string; axlPeerId?: string } = {},
  ): Promise<RegisterRoleResult> {
    this.requireWallet();
    const identityLocator = opts.identityLocator ?? opts.ensName ?? "";

    const txHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account!,
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "registerRole",
      args: [choreoId, role, pubkeyToHash(pubkeyHex), identityLocator, opts.axlPeerId ?? ""],
    });

    return { txHash };
  }

  async setOpenRegistration(choreoId: `0x${string}`, open: boolean): Promise<{ txHash: Hash }> {
    this.requireWallet();
    const txHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account!,
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "setOpenRegistration",
      args: [choreoId, open],
    });
    return { txHash };
  }

  async grantRole(
    choreoId: `0x${string}`,
    role: string,
    granteeAddress: `0x${string}`,
  ): Promise<GrantRoleResult> {
    this.requireWallet();
    const txHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account!,
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "grantRole",
      args: [choreoId, role, granteeAddress],
    });
    return { txHash };
  }

  async claimRole(
    choreoId: `0x${string}`,
    role: string,
    pubkeyHex: string,
    axlPeerId: string,
  ): Promise<ClaimRoleResult> {
    this.requireWallet();
    const txHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account!,
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "claimRole",
      args: [choreoId, role, pubkeyHex, axlPeerId],
    });
    return { txHash };
  }

  async updateAxlPeerId(
    choreoId: `0x${string}`,
    role: string,
    newAxlPeerId: string,
  ): Promise<{ txHash: Hash }> {
    this.requireWallet();
    const txHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account!,
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "updateAxlPeerId",
      args: [choreoId, role, newAxlPeerId],
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

    const [pubkeyHash, pubkeyHex, ensName, axlPeerId, claimedBy, registeredAt, exists] =
      (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: SWATI_REGISTRY_ABI,
        functionName: "roleIdentities",
        args: [choreoId, role],
      })) as [`0x${string}`, string, string, string, Address, bigint, boolean];

    if (!exists) return null;

    const info: RoleInfo = {
      pubkeyHash,
      pubkeyHex,
      ensName,
      axlPeerId,
      claimedBy,
      registeredAt: new Date(Number(registeredAt) * 1000),
    };
    if (ensName) info.identityLocator = ensName;
    return info;
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

  async isGranted(manifestIdOrBytes32: string, role: string, address: Address): Promise<boolean> {
    const choreoId = manifestIdOrBytes32.startsWith("swati:")
      ? manifestIdToBytes32(manifestIdOrBytes32)
      : (manifestIdOrBytes32 as `0x${string}`);

    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "roleGrants",
      args: [choreoId, role, address],
    }) as Promise<boolean>;
  }

  async isOpenRegistration(manifestIdOrBytes32: string): Promise<boolean> {
    const choreoId = manifestIdOrBytes32.startsWith("swati:")
      ? manifestIdToBytes32(manifestIdOrBytes32)
      : (manifestIdOrBytes32 as `0x${string}`);

    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: SWATI_REGISTRY_ABI,
      functionName: "openRegistration",
      args: [choreoId],
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

function normalizeChoreoId(choreoId: string): `0x${string}` {
  if (choreoId.startsWith("swati:")) return manifestIdToBytes32(choreoId);
  return choreoId as `0x${string}`;
}

function normalizeAxlPeerId(value: string): string {
  const v = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(v)) {
    throw new Error(`Invalid AXL peer key "${value}" (expected 64-char hex topology key)`);
  }
  return v;
}

export async function getAxlPeerIdFromTopology(endpoint: string): Promise<string> {
  const url = new URL("/topology", endpoint);
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Topology request failed at ${url.toString()} with HTTP ${res.status}`);
  }
  const payload = (await res.json()) as { our_public_key?: unknown };
  if (typeof payload.our_public_key !== "string") {
    throw new Error(`Topology response at ${url.toString()} has no string "our_public_key"`);
  }
  return normalizeAxlPeerId(payload.our_public_key);
}

export async function registerRoleFromTopology(
  opts: RegisterRoleFromTopologyOptions,
): Promise<RegisterRoleFromTopologyResult> {
  const choreoId = normalizeChoreoId(opts.choreoId);
  const axlPeerId = await getAxlPeerIdFromTopology(opts.axlEndpoint);

  const registry = new OnchainRegistry({
    ...(opts.network ? { network: opts.network } : {}),
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    ...(opts.walletPrivateKey ? { walletPrivateKey: opts.walletPrivateKey } : {}),
    ...(opts.contractAddress ? { contractAddress: opts.contractAddress } : {}),
  });

  const { txHash } = await registry.registerRole(choreoId, opts.role, opts.pubkeyHex, {
    ...(opts.ensName ? { ensName: opts.ensName } : {}),
    ...(opts.identityLocator ? { identityLocator: opts.identityLocator } : {}),
    axlPeerId,
  });

  return { txHash, choreoId, axlPeerId };
}

export async function claimRoleFromTopology(
  opts: ClaimRoleFromTopologyOptions,
): Promise<ClaimRoleFromTopologyResult> {
  const choreoId = normalizeChoreoId(opts.choreoId);
  const axlPeerId = await getAxlPeerIdFromTopology(opts.axlEndpoint);

  const registry = new OnchainRegistry({
    ...(opts.network ? { network: opts.network } : {}),
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    ...(opts.walletPrivateKey ? { walletPrivateKey: opts.walletPrivateKey } : {}),
    ...(opts.contractAddress ? { contractAddress: opts.contractAddress } : {}),
  });

  const { txHash } = await registry.claimRole(choreoId, opts.role, opts.pubkeyHex, axlPeerId);
  return { txHash, choreoId, axlPeerId };
}
