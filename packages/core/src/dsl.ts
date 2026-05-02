import type { RoleName, Result } from "./types.js";
import type { LLMClient } from "./interfaces/llm.js";

export type Located<T, Role extends string = string> = {
  readonly __locatedRole: Role;
  readonly __locatedValue: T;
};

export function located<T, R extends string>(role: R, value: T): Located<T, R> {
  return { __locatedRole: role, __locatedValue: value };
}

export function unwrapLocated<T>(v: Located<T> | T): T {
  if (v !== null && typeof v === "object" && "__locatedValue" in (v as object)) {
    return (v as Located<T>).__locatedValue;
  }
  return v as T;
}

export interface RoleHandle {
  do(prompt: string, opts?: { system?: string; maxTokens?: number }): Promise<unknown>;
}

export interface ChoreoContext<I = unknown> {
  input: I;
  roles: Record<RoleName, RoleHandle>;

  send<T>(value: T | Located<T>, from: RoleName, to: RoleName): Promise<T>;

  choose<O extends string>(
    role: RoleName,
    options: readonly O[],
    evidence: unknown,
    participants?: RoleName[],
  ): Promise<O>;

  chooseIf(role: RoleName, condition: boolean): Promise<boolean>;

  locally<T>(role: RoleName, fn: () => Promise<T> | T): Promise<Located<T>>;

  computeSend<T>(from: RoleName, to: RoleName, fn: () => Promise<T> | T): Promise<T>;

  gate(role: RoleName, provider: string, fn: () => Promise<unknown>): Promise<Result<unknown>>;

  persist(key: string, value: unknown): Promise<void>;

  recall(key: string): Promise<unknown>;

  recurse(newInput: I): Promise<never>;

  invoke<SI, SO>(subChoreo: ChoreographyDef<SI, SO>, input: SI): Promise<SO>;
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

export function polymorphicChoreography<
  const RoleKeys extends readonly string[],
  I = unknown,
  O = unknown,
>(
  roleKeys: RoleKeys,
  makeSpec: (roles: { readonly [K in RoleKeys[number]]: K }) => {
    flow: (c: ChoreoContext<I>) => Promise<O>;
  },
): (...roleNames: string[]) => ChoreographyDef<I, O> {
  return (...roleNames: string[]): ChoreographyDef<I, O> => {
    const rolesObj = Object.fromEntries(roleKeys.map((k, i) => [k, roleNames[i] ?? k])) as {
      readonly [K in RoleKeys[number]]: K;
    };

    const spec = makeSpec(rolesObj);
    const name = roleNames.join("-");

    return {
      name,
      roles: roleNames as unknown as readonly RoleName[],
      flow: spec.flow,
    };
  };
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
          ...(opts?.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
        });
        if (!result.ok) {
          throw new Error(`[${role}] LLM call failed: ${result.error.message}`);
        }
        return result.value;
      },
    };
  },
};
