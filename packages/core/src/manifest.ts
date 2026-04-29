import { sha256 } from "@noble/hashes/sha256";
import { canonicalBytes } from "./canonical.js";
import type { ChoreographyDef } from "./dsl.js";
import type { Manifest } from "./types.js";

export function deriveManifest(
  choreo: ChoreographyDef,
  opts?: {
    version?: string;
    plugins?: string[];
    sourceHash?: string;
  },
): Manifest {
  const roles = [...choreo.roles];
  const version = opts?.version ?? "1.0.0";
  const plugins = opts?.plugins ?? [];
  const publishedAt = Date.now();

  const idPayload = { name: choreo.name, version, roles, plugins, publishedAt };
  const idBytes = canonicalBytes(idPayload);
  const hashBytes = sha256(idBytes);
  const id = Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    id: `swati:${id}/${choreo.name}`,
    name: choreo.name,
    version,
    roles,
    plugins,
    sourceHash: opts?.sourceHash ?? "",
    publishedAt,
  };
}
