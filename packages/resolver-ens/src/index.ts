import { createPublicClient, http } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import type { IdentityResolver, ResolvedIdentity } from "@swati/core/interfaces";
import type { Result } from "@swati/core";
import { ok, err } from "@swati/core";
import { hexToPubkey } from "@swati/core";
import { TEXT_RECORD_KEYS, parseEnsRecords, canJoinChoreography } from "./text-records.js";
import type { TextRecordKey } from "./text-records.js";

export interface EnsResolverConfig {
  rpcUrl?: string;

  network?: "mainnet" | "sepolia";

  allowedChoreoId?: string;

  cacheTtlMs?: number;
}

interface CacheEntry {
  result: Result<ResolvedIdentity>;
  expiresAt: number;
}

export class EnsResolver implements IdentityResolver {
  private readonly client: ReturnType<typeof createPublicClient>;
  private readonly allowedChoreoId?: string;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(cfg: EnsResolverConfig = {}) {
    const network = cfg.network ?? "mainnet";
    const defaultRpc =
      network === "mainnet" ? "https://eth.llamarpc.com" : "https://rpc.sepolia.org";
    const rpcUrl = cfg.rpcUrl ?? process.env["ETH_RPC_URL"] ?? defaultRpc;

    this.client = createPublicClient({
      chain: network === "mainnet" ? mainnet : sepolia,
      transport: http(rpcUrl),
    });
    this.cacheTtlMs = cfg.cacheTtlMs ?? 300_000;
    if (cfg.allowedChoreoId !== undefined) {
      this.allowedChoreoId = cfg.allowedChoreoId;
    }
  }

  async resolve(name: string): Promise<Result<ResolvedIdentity>> {
    if (this.cacheTtlMs > 0) {
      const hit = this.cache.get(name);
      if (hit && Date.now() < hit.expiresAt) return hit.result;
    }

    const result = await this.fetchFromEns(name);

    if (this.cacheTtlMs > 0) {
      this.cache.set(name, { result, expiresAt: Date.now() + this.cacheTtlMs });
    }
    return result;
  }

  invalidate(name: string): void {
    this.cache.delete(name);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private async fetchFromEns(name: string): Promise<Result<ResolvedIdentity>> {
    try {
      const normalizedName = normalize(name);

      const keys = Object.values(TEXT_RECORD_KEYS) as TextRecordKey[];
      const values = await Promise.all(
        keys.map((key) => this.client.getEnsText({ name: normalizedName, key }).catch(() => null)),
      );

      const recordMap: Partial<Record<TextRecordKey, string>> = {};
      keys.forEach((key, i) => {
        const v = values[i];
        if (v) recordMap[key] = v;
      });

      const parsed = parseEnsRecords(recordMap);
      if (!parsed) {
        return err(
          "ENS_MISSING_RECORDS",
          `ENS name "${name}" is missing required swati records.\n` +
            `Run: swati ens register ${name} --pubkey <hex> --axl-pubkey <base64>`,
        );
      }

      if (this.allowedChoreoId && !canJoinChoreography(parsed, this.allowedChoreoId)) {
        return err(
          "ENS_CHOREOGRAPHY_NOT_ALLOWED",
          `ENS name "${name}" is not authorized for choreography "${this.allowedChoreoId}".\n` +
            `Run: swati ens register ${name} --add-choreo ${this.allowedChoreoId}`,
        );
      }

      const pubkey = hexToPubkey(parsed.pubkeyHex);

      return ok({
        name,
        pubkey,
        transportId: parsed.axlPubkey,
        caps: parsed.caps,
      });
    } catch (cause) {
      return err("ENS_RESOLVE_FAILED", `Failed to resolve ENS name "${name}"`, cause);
    }
  }
}

export { parseEnsRecords, canJoinChoreography, TEXT_RECORD_KEYS };
export type { SwatiEnsRecord, TextRecordKey } from "./text-records.js";
