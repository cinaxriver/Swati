import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "@noble/hashes/sha256";
import type { Storage } from "../interfaces/storage.js";
import type { ChoreoId, Manifest, Result, RoleName } from "../types.js";
import { ok, err } from "../types.js";

export class LocalFileStorage implements Storage {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath.replace(/^~/, process.env["HOME"] ?? "~");
    mkdirSync(join(this.basePath, "manifests"), { recursive: true });
    mkdirSync(join(this.basePath, "logs"), { recursive: true });
  }

  async putManifest(
    manifest: Manifest,
  ): Promise<Result<{ uri: string; hash: string }>> {
    try {
      const json = JSON.stringify(manifest, null, 2);
      const hashBytes = sha256(new TextEncoder().encode(json));
      const hash = toHex(hashBytes);
      const fileName = `${manifest.name}-${hash.slice(0, 16)}.json`;
      const filePath = join(this.basePath, "manifests", fileName);
      writeFileSync(filePath, json, "utf-8");
      return ok({ uri: `file://${filePath}`, hash });
    } catch (cause) {
      return err("STORAGE_WRITE_FAILED", "Failed to write manifest", cause);
    }
  }

  async getManifest(uri: string): Promise<Result<Manifest>> {
    try {
      const filePath = uri.replace(/^file:\/\//, "");
      if (!existsSync(filePath)) {
        return err("STORAGE_NOT_FOUND", `Manifest not found: ${uri}`);
      }
      const raw = readFileSync(filePath, "utf-8");
      return ok(JSON.parse(raw) as Manifest);
    } catch (cause) {
      return err("STORAGE_READ_FAILED", "Failed to read manifest", cause);
    }
  }

  async putLogSnapshot(
    choreoId: ChoreoId,
    role: RoleName,
    jsonl: string,
  ): Promise<Result<{ uri: string }>> {
    try {
      const fileName = `${choreoId}-${role}-${Date.now()}.jsonl`;
      const filePath = join(this.basePath, "logs", fileName);
      writeFileSync(filePath, jsonl, "utf-8");
      return ok({ uri: `file://${filePath}` });
    } catch (cause) {
      return err("STORAGE_WRITE_FAILED", "Failed to write log snapshot", cause);
    }
  }

  async getLogSnapshot(uri: string): Promise<Result<string>> {
    try {
      const filePath = uri.replace(/^file:\/\//, "");
      if (!existsSync(filePath)) {
        return err("STORAGE_NOT_FOUND", `Log snapshot not found: ${uri}`);
      }
      return ok(readFileSync(filePath, "utf-8"));
    } catch (cause) {
      return err("STORAGE_READ_FAILED", "Failed to read log snapshot", cause);
    }
  }
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
