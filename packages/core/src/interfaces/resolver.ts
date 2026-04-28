import type { Pubkey, Result } from "../types.js";

export interface ResolvedIdentity {
  name: string;
  pubkey: Pubkey;
  transportId: string;
  caps?: unknown;
}

export interface IdentityResolver {
  resolve(name: string): Promise<Result<ResolvedIdentity>>;
}
