import { AppendLog } from "./log.js";
import { contextFactory } from "./dsl.js";
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
const LOG_SNAPSHOT_EVERY_N_ACTS = 20;

export interface ConductorConfig {
  choreography: ChoreographyDef;
  role: RoleName;
  identity: Identity;
  transport: Transport;
  resolver: IdentityResolver;
  storage: Storage;
  gateProviders: Record<string, GateProvider>;
  llm: LLMClient;
  logPath?: string;
}

interface PendingOp {
  type: "send" | "choose";
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class Conductor {
  private readonly cfg: ConductorConfig;
  private readonly log: AppendLog;
  private readonly pendingOps: Map<string, PendingOp> = new Map();
  private readonly sharedState: Map<string, unknown> = new Map();
  private readonly lastPeerId: Map<RoleName, number> = new Map();
  private actCount = 0;

  constructor(cfg: ConductorConfig) {
    this.cfg = cfg;
    const choreoId = cfg.choreography.name;
    const logDir =
      cfg.logPath ??
      join(process.env["SWATI_HOME"] ?? join(homedir(), ".swati"), "logs");
    this.log = new AppendLog(join(logDir, `${choreoId}-${cfg.role}.jsonl`));
  }

  async run(input: unknown): Promise<Result<unknown>> {
    const { choreography, role, identity, transport } = this.cfg;

    const recvDone = this.startReceiving();
    const pingDone = this.startPinging();

    let result: Result<unknown> = ok(undefined);
    try {
      const context = this.makeContext(input);
      const output = await choreography.flow(context);
      result = ok(output);
    } catch (cause) {
      if ((cause as { __recurse?: boolean }).__recurse) {
        recvDone();
        pingDone();
        await this.snapshotLog();
        const newInput = (cause as { __input: unknown }).__input;
        await transport.close();
        return this.run(newInput);
      }
      result = err(
        "CONDUCTOR_FAILED",
        "Choreography flow threw an error",
        cause,
      );
    } finally {
      recvDone();
      pingDone();
      await this.snapshotLog();
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
    const choreoId = choreography.name;

    const roleHandles: Record<RoleName, RoleHandle> = {};
    for (const r of choreography.roles) {
      roleHandles[r] = contextFactory.makeLLMHandle(r, llm);
    }

    const send = async <T>(
      value: T,
      from: RoleName,
      to: RoleName,
    ): Promise<T> => {
      if (role === from) {
        const resolved = await resolver.resolve(to);
        if (!resolved.ok) throw new Error(resolved.error.message);

        const actResult = await self.log.append(
          identity,
          "send",
          role,
          choreoId,
          { from, to, value },
        );
        if (!actResult.ok) throw new Error(actResult.error.message);
        self.actCount++;

        const bytes = new TextEncoder().encode(
          JSON.stringify({
            kind: "send",
            from,
            to,
            actId: actResult.value.id,
            value,
          }),
        );
        await transport.send(resolved.value.transportId, bytes);
        return value;
      }

      if (role === to) {
        return new Promise<T>((resolve, reject) => {
          self.pendingOps.set(`send:${from}:${to}`, {
            type: "send",
            resolve: resolve as (v: unknown) => void,
            reject,
          });
        });
      }

      return undefined as unknown as T;
    };

    const choose = async <O extends string>(
      chooserRole: RoleName,
      options: readonly O[],
      evidence: unknown,
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
          }),
        );
        await transport.broadcast(bytes);
        return choice;
      }

      return new Promise<O>((resolve, reject) => {
        self.pendingOps.set(`choose:${chooserRole}`, {
          type: "choose",
          resolve: resolve as (v: unknown) => void,
          reject,
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

    const ctx: ChoreoContext = {
      input,
      roles: roleHandles,
      send,
      choose,
      gate,
      persist,
      recall,
      recurse,
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
    }

    switch (envelope["kind"]) {
      case "send": {
        const key = `send:${String(envelope["from"])}:${String(envelope["to"])}`;
        const pending = this.pendingOps.get(key);
        if (pending) {
          this.pendingOps.delete(key);
          pending.resolve(envelope["value"]);
        }
        break;
      }
      case "choose": {
        const key = `choose:${String(envelope["chooser"])}`;
        const pending = this.pendingOps.get(key);
        if (pending) {
          this.pendingOps.delete(key);
          pending.resolve(envelope["choice"]);
        }
        break;
      }
    }
  }

  private findRoleByTransportId(_transportId: string): RoleName | null {
    return null;
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
        if (Date.now() - lastSeen > PEER_TIMEOUT_MS) {
          await this.log.append(
            this.cfg.identity,
            "ping",
            this.cfg.role,
            this.cfg.choreography.name,
            { event: "peer_timeout", peer: peerRole },
          );
        }
      }
    }, PING_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }

  private async snapshotLog(): Promise<void> {
    if (this.actCount < LOG_SNAPSHOT_EVERY_N_ACTS) return;
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
