import { readFileSync } from "node:fs";
import type { IdentityResolver, ResolvedIdentity } from "../interfaces/resolver.js";
import type { Pubkey, Result } from "../types.js";
import { ok, err } from "../types.js";

interface StaticEntry {
  pubkey: string;
  transportId: string;
  caps?: unknown;
}

export class StaticResolver implements IdentityResolver {
  private readonly map: Map<string, StaticEntry>;

  constructor(source: string | Record<string, StaticEntry>) {
    if (typeof source === "string") {
      const raw = JSON.parse(readFileSync(source, "utf-8")) as Record<string, StaticEntry>;
      this.map = new Map(Object.entries(raw));
    } else {
      this.map = new Map(Object.entries(source));
    }
  }

  async resolve(name: string): Promise<Result<ResolvedIdentity>> {
    const entry = this.map.get(name);
    if (!entry) {
      return err("RESOLVE_NOT_FOUND", `No identity registered for role "${name}"`);
    }
    const pubkey: Pubkey = hexToBytes(entry.pubkey);
    return ok({
      name,
      pubkey,
      transportId: entry.transportId,
      caps: entry.caps,
    });
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
