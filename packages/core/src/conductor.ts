import { AppendLog } from "./log.js";
import { contextFactory } from "./dsl.js";
import { sign, verify, pubkeyToHex, hexToPubkey } from "./identity.js";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChoreographyDef, ChoreoContext, RoleHandle } from "./dsl.js";
import type { GateProvider } from "./interfaces/gate.js";
import type { IdentityResolver } from "./interfaces/resolver.js";
import type { LLMClient } from "./interfaces/llm.js";
import type { Storage } from "./interfaces/storage.js";
import type { Transport } from "./interfaces/transport.js";
import type { Identity, Result, RoleName } from "./types.js";
import { ok, err } from "./types.js";

const PING_INTERVAL_MS = 5_000;
const PEER_TIMEOUT_MS = 30_000;
const ATTEST_RETRY_MS = 5_000;
const ATTEST_MAX_WAIT_MS = 5 * 60_000;
const LOG_SNAPSHOT_EVERY_N_ACTS = 20;

export interface ConductorConfig {
  choreography: ChoreographyDef;
  choreoId?: string;
  role: RoleName;
  identity: Identity;
  transport: Transport;
  resolver: IdentityResolver;
  storage: Storage;
  gateProviders: Record<string, GateProvider>;
  llm: LLMClient;
  logPath?: string;
  peerTimeoutMs?: number;
  attestMaxWaitMs?: number;
  attestRetryMs?: number;
}

interface PendingOp {
  type: "send" | "choose";
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class Conductor {
  private readonly cfg: ConductorConfig;
  private readonly choreoId: string;
  private readonly log: AppendLog;
  private readonly pendingOps: Map<string, PendingOp> = new Map();

  private readonly earlyMessages: Map<string, unknown> = new Map();
  private readonly sharedState: Map<string, unknown> = new Map();

  private readonly transportIdToRole: Map<string, RoleName> = new Map();
  private readonly lastPeerId: Map<RoleName, number> = new Map();
  private readonly peerTimedOut: Set<RoleName> = new Set();

  private readonly pendingAttests: Map<RoleName, (choreoId: string) => void> =
    new Map();
  private readonly attestBuffer: Map<RoleName, string> = new Map();
  private actCount = 0;
  private readonly peerTimeoutMs: number;
  private readonly attestMaxWaitMs: number;
  private readonly attestRetryMs: number;

  constructor(cfg: ConductorConfig) {
    this.cfg = cfg;
    this.choreoId = cfg.choreoId ?? cfg.choreography.name;
    this.peerTimeoutMs = cfg.peerTimeoutMs ?? PEER_TIMEOUT_MS;
    this.attestMaxWaitMs = cfg.attestMaxWaitMs ?? ATTEST_MAX_WAIT_MS;
    this.attestRetryMs = cfg.attestRetryMs ?? ATTEST_RETRY_MS;
    const logDir =
      cfg.logPath ??
      join(process.env["SWATI_HOME"] ?? join(homedir(), ".swati"), "logs");
    this.log = new AppendLog(
      join(logDir, `${cfg.choreography.name}-${cfg.role}.jsonl`),
    );
  }

  async run(input: unknown): Promise<Result<unknown>> {
    const { choreography, role, identity, transport } = this.cfg;

    const recvDone = this.startReceiving();
    const pingDone = this.startPinging();

    let result: Result<unknown> = ok(undefined);
    let recurseInput: { value: unknown } | null = null;
    try {
      await this.runAttestation();

      const context = this.makeContext(input);
      const output = await choreography.flow(context);
      result = ok(output);
    } catch (cause) {
      if ((cause as { __recurse?: boolean }).__recurse) {
        recurseInput = { value: (cause as { __input: unknown }).__input };
      } else if ((cause as { code?: string }).code === "CHOREO_MISMATCH") {
        result = err("CHOREO_MISMATCH", (cause as Error).message);
      } else {
        result = err(
          "CONDUCTOR_FAILED",
          "Choreography flow threw an error",
          cause,
        );
      }
    } finally {
      recvDone();
      pingDone();

      await this.snapshotLog(true);
    }

    if (recurseInput !== null) {
      await transport.close();
      return this.run(recurseInput.value);
    }

    await this.log.append(identity, "ack", role, choreography.name, {
      status: result.ok ? "completed" : "failed",
    });

    return result;
  }

  private makeContext(input: unknown): ChoreoContext {
    const self = this;
    const {
      choreography,
      role,
      identity,
      transport,
      resolver,
      gateProviders,
      llm,
    } = this.cfg;
    const choreoId = self.choreoId;

    const roleHandles: Record<RoleName, RoleHandle> = {};
    for (const r of choreography.roles) {
      roleHandles[r] = contextFactory.makeLLMHandle(r, llm);
    }

    const send = async <T>(
      value: T | import("./dsl.js").Located<T>,
      from: RoleName,
      to: RoleName,
    ): Promise<T> => {
      const actualValue: T =
        value !== null &&
        typeof value === "object" &&
        "__locatedValue" in (value as object)
          ? (value as import("./dsl.js").Located<T>).__locatedValue
          : (value as T);

      if (role === from) {
        const resolved = await resolver.resolve(to);
        if (!resolved.ok) throw new Error(resolved.error.message);

        const actResult = await self.log.append(
          identity,
          "send",
          role,
          choreoId,
          { from, to, value: actualValue },
        );
        if (!actResult.ok) throw new Error(actResult.error.message);
        self.actCount++;

        const bytes = new TextEncoder().encode(
          JSON.stringify({
            kind: "send",
            from,
            to,
            actId: actResult.value.id,
            value: actualValue,
            choreoId,
          }),
        );
        await transport.send(resolved.value.transportId, bytes);
        return actualValue;
      }

      if (role === to) {
        const key = `send:${from}:${to}`;

        if (self.earlyMessages.has(key)) {
          const buffered = self.earlyMessages.get(key) as T;
          self.earlyMessages.delete(key);
          return buffered;
        }

        return new Promise<T>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            self.pendingOps.delete(key);
            reject(
              new Error(
                `Peer timeout: "${from}" did not send to "${to}" within ` +
                  `${self.peerTimeoutMs / 1000}s. Did role "${from}" crash or stall?`,
              ),
            );
          }, self.peerTimeoutMs);

          self.pendingOps.set(key, {
            type: "send",
            resolve: (v: unknown) => {
              clearTimeout(timeoutId);
              (resolve as (v: unknown) => void)(v);
            },
            reject: (e: Error) => {
              clearTimeout(timeoutId);
              reject(e);
            },
          });
        });
      }

      return undefined as unknown as T;
    };

    const locally = async <T>(
      localRole: RoleName,
      fn: () => Promise<T> | T,
    ): Promise<import("./dsl.js").Located<T>> => {
      if (role === localRole) {
        const value = await fn();
        const actResult = await self.log.append(
          identity,
          "do",
          role,
          choreoId,
          { locally: localRole },
        );
        if (!actResult.ok) throw new Error(actResult.error.message);
        self.actCount++;
        return { __locatedRole: localRole, __locatedValue: value };
      }
      return {
        __locatedRole: localRole,
        __locatedValue: undefined as unknown as T,
      };
    };

    const computeSend = async <T>(
      from: RoleName,
      to: RoleName,
      fn: () => Promise<T> | T,
    ): Promise<T> => {
      const loc = await locally(from, fn);
      return send(loc, from, to);
    };

    const choose = async <O extends string>(
      chooserRole: RoleName,
      options: readonly O[],
      evidence: unknown,
      participants?: RoleName[],
    ): Promise<O> => {
      if (role === chooserRole) {
        const prompt =
          `Given the evidence below, choose exactly one option from: ${options.join(", ")}.\n\n` +
          `Evidence:\n${JSON.stringify(evidence)}\n\nRespond with only the option name.`;
        const llmResult = await llm.complete(prompt);
        if (!llmResult.ok) throw new Error(llmResult.error.message);

        const raw = llmResult.value.trim();
        const match = options.find(
          (o) => o.toLowerCase() === raw.toLowerCase(),
        );
        const choice: O = (match ?? options[0]) as O;

        const actResult = await self.log.append(
          identity,
          "choose",
          role,
          choreoId,
          {
            chooser: chooserRole,
            choice,
            options,
          },
        );
        if (!actResult.ok) throw new Error(actResult.error.message);
        self.actCount++;

        const bytes = new TextEncoder().encode(
          JSON.stringify({
            kind: "choose",
            chooser: chooserRole,
            choice,
            actId: actResult.value.id,
            choreoId,
          }),
        );

        if (participants && participants.length > 0) {
          await Promise.all(
            participants
              .filter((p) => p !== role)
              .map(async (p) => {
                const resolved = await resolver.resolve(p);
                if (resolved.ok)
                  await transport.send(resolved.value.transportId, bytes);
              }),
          );
        } else {
          await transport.broadcast(bytes);
        }
        return choice;
      }

      if (participants && !participants.includes(role)) {
        return options[0] as O;
      }

      const key = `choose:${chooserRole}`;

      if (self.earlyMessages.has(key)) {
        const buffered = self.earlyMessages.get(key) as O;
        self.earlyMessages.delete(key);
        return buffered;
      }
      return new Promise<O>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          self.pendingOps.delete(key);
          reject(
            new Error(
              `Peer timeout: "${chooserRole}" did not broadcast a choice within ` +
                `${self.peerTimeoutMs / 1000}s. Did role "${chooserRole}" crash or stall?`,
            ),
          );
        }, self.peerTimeoutMs);

        self.pendingOps.set(key, {
          type: "choose",
          resolve: (v: unknown) => {
            clearTimeout(timeoutId);
            (resolve as (v: unknown) => void)(v);
          },
          reject: (e: Error) => {
            clearTimeout(timeoutId);
            reject(e);
          },
        });
      });
    };

    const chooseIf = async (
      choiceRole: RoleName,
      condition: boolean,
    ): Promise<boolean> => {
      if (role === choiceRole) {
        const choice = condition ? "true" : "false";
        const actResult = await self.log.append(
          identity,
          "choose",
          role,
          choreoId,
          {
            chooser: choiceRole,
            choice,
            options: ["true", "false"],
          },
        );
        if (!actResult.ok) throw new Error(actResult.error.message);
        self.actCount++;

        const bytes = new TextEncoder().encode(
          JSON.stringify({
            kind: "choose",
            chooser: choiceRole,
            choice,
            actId: actResult.value.id,
            choreoId,
          }),
        );
        await transport.broadcast(bytes);
        return condition;
      }

      const key = `choose:${choiceRole}`;
      return new Promise<boolean>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          self.pendingOps.delete(key);
          reject(
            new Error(
              `Peer timeout: "${choiceRole}" did not broadcast chooseIf within ` +
                `${self.peerTimeoutMs / 1000}s.`,
            ),
          );
        }, self.peerTimeoutMs);

        self.pendingOps.set(key, {
          type: "choose",
          resolve: (v: unknown) => {
            clearTimeout(timeoutId);
            resolve(v === "true");
          },
          reject: (e: Error) => {
            clearTimeout(timeoutId);
            reject(e);
          },
        });
      });
    };

    const gate = async (
      gateRole: RoleName,
      providerName: string,
      fn: () => Promise<unknown>,
    ): Promise<Result<unknown>> => {
      if (role !== gateRole) return ok(null);

      const provider = gateProviders[providerName];
      if (!provider) {
        return err(
          "GATE_PROVIDER_NOT_FOUND",
          `Gate provider "${providerName}" is not registered. Check your swati config.`,
        );
      }

      const result = await provider.execute(fn);

      const actResult = await self.log.append(
        identity,
        "gate",
        role,
        choreoId,
        {
          provider: providerName,
          success: result.ok,
        },
      );
      if (!actResult.ok) throw new Error(actResult.error.message);
      self.actCount++;

      const bytes = new TextEncoder().encode(
        JSON.stringify({
          kind: "gate",
          role: gateRole,
          provider: providerName,
          success: result.ok,
          actId: actResult.value.id,
          choreoId,
        }),
      );
      await transport.broadcast(bytes);
      return result;
    };

    const persist = async (key: string, value: unknown): Promise<void> => {
      self.sharedState.set(key, value);
      await self.log.append(identity, "persist", role, choreoId, {
        key,
        value,
      });
      self.actCount++;
    };

    const recall = async (key: string): Promise<unknown> => {
      return self.sharedState.get(key);
    };

    const recurse = async (newInput: unknown): Promise<never> => {
      await self.log.append(identity, "recurse", role, choreoId, { newInput });
      self.actCount++;
      const sentinel = Object.assign(new Error("__recurse__"), {
        __recurse: true,
        __input: newInput,
      });
      throw sentinel;
    };

    const invoke = async <SI, SO>(
      subChoreo: ChoreographyDef<SI, SO>,
      subInput: SI,
    ): Promise<SO> => {
      for (const r of subChoreo.roles) {
        if (!choreography.roles.includes(r)) {
          throw new Error(
            `invoke(): sub-choreography "${subChoreo.name}" requires role "${r}" ` +
              `which is not present in parent roles [${choreography.roles.join(", ")}]`,
          );
        }
      }
      const subCtx = self.makeContext(
        subInput as unknown,
      ) as unknown as import("./dsl.js").ChoreoContext<SI>;
      return subChoreo.flow(subCtx);
    };

    const ctx: ChoreoContext = {
      input,
      roles: roleHandles,
      send,
      choose,
      chooseIf,
      locally,
      computeSend,
      gate,
      persist,
      recall,
      recurse,
      invoke,
    };

    return ctx;
  }

  private startReceiving(): () => void {
    let active = true;

    (async () => {
      for await (const msg of this.cfg.transport.recv()) {
        if (!active) break;
        try {
          await this.handleMessage(msg.from, msg.bytes);
        } catch {}
      }
    })();

    return () => {
      active = false;
    };
  }

  private async handleMessage(from: string, bytes: Uint8Array): Promise<void> {
    const text = new TextDecoder().decode(bytes);
    const envelope = JSON.parse(text) as Record<string, unknown>;

    const senderRole = this.findRoleByTransportId(from);
    if (senderRole) {
      this.lastPeerId.set(senderRole, Date.now());

      this.peerTimedOut.delete(senderRole);
    }

    switch (envelope["kind"]) {
      case "ping": {
        const fromRole = String(envelope["from"]);
        if (fromRole && fromRole !== this.cfg.role) {
          this.transportIdToRole.set(from, fromRole);
          this.lastPeerId.set(fromRole, Date.now());
          this.peerTimedOut.delete(fromRole);
        }
        break;
      }

      case "attest": {
        const attesterRole = String(envelope["role"]);
        const attestedId = String(envelope["choreoId"]);
        const attestPubHex = String(envelope["pubkey"]);
        const attestSigHex = String(envelope["sig"]);

        const attestBody = {
          kind: "attest" as const,
          role: attesterRole,
          choreoId: attestedId,
          pubkey: attestPubHex,
        };
        const valid = await verify(
          hexToPubkey(attestPubHex),
          hexToPubkey(attestSigHex),
          attestBody,
        );
        if (!valid) break;

        const resolved = await this.cfg.resolver.resolve(attesterRole);
        if (resolved.ok && pubkeyToHex(resolved.value.pubkey) !== attestPubHex)
          break;

        const cb = this.pendingAttests.get(attesterRole);
        if (cb) {
          this.pendingAttests.delete(attesterRole);
          cb(attestedId);
        } else {
          this.attestBuffer.set(attesterRole, attestedId);
        }
        break;
      }

      case "send": {
        const msgChoreoId = envelope["choreoId"] as string | undefined;
        if (msgChoreoId && msgChoreoId !== this.choreoId) {
          await this.log.append(
            this.cfg.identity,
            "ping",
            this.cfg.role,
            this.choreoId,
            {
              event: "choreo_mismatch",
              expected: this.choreoId,
              received: msgChoreoId,
            },
          );
          break;
        }
        const key = `send:${String(envelope["from"])}:${String(envelope["to"])}`;
        const pending = this.pendingOps.get(key);
        if (pending) {
          this.pendingOps.delete(key);
          pending.resolve(envelope["value"]);
        } else {
          this.earlyMessages.set(key, envelope["value"]);
        }
        break;
      }
      case "choose": {
        const msgChoreoId = envelope["choreoId"] as string | undefined;
        if (msgChoreoId && msgChoreoId !== this.choreoId) {
          await this.log.append(
            this.cfg.identity,
            "ping",
            this.cfg.role,
            this.choreoId,
            {
              event: "choreo_mismatch",
              expected: this.choreoId,
              received: msgChoreoId,
            },
          );
          break;
        }
        const key = `choose:${String(envelope["chooser"])}`;
        const pending = this.pendingOps.get(key);
        if (pending) {
          this.pendingOps.delete(key);
          pending.resolve(envelope["choice"]);
        } else {
          this.earlyMessages.set(key, envelope["choice"]);
        }
        break;
      }
    }
  }

  private findRoleByTransportId(transportId: string): RoleName | null {
    return this.transportIdToRole.get(transportId) ?? null;
  }

  private async runAttestation(): Promise<void> {
    const { choreography, role, identity, transport } = this.cfg;
    const otherRoles = choreography.roles.filter((r) => r !== role);
    if (otherRoles.length === 0) return;

    const attestBody = {
      kind: "attest" as const,
      role,
      choreoId: this.choreoId,
      pubkey: pubkeyToHex(identity.pubkey),
    };
    const sig = await sign(identity.privateKey, attestBody);
    const attestBytes = new TextEncoder().encode(
      JSON.stringify({ ...attestBody, sig: pubkeyToHex(sig) }),
    );

    const remaining = new Set(otherRoles);
    const rejectors = new Map<RoleName, (e: Error) => void>();

    const attestPromises = otherRoles.map((peerRole) => {
      if (this.attestBuffer.has(peerRole)) {
        const id = this.attestBuffer.get(peerRole)!;
        this.attestBuffer.delete(peerRole);
        remaining.delete(peerRole);
        return Promise.resolve(id);
      }
      return new Promise<string>((resolve, reject) => {
        rejectors.set(peerRole, reject);
        this.pendingAttests.set(peerRole, (id: string) => {
          remaining.delete(peerRole);
          rejectors.delete(peerRole);
          resolve(id);
        });
      });
    });

    const deadlineTimer = setTimeout(() => {
      const missing = [...remaining].map((r) => `"${r}"`).join(", ");
      const msg =
        `Attestation deadline (${this.attestMaxWaitMs / 1000}s) exceeded. ` +
        `Roles still pending: ${missing}. ` +
        `Are they online and running the same choreography?`;
      for (const reject of rejectors.values()) reject(new Error(msg));
    }, this.attestMaxWaitMs);

    const retryTimer = setInterval(async () => {
      if (remaining.size > 0) await transport.broadcast(attestBytes);
    }, this.attestRetryMs);

    await transport.broadcast(attestBytes);

    try {
      const receivedIds = await Promise.all(attestPromises);

      for (let i = 0; i < otherRoles.length; i++) {
        if (receivedIds[i] !== this.choreoId) {
          throw Object.assign(
            new Error(
              `CHOREOGRAPHY MISMATCH: role "${otherRoles[i]}" is running ` +
                `"${receivedIds[i]}" but this conductor expects "${this.choreoId}". ` +
                `All peers must run the same choreography version (same source hash).`,
            ),
            { code: "CHOREO_MISMATCH" },
          );
        }
      }
    } finally {
      clearTimeout(deadlineTimer);
      clearInterval(retryTimer);

      this.pendingAttests.clear();
      this.attestBuffer.clear();
    }
  }

  private startPinging(): () => void {
    let active = true;

    const interval = setInterval(async () => {
      if (!active) return;
      const bytes = new TextEncoder().encode(
        JSON.stringify({ kind: "ping", from: this.cfg.role, ts: Date.now() }),
      );
      await this.cfg.transport.broadcast(bytes);

      for (const [peerRole, lastSeen] of this.lastPeerId.entries()) {
        if (
          Date.now() - lastSeen > this.peerTimeoutMs &&
          !this.peerTimedOut.has(peerRole)
        ) {
          this.peerTimedOut.add(peerRole);
          await this.log.append(
            this.cfg.identity,
            "ping",
            this.cfg.role,
            this.cfg.choreography.name,
            { event: "peer_timeout", peer: peerRole, lastSeen },
          );
        }
      }
    }, PING_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }

  private async snapshotLog(force = false): Promise<void> {
    if (!force && this.actCount < LOG_SNAPSHOT_EVERY_N_ACTS) return;
    await this.cfg.storage.putLogSnapshot(
      this.cfg.choreography.name,
      this.cfg.role,
      this.log.toJsonl(),
    );
  }

  async verifyLog(): Promise<Result<void>> {
    return this.log.verifyChain();
  }

  getLog(): AppendLog {
    return this.log;
  }
}
