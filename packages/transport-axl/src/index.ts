import { AxlHttpClient } from "./http-client.js";
import type { Transport } from "@swati/core/interfaces";
import type { Result } from "@swati/core";
import { ok, err } from "@swati/core";

const POLL_INTERVAL_MS = 100;

export interface AxlTransportConfig {
  endpoint?: string;
}

export class AxlTransport implements Transport {
  private readonly client: AxlHttpClient;
  private peerId: string | null = null;
  private closed = false;
  private readonly messageQueue: Array<{ from: string; bytes: Uint8Array }> =
    [];
  private wakeResolve: (() => void) | null = null;

  constructor(cfg: AxlTransportConfig = {}) {
    const endpoint =
      cfg.endpoint ?? process.env["AXL_ENDPOINT"] ?? "http://localhost:9002";
    this.client = new AxlHttpClient(endpoint);
    this.startPolling();
  }

  async selfId(): Promise<string> {
    if (this.peerId) return this.peerId;
    const topology = await this.client.getTopology();
    this.peerId = topology.our_public_key;
    return this.peerId;
  }

  async send(peerId: string, bytes: Uint8Array): Promise<Result<void>> {
    try {
      await this.client.sendMessage(peerId, bytes);
      return ok(undefined);
    } catch (cause) {
      return err(
        "TRANSPORT_SEND_FAILED",
        `AXL send to peer ${peerId.slice(0, 12)}… failed: ${(cause as Error).message}`,
        cause,
      );
    }
  }

  async broadcast(bytes: Uint8Array): Promise<Result<void>> {
    let topology;
    try {
      topology = await this.client.getTopology();
    } catch (cause) {
      return err(
        "TRANSPORT_BROADCAST_FAILED",
        "AXL topology fetch failed during broadcast",
        cause,
      );
    }

    const activePeers = topology.peers.filter((p) => p.up);
    await Promise.all(
      activePeers.map((p) =>
        this.client.sendMessage(p.public_key, bytes).catch(() => {}),
      ),
    );
    return ok(undefined);
  }

  recv(): AsyncIterable<{ from: string; bytes: Uint8Array }> {
    const queue = this.messageQueue;
    const setWake = (r: (() => void) | null) => {
      this.wakeResolve = r;
    };
    const isClosed = () => this.closed;

    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (true) {
              if (queue.length > 0) {
                return { done: false as const, value: queue.shift()! };
              }
              if (isClosed()) {
                return { done: true as const, value: undefined as never };
              }
              await new Promise<void>((resolve) => setWake(resolve));
            }
          },
        };
      },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.wakeResolve?.();
    this.wakeResolve = null;
  }

  private startPolling(): void {
    (async () => {
      while (!this.closed) {
        try {
          const msg = await this.client.recvMessage();
          if (msg && msg.fromPeerId) {
            this.messageQueue.push({ from: msg.fromPeerId, bytes: msg.data });
            this.wakeResolve?.();
            this.wakeResolve = null;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    })();
  }
}
