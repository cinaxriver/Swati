import type { LLMClient, LLMOptions } from "../interfaces/llm.js";
import type { Result } from "../types.js";
import { ok } from "../types.js";

export interface MockLLMConfig {
  response?: string;
  responses?: string[];
}

export class MockLLM implements LLMClient {
  private readonly config: MockLLMConfig;
  private callIndex = 0;

  constructor(config: MockLLMConfig = {}) {
    this.config = config;
  }

  async complete(prompt: string, _opts?: LLMOptions): Promise<Result<string>> {
    if (this.config.responses) {
      const idx = this.callIndex % this.config.responses.length;
      this.callIndex++;
      return ok(this.config.responses[idx] ?? "mock response");
    }
    return ok(this.config.response ?? `[mock] echo: ${prompt.slice(0, 80)}`);
  }
}
