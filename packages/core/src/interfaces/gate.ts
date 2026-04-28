import type { Result } from "../types.js";

export interface GateOptions {
  retries?: number;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface GateProvider {
  name: string;
  execute<T>(fn: () => Promise<T>, opts?: GateOptions): Promise<Result<T>>;
}
