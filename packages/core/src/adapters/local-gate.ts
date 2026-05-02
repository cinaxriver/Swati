import type { GateOptions, GateProvider } from "../interfaces/gate.js";
import type { Result } from "../types.js";
import { ok, err } from "../types.js";

export class LocalGate implements GateProvider {
  name = "local";

  private readonly defaults: GateOptions;

  constructor(defaults: GateOptions = {}) {
    this.defaults = defaults;
  }

  async execute<T>(fn: () => Promise<T>, opts?: GateOptions): Promise<Result<T>> {
    const retries = opts?.retries ?? this.defaults.retries ?? 1;
    const timeoutMs = opts?.timeoutMs ?? this.defaults.timeoutMs ?? 30_000;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Gate timeout")), timeoutMs),
          ),
        ]);
        return ok(result);
      } catch (cause) {
        if (attempt === retries - 1) {
          return err("GATE_FAILED", `Gate execution failed after ${retries} attempt(s)`, cause);
        }
      }
    }
    return err("GATE_FAILED", "Gate exhausted retries");
  }
}
