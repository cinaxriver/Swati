import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalBytes } from "./canonical.js";
import { sign, verify, pubkeyToHex, hexToPubkey } from "./identity.js";
import type {
  Act,
  ActId,
  ActKind,
  ChoreoId,
  Identity,
  Pubkey,
  RoleName,
} from "./types.js";
import { ok, err } from "./types.js";
import type { Result } from "./types.js";

interface ActRecord {
  id: ActId;
  choreoId: ChoreoId;
  prevId: ActId | null;
  role: RoleName;
  author: string;
  timestamp: number;
  kind: ActKind;
  payload: unknown;
  signature: string;
}

function toRecord(act: Act): ActRecord {
  return {
    ...act,
    author: pubkeyToHex(act.author),
    signature: pubkeyToHex(act.signature),
  };
}

function fromRecord(r: ActRecord): Act {
  return {
    ...r,
    author: hexToPubkey(r.author),
    signature: hexToPubkey(r.signature),
  };
}

export class AppendLog {
  private readonly filePath: string;
  private headId: Map<RoleName, ActId> = new Map();
  private entries: Act[] = [];
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.filePath)) return;
    const lines = readFileSync(this.filePath, "utf-8")
      .split("\n")
      .filter(Boolean);
    for (const line of lines) {
      const record = JSON.parse(line) as ActRecord;
      const act = fromRecord(record);
      this.entries.push(act);
      this.headId.set(act.role, act.id);
    }
  }

  prevId(role: RoleName): ActId | null {
    this.load();
    return this.headId.get(role) ?? null;
  }

  all(): Act[] {
    this.load();
    return [...this.entries];
  }

  async append(
    identity: Identity,
    kind: ActKind,
    role: RoleName,
    choreoId: ChoreoId,
    payload: unknown,
  ): Promise<Result<Act>> {
    this.load();

    const prev = this.headId.get(role) ?? null;
    const actBody = {
      choreoId,
      prevId: prev,
      role,
      author: pubkeyToHex(identity.pubkey),
      timestamp: Date.now(),
      kind,
      payload,
    };
    const bodyBytes = canonicalBytes(actBody);
    const hashBytes = sha256(bodyBytes);
    const id = Array.from(hashBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const signature = await sign(identity.privateKey, actBody);

    const act: Act = {
      id,
      ...actBody,
      author: identity.pubkey,
      signature,
    };

    const record = toRecord(act);
    try {
      appendFileSync(this.filePath, JSON.stringify(record) + "\n", "utf-8");
    } catch (cause) {
      return err("LOG_WRITE_FAILED", "Failed to append act to log", cause);
    }

    this.entries.push(act);
    this.headId.set(role, id);
    return ok(act);
  }

  async appendExternal(
    act: Act,
    expectedPubkey: Pubkey,
  ): Promise<Result<void>> {
    this.load();

    const actBody = {
      choreoId: act.choreoId,
      prevId: act.prevId,
      role: act.role,
      author: pubkeyToHex(act.author),
      timestamp: act.timestamp,
      kind: act.kind,
      payload: act.payload,
    };

    const valid = await verify(expectedPubkey, act.signature, actBody);
    if (!valid) {
      return err(
        "BAD_SIGNATURE",
        `Signature verification failed for act ${act.id} from role ${act.role}`,
      );
    }

    const record = toRecord(act);
    try {
      appendFileSync(this.filePath, JSON.stringify(record) + "\n", "utf-8");
    } catch (cause) {
      return err("LOG_WRITE_FAILED", "Failed to append external act", cause);
    }
    this.entries.push(act);
    this.headId.set(act.role, act.id);
    return ok(undefined);
  }

  toJsonl(): string {
    this.load();
    return this.entries.map((a) => JSON.stringify(toRecord(a))).join("\n");
  }

  async verifyChain(): Promise<Result<void>> {
    this.load();
    for (const act of this.entries) {
      const actBody = {
        choreoId: act.choreoId,
        prevId: act.prevId,
        role: act.role,
        author: pubkeyToHex(act.author),
        timestamp: act.timestamp,
        kind: act.kind,
        payload: act.payload,
      };
      const valid = await verify(act.author, act.signature, actBody);
      if (!valid) {
        return err("CHAIN_TAMPERED", `Signature invalid for act ${act.id}`);
      }
    }
    return ok(undefined);
  }
}
