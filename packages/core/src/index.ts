export { choreography } from "./dsl.js";
export type { ChoreographyDef, ChoreoContext, RoleHandle } from "./dsl.js";

export { Conductor } from "./conductor.js";
export type { ConductorConfig } from "./conductor.js";

export { AppendLog } from "./log.js";

export {
  generateIdentity,
  sign,
  verify,
  pubkeyToHex,
  hexToPubkey,
} from "./identity.js";
export { canonicalBytes, canonicalJson } from "./canonical.js";
export { deriveManifest } from "./manifest.js";
export { makeFailureDetector } from "./failure-detector.js";
export { defineConfig } from "./config.js";
export type { SwatiConfig } from "./config.js";

export { ok, err } from "./types.js";
export type {
  Act,
  ActId,
  ActKind,
  ChoreoId,
  SwatiError,
  Identity,
  Manifest,
  Pubkey,
  Result,
  RoleName,
  Signature,
} from "./types.js";
