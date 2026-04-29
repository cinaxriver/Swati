import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ui } from "../ui.js";

export async function runInit(options: { name?: string }): Promise<void> {
  const name = options.name ?? "my-choreo";

  if (existsSync("swati.config.vanilla.ts")) {
    ui.warn("swati.config.vanilla.ts already exists. Skipping.");
    return;
  }

  const vanillaConfig = `import { defineConfig } from "@swati/core/config";
import { InMemoryTransport, StaticResolver, LocalFileStorage, LocalGate, MockLLM } from "@swati/core/adapters";

export default defineConfig({
  transport: new InMemoryTransport(),
  resolver: new StaticResolver("./identities.json"),
  storage: new LocalFileStorage(process.env.SWATI_HOME ?? "~/.swati/storage"),
  gates: { local: new LocalGate() },
  llm: new MockLLM({ response: "draft content" }),
});
`;

  const choreoTemplate = `import { choreography } from "@swati/core";

// ${name}: define your roles and their interactions.
export default choreography("${name}", {
  roles: ["role-a", "role-b"] as const,

  flow: async (c) => {
    // Role A does something.
    const result = await c.roles["role-a"]!.do("describe your task here");

    // Send the result to role B.
    const received = await c.send(result, "role-a", "role-b");

    // Role B makes a decision.
    const decision = await c.choose("role-b", ["approve", "revise"] as const, received);

    return { decision };
  },
});
`;

  const identities = `{
  "role-a": {
    "pubkey": "0000000000000000000000000000000000000000000000000000000000000001",
    "transportId": "mem-node-a"
  },
  "role-b": {
    "pubkey": "0000000000000000000000000000000000000000000000000000000000000002",
    "transportId": "mem-node-b"
  }
}
`;

  writeFileSync("swati.config.vanilla.ts", vanillaConfig, "utf-8");
  writeFileSync(`${name}.choreo.ts`, choreoTemplate, "utf-8");

  if (!existsSync("identities.json")) {
    writeFileSync("identities.json", identities, "utf-8");
  }

  mkdirSync(".swati/logs", { recursive: true });

  ui.ok(`Initialized swati project: ${name}`);
  ui.dim(`  ${name}.choreo.ts       — choreography definition`);
  ui.dim(`  swati.config.vanilla.ts — vanilla configuration`);
  ui.dim(`  identities.json         — role identities (vanilla)`);
  ui.dim("");
  ui.info(`Run: swati run --role role-a --score ${name}.choreo.ts`);
}
