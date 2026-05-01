import { Conductor } from "./conductor.js";
import { generateIdentity, loadIdentityFromFile } from "./identity.js";
import type { ChoreographyDef } from "./dsl.js";
import type { GateProvider } from "./interfaces/gate.js";
import type { IdentityResolver } from "./interfaces/resolver.js";
import type { LLMClient } from "./interfaces/llm.js";
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

type RunStatus = "pending" | "running" | "done" | "failed";

interface RunRecord {
  runId: string;
  role: string;
  status: RunStatus;
  result?: Result<unknown>;
  startedAt: number;
  doneAt?: number;
  resolve: (r: Result<unknown>) => void;
}

export class SwatiRuntime {
  private readonly cfg: RuntimeConfig;
  private readonly runs = new Map<string, RunRecord>();
  private started = false;

  constructor(cfg: RuntimeConfig) {
    this.cfg = cfg;
  }

  async start(): Promise<void> {
    this.started = true;
    if (
      typeof (this.cfg.transport as unknown as Record<string, unknown>)[
        "awaitReady"
      ] === "function"
    ) {
      await (
        this.cfg.transport as unknown as { awaitReady(): Promise<void> }
      ).awaitReady();
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
    let resolve!: (r: Result<unknown>) => void;

    const record: RunRecord = {
      runId,
      role,
      status: "pending",
      startedAt: Date.now(),
      resolve: (r) => {
        resolve(r);
      },
    };
    this.runs.set(runId, record);

    this._spawnRun(
      choreo as ChoreographyDef,
      role,
      input as unknown,
      identityFile,
      runId,
    )
      .then((result) => {
        record.status = result.ok ? "done" : "failed";
        record.result = result;
        record.doneAt = Date.now();
        resolve(result);
      })
      .catch((e) => {
        record.status = "failed";
        record.result = err("RUNTIME_ERROR", String(e));
        record.doneAt = Date.now();
        resolve(record.result);
      });

    await new Promise<void>((r) => setTimeout(r, 0));

    return runId;
  }

  getStatus(runId: string): RunStatus | null {
    return this.runs.get(runId)?.status ?? null;
  }

  async waitFor(runId: string, timeoutMs = 300_000): Promise<Result<unknown>> {
    const record = this.runs.get(runId);
    if (!record) return err("RUN_NOT_FOUND", `No run with id "${runId}"`);
    if (record.result) return record.result;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`waitFor(${runId}) timed out after ${timeoutMs}ms`)),
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
    status: RunStatus;
    startedAt: number;
  }> {
    return [...this.runs.values()].map((r) => ({
      runId: r.runId,
      role: r.role,
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
        Promise.all(
          active.map((r) => this.waitFor(r.runId, 60_000).catch(() => {})),
        ),
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
    const rid =
      runId ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const record = this.runs.get(rid);
    if (record) record.status = "running";

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
      llm: this.cfg.llm,
      ...(this.cfg.logPath !== undefined ? { logPath: this.cfg.logPath } : {}),
      ownTransport: false,
    });

    return conductor.run(input);
  }
}

export function createRuntime(cfg: RuntimeConfig): SwatiRuntime {
  return new SwatiRuntime(cfg);
}
