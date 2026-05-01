import { EventEmitter } from "node:events";
import type { Transport } from "../interfaces/transport.js";
import type { Result } from "../types.js";
import { ok } from "../types.js";

const BUS = new EventEmitter();
BUS.setMaxListeners(100);

let idCounter = 0;

export class InMemoryTransport implements Transport {
  private readonly id: string;
  private readonly listeners: Array<
    (msg: { from: string; bytes: Uint8Array }) => void
  > = [];

  private readonly listener: (envelope: {
    to: string;
    from: string;
    bytes: Uint8Array;
  }) => void;

  constructor(id?: string) {
    this.id = id ?? `mem-node-${++idCounter}`;
    this.listener = (envelope: {
      to: string;
      from: string;
      bytes: Uint8Array;
    }) => {
      if (envelope.to === this.id || envelope.to === "*") {
        for (const fn of this.listeners) {
          fn({ from: envelope.from, bytes: envelope.bytes });
        }
      }
    };
    BUS.on("swati:msg", this.listener);
  }

  async selfId(): Promise<string> {
    return this.id;
  }

  async send(peerId: string, bytes: Uint8Array): Promise<Result<void>> {
    BUS.emit("swati:msg", { to: peerId, from: this.id, bytes });
    return ok(undefined);
  }

  async broadcast(bytes: Uint8Array): Promise<Result<void>> {
    BUS.emit("swati:msg", { to: "*", from: this.id, bytes });
    return ok(undefined);
  }

  recv(): AsyncIterable<{ from: string; bytes: Uint8Array }> {
    const queue: Array<{ from: string; bytes: Uint8Array }> = [];
    let resolve: (() => void) | null = null;
    let closed = false;

    const listener = (msg: { from: string; bytes: Uint8Array }) => {
      queue.push(msg);
      resolve?.();
      resolve = null;
    };
    this.listeners.push(listener);

    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (queue.length > 0) {
              return { done: false, value: queue.shift()! };
            }
            if (closed) return { done: true, value: undefined as never };
            await new Promise<void>((res) => {
              resolve = res;
            });
            if (queue.length > 0) {
              return { done: false, value: queue.shift()! };
            }
            return { done: true, value: undefined as never };
          },
          return() {
            closed = true;
            return Promise.resolve({ done: true, value: undefined as never });
          },
        };
      },
    };
  }

  async close(): Promise<void> {
    BUS.removeListener("swati:msg", this.listener);
  }

  static reset(): void {
    BUS.removeAllListeners();
    idCounter = 0;
  }

  static inject(to: string, from: string, bytes: Uint8Array): void {
    BUS.emit("swati:msg", { to, from, bytes });
  }
}
