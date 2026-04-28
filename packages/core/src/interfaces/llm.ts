import type { Result } from "../types.js";

export interface LLMOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMClient {
  complete(prompt: string, opts?: LLMOptions): Promise<Result<string>>;
}
