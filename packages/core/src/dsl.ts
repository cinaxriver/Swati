import type { RoleName, Result } from "./types.js";
import type { LLMClient } from "./interfaces/llm.js";

export interface RoleHandle {
  do(
    prompt: string,
    opts?: { system?: string; maxTokens?: number },
  ): Promise<unknown>;
}

export interface ChoreoContext<I = unknown> {
  input: I;
  roles: Record<RoleName, RoleHandle>;

  send<T>(value: T, from: RoleName, to: RoleName): Promise<T>;

  choose<O extends string>(
    role: RoleName,
    options: readonly O[],
    evidence: unknown,
  ): Promise<O>;

  gate(
    role: RoleName,
    provider: string,
    fn: () => Promise<unknown>,
  ): Promise<Result<unknown>>;

  persist(key: string, value: unknown): Promise<void>;

  recall(key: string): Promise<unknown>;

  recurse(newInput: I): Promise<never>;
}

export interface ChoreographyDef<I = unknown, O = unknown> {
  name: string;
  roles: readonly RoleName[];
  flow: (c: ChoreoContext<I>) => Promise<O>;
}

export function choreography<I = unknown, O = unknown>(
  name: string,
  spec: {
    roles: readonly RoleName[];
    flow: (c: ChoreoContext<I>) => Promise<O>;
  },
): ChoreographyDef<I, O> {
  return { name, ...spec };
}

export interface PendingRecv {
  from: RoleName;
  to: RoleName;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export interface PendingChoose<O extends string = string> {
  role: RoleName;
  resolve: (choice: O) => void;
  reject: (err: Error) => void;
}

export interface ContextFactory {
  makeLLMHandle(role: RoleName, llm: LLMClient): RoleHandle;
}

export const contextFactory: ContextFactory = {
  makeLLMHandle(role, llm) {
    return {
      async do(prompt, opts) {
        const result = await llm.complete(prompt, {
          ...(opts?.system !== undefined ? { system: opts.system } : {}),
          ...(opts?.maxTokens !== undefined
            ? { maxTokens: opts.maxTokens }
            : {}),
        });
        if (!result.ok) {
          throw new Error(`[${role}] LLM call failed: ${result.error.message}`);
        }
        return result.value;
      },
    };
  },
};
