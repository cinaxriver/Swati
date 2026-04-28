import type { Result } from "../types.js";

export interface Transport {
  selfId(): Promise<string>;

  send(peerId: string, bytes: Uint8Array): Promise<Result<void>>;

  broadcast(bytes: Uint8Array): Promise<Result<void>>;

  recv(): AsyncIterable<{ from: string; bytes: Uint8Array }>;

  close(): Promise<void>;
}
