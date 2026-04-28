export type RoleName = string;
export type ChoreoId = string;
export type ActId = string;
export type Pubkey = Uint8Array;
export type Signature = Uint8Array;

export interface Act {
  id: ActId;
  choreoId: ChoreoId;
  prevId: ActId | null;
  role: RoleName;
  author: Pubkey;
  timestamp: number;
  kind: ActKind;
  payload: unknown;
  signature: Signature;
}

export type ActKind =
  | "do"
  | "send"
  | "choose"
  | "gate"
  | "persist"
  | "recurse"
  | "ping"
  | "ack";

export type Result<T, E = SwatiError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface SwatiError {
  code: string;
  message: string;
  cause?: unknown;
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(
  code: string,
  message: string,
  cause?: unknown,
): Result<never> {
  return { ok: false, error: { code, message, cause } };
}

export interface Manifest {
  id: ChoreoId;
  name: string;
  version: string;
  roles: readonly RoleName[];
  plugins: readonly string[];
  sourceHash: string;
  publishedAt: number;
  storageUri?: string;
}

export interface Identity {
  pubkey: Pubkey;
  privateKey: Uint8Array;
  name?: string;
}
