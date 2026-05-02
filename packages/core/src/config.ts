import type { GateProvider } from "./interfaces/gate.js";
import type { IdentityResolver } from "./interfaces/resolver.js";
import type { Storage } from "./interfaces/storage.js";
import type { Transport } from "./interfaces/transport.js";
import type { LLMClient } from "./interfaces/llm.js";
import type { ChoreographyDef } from "./dsl.js";

export interface SwatiConfig {
  transport: Transport;
  resolver: IdentityResolver;
  storage: Storage;
  gates: Record<string, GateProvider>;
  llm: LLMClient;
  choreographies?: Record<string, ChoreographyDef>;
}

export function defineConfig(cfg: SwatiConfig): SwatiConfig {
  return cfg;
}
