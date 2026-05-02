import { EventEmitter } from "node:events";
import { Conductor } from "./conductor.js";
import { generateIdentity, loadIdentityFromFile } from "./identity.js";
import type { ChoreographyDef } from "./dsl.js";
import type { GateProvider } from "./interfaces/gate.js";
import type { IdentityResolver } from "./interfaces/resolver.js";
import type { LLMClient, LLMOptions } from "./interfaces/llm.js";
import type { Storage } from "./interfaces/storage.js";
import type { Transport } from "./interfaces/transport.js";
import type { Result } from "./types.js";
import { err } from "./types.js";

export interface RuntimeConfig {
  transport: Transport;
  resolver: IdentityResolver;
  storage: Storage;
  gates: Record<string, GateProvider>;
  llm: LLMClient;
  logPath?: string;
}

export interface RunStartEvent {
  runId: string;
  role: string;
  choreoName: string;
}
export interface RunEndEvent {
  runId: string;
  role: string;
  result: Result<unknown>;
  durationMs: number;
}
export interface RunErrorEvent {
  runId: string;
  role: string;
  error: unknown;
}
export interface ActBeforeEvent {
  runId: string;
  role: string;
  prompt: string;
}
export interface ActAfterEvent {
  runId: string;
  role: string;
  result: Result<string>;
  durationMs: number;
}

type RunStatus = "pending" | "running" | "done" | "failed";

interface RunRecord {
  runId: string;
  role: string;
  choreoName: string;
  status: RunStatus;
  result?: Result<unknown>;
  startedAt: number;
  doneAt?: number;
  resolve: (r: Result<unknown>) => void;
}

class ObservingLLM implements LLMClient {
  constructor(
    private readonly inner: LLMClient,
    private readonly rt: SwatiRuntime,
    private readonly runId: string,
    private readonly role: string,
  ) {}

  async complete(prompt: string, opts?: LLMOptions): Promise<Result<string>> {
    this.rt.emit("act:before", {
      runId: this.runId,
      role: this.role,
      prompt,
    } satisfies ActBeforeEvent);
    const t0 = Date.now();
    const result = await this.inner.complete(prompt, opts);
    this.rt.emit("act:after", {
      runId: this.runId,
      role: this.role,
      result,
      durationMs: Date.now() - t0,
    } satisfies ActAfterEvent);
    return result;
  }
}

export class SwatiRuntime extends EventEmitter {
  private readonly cfg: RuntimeConfig;
  private readonly runs = new Map<string, RunRecord>();
  private started = false;

  constructor(cfg: RuntimeConfig) {
    super();
    this.cfg = cfg;
  }

  override on(event: "run:start", listener: (e: RunStartEvent) => void): this;
  override on(event: "run:end", listener: (e: RunEndEvent) => void): this;
  override on(event: "run:error", listener: (e: RunErrorEvent) => void): this;
  override on(event: "act:before", listener: (e: ActBeforeEvent) => void): this;
  override on(event: "act:after", listener: (e: ActAfterEvent) => void): this;

  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override once(event: "run:start", listener: (e: RunStartEvent) => void): this;
  override once(event: "run:end", listener: (e: RunEndEvent) => void): this;
  override once(event: "run:error", listener: (e: RunErrorEvent) => void): this;
  override once(event: "act:before", listener: (e: ActBeforeEvent) => void): this;
  override once(event: "act:after", listener: (e: ActAfterEvent) => void): this;

  override once(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  async start(): Promise<void> {
    this.started = true;
    if (
      typeof (this.cfg.transport as unknown as Record<string, unknown>)["awaitReady"] === "function"
    ) {
      await (this.cfg.transport as unknown as { awaitReady(): Promise<void> }).awaitReady();
    }
  }

  async runOnce<I = unknown, O = unknown>(
    choreo: ChoreographyDef<I, O>,
    role: string,
    input: I,
    identityFile?: string,
  ): Promise<Result<O>> {
    await this.start();
    try {
      const result = await this._spawnRun(
        choreo as ChoreographyDef,
        role,
        input as unknown,
        identityFile,
      );
      return result as Result<O>;
    } finally {
      await this.cfg.transport.close();
      this.started = false;
    }
  }

  async submit<I = unknown>(
    choreo: ChoreographyDef<I, unknown>,
    role: string,
    input: I,
    identityFile?: string,
  ): Promise<string> {
    if (!this.started) await this.start();

    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const record: RunRecord = {
      runId,
      role,
      choreoName: (choreo as ChoreographyDef).name,
      status: "pending",
      startedAt: Date.now(),
      resolve: (_r) => {},
    };
    this.runs.set(runId, record);

    this._spawnRun(choreo as ChoreographyDef, role, input as unknown, identityFile, runId)
      .then((result) => {
        record.status = result.ok ? "done" : "failed";
        record.result = result;
        record.doneAt = Date.now();
        record.resolve(result);
      })
      .catch((e) => {
        record.status = "failed";
        record.result = err("RUNTIME_ERROR", String(e));
        record.doneAt = Date.now();
        record.resolve(record.result);
      });

    return runId;
  }

  getStatus(runId: string): RunStatus | null {
    return this.runs.get(runId)?.status ?? null;
  }

  getResult(runId: string): Result<unknown> | null {
    return this.runs.get(runId)?.result ?? null;
  }

  async waitFor(runId: string, timeoutMs = 300_000): Promise<Result<unknown>> {
    const record = this.runs.get(runId);
    if (!record) return err("RUN_NOT_FOUND", `No run with id "${runId}"`);
    if (record.result) return record.result;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`waitFor(${runId}) timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      const orig = record.resolve;
      record.resolve = (r) => {
        clearTimeout(timer);
        orig(r);
        resolve(r);
      };
    });
  }

  listRuns(): Array<{
    runId: string;
    role: string;
    choreoName: string;
    status: RunStatus;
    startedAt: number;
  }> {
    return [...this.runs.values()].map((r) => ({
      runId: r.runId,
      role: r.role,
      choreoName: r.choreoName,
      status: r.status,
      startedAt: r.startedAt,
    }));
  }

  async stop(): Promise<void> {
    const active = [...this.runs.values()].filter(
      (r) => r.status === "running" || r.status === "pending",
    );
    if (active.length > 0) {
      await Promise.race([
        Promise.all(active.map((r) => this.waitFor(r.runId, 60_000).catch(() => {}))),
        new Promise((r) => setTimeout(r, 60_000)),
      ]);
    }
    await this.cfg.transport.close();
    this.started = false;
  }

  private async _spawnRun(
    choreo: ChoreographyDef,
    role: string,
    input: unknown,
    identityFile?: string,
    runId?: string,
  ): Promise<Result<unknown>> {
    const rid = runId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const record = this.runs.get(rid);
    if (record) record.status = "running";

    const t0 = Date.now();

    this.emit("run:start", {
      runId: rid,
      role,
      choreoName: choreo.name,
    } satisfies RunStartEvent);

    const identity = identityFile
      ? await loadIdentityFromFile(identityFile)
      : await generateIdentity(role);

    const conductor = new Conductor({
      choreography: choreo,
      role,
      identity,
      runId: rid,
      transport: this.cfg.transport,
      resolver: this.cfg.resolver,
      storage: this.cfg.storage,
      gateProviders: this.cfg.gates,
      llm: new ObservingLLM(this.cfg.llm, this, rid, role),
      ...(this.cfg.logPath !== undefined ? { logPath: this.cfg.logPath } : {}),
      ownTransport: false,
    });

    const result = await conductor.run(input);
    const durationMs = Date.now() - t0;

    if (result.ok) {
      this.emit("run:end", { runId: rid, role, result, durationMs } satisfies RunEndEvent);
    } else {
      this.emit("run:error", { runId: rid, role, error: result.error } satisfies RunErrorEvent);
      this.emit("run:end", { runId: rid, role, result, durationMs } satisfies RunEndEvent);
    }

    return result;
  }
}

export function createRuntime(cfg: RuntimeConfig): SwatiRuntime {
  return new SwatiRuntime(cfg);
}
