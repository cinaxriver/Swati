import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport } from "./adapters/in-memory-transport.js";
import { StaticResolver } from "./adapters/static-resolver.js";
import { MockLLM } from "./adapters/mock-llm.js";
import { generateIdentity, pubkeyToHex } from "./identity.js";
import { Conductor } from "./conductor.js";
import type { ChoreographyDef } from "./dsl.js";
import type { LLMClient } from "./interfaces/llm.js";
import type { Storage } from "./interfaces/storage.js";
import type { GateProvider } from "./interfaces/gate.js";
import type { Manifest, ChoreoId, RoleName, Result } from "./types.js";
import { ok, err } from "./types.js";

class NoopStorage implements Storage {
  async putManifest(_m: Manifest) {
    return ok({ uri: "mem://manifest", hash: "0" });
  }
  async getManifest(_u: string) {
    return err("NOOP", "noop");
  }
  async putLogSnapshot(_c: ChoreoId, _r: RoleName, _j: string) {
    return ok({ uri: "mem://log" });
  }
  async getLogSnapshot(_u: string) {
    return err("NOOP", "noop");
  }
  async putSource(_b: Uint8Array) {
    return ok({ uri: "mem://source", hash: "0" });
  }
  async getSource(_u: string) {
    return err("NOOP", "noop");
  }
}

export interface SimulateOptions<I = unknown> {
  input: I;
  llm?: LLMClient;
  gateProviders?: Record<string, GateProvider>;
  storage?: Storage;
  llms?: Record<RoleName, LLMClient>;
}

export async function simulate<I = unknown, O = unknown>(
  choreo: ChoreographyDef<I, O>,
  opts: SimulateOptions<I>,
): Promise<Record<RoleName, Result<O>>> {
  const { roles } = choreo;
  const defaultLlm = opts.llm ?? new MockLLM();
  const storage = opts.storage ?? new NoopStorage();
  const gates = opts.gateProviders ?? {};
  const logPath = join(tmpdir(), "swati-simulate", choreo.name);

  InMemoryTransport.reset();

  const identities = await Promise.all(roles.map((r) => generateIdentity(r)));
  const transports = roles.map((r) => new InMemoryTransport(r));

  const resolverMap: Record<string, { pubkey: string; transportId: string }> =
    {};
  for (let i = 0; i < roles.length; i++) {
    resolverMap[roles[i]!] = {
      pubkey: pubkeyToHex(identities[i]!.pubkey),
      transportId: roles[i]!,
    };
  }
  const resolver = new StaticResolver(resolverMap);

  const results = await Promise.all(
    roles.map((role, i) => {
      const llm = opts.llms?.[role] ?? defaultLlm;
      return new Conductor({
        choreography: choreo as import("./dsl.js").ChoreographyDef,
        role,
        identity: identities[i]!,
        transport: transports[i]!,
        resolver,
        storage,
        gateProviders: gates,
        llm,
        logPath,
      }).run(opts.input) as Promise<Result<O>>;
    }),
  );

  await Promise.all(transports.map((t) => t.close()));

  return Object.fromEntries(roles.map((r, i) => [r, results[i]!]));
}
