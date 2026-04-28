import type { ChoreoId, Manifest, Result, RoleName } from "../types.js";

export interface Storage {
  putManifest(
    manifest: Manifest,
  ): Promise<Result<{ uri: string; hash: string }>>;
  getManifest(uri: string): Promise<Result<Manifest>>;
  putLogSnapshot(
    choreoId: ChoreoId,
    role: RoleName,
    jsonl: string,
  ): Promise<Result<{ uri: string }>>;
  getLogSnapshot(uri: string): Promise<Result<string>>;
}
