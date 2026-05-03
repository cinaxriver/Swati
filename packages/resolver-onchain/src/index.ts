import type { IdentityResolver, ResolvedIdentity } from "@swati/core/interfaces";
import type { Result } from "@swati/core";
import { ok, err } from "@swati/core";
import { hexToPubkey } from "@swati/core";
import type { OnchainRegistry, RoleInfo } from "@swati/registry-onchain";

export interface OnChainRegistryResolverConfig {
  choreoId: string;

  registry: OnchainRegistry;

  cacheTtlMs?: number;
}

interface CacheEntry {
  result: Result<ResolvedIdentity>;
  expiresAt: number;
}

export class OnChainRegistryResolver implements IdentityResolver {
  private readonly choreoId: string;
  private readonly registry: OnchainRegistry;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(cfg: OnChainRegistryResolverConfig) {
    this.choreoId = cfg.choreoId;
    this.registry = cfg.registry;
    this.cacheTtlMs = cfg.cacheTtlMs ?? 60_000;
  }

  async resolve(role: string): Promise<Result<ResolvedIdentity>> {
    if (this.cacheTtlMs > 0) {
      const hit = this.cache.get(role);
      if (hit && Date.now() < hit.expiresAt) return hit.result;
    }

    const result = await this.fetchRole(role);

    if (this.cacheTtlMs > 0) {
      this.cache.set(role, { result, expiresAt: Date.now() + this.cacheTtlMs });
    }
    return result;
  }

  invalidate(role: string): void {
    this.cache.delete(role);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private async fetchRole(role: string): Promise<Result<ResolvedIdentity>> {
    let info: RoleInfo | null;
    try {
      info = await this.registry.getRole(this.choreoId, role);
    } catch (cause) {
      return err(
        "ONCHAIN_RESOLVE_FAILED",
        `Failed to read role "${role}" from on-chain registry (choreoId: ${this.choreoId})`,
        cause,
      );
    }

    if (!info) {
      return err(
        "ROLE_NOT_REGISTERED",
        `Role "${role}" is not registered in on-chain registry for choreoId ${this.choreoId}.\n` +
          `Run: swati join-role ${this.choreoId} --role ${role} --identity-file ~/.swati/<id>.json`,
      );
    }

    if (!info.pubkeyHex || info.pubkeyHex.length < 64) {
      return err(
        "ROLE_PUBKEY_NOT_AVAILABLE",
        `Role "${role}" has no full pubkeyHex stored on-chain (was registered via registerRole, not claimRole).\n` +
          `The participant must call: swati join-role ${this.choreoId} --role ${role} --identity-file ~/.swati/<id>.json`,
      );
    }

    if (!info.axlPeerId) {
      return err(
        "ROLE_AXL_PEER_ID_MISSING",
        `Role "${role}" has no axlPeerId stored on-chain.\n` +
          `The participant must call: swati join-role ${this.choreoId} --role ${role} --axl-endpoint <url>`,
      );
    }

    let pubkey: ReturnType<typeof hexToPubkey>;
    try {
      pubkey = hexToPubkey(info.pubkeyHex);
    } catch (cause) {
      return err(
        "ROLE_PUBKEY_INVALID",
        `On-chain pubkeyHex for role "${role}" is invalid: ${info.pubkeyHex}`,
        cause,
      );
    }

    return ok({
      name: role,
      pubkey,
      transportId: info.axlPeerId,
    });
  }
}
