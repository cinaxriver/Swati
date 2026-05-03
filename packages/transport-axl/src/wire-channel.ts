import { NodeLink } from "./node-link.js";
import type { Transport } from "@swati/core/interfaces";
import type { Result } from "@swati/core";
import { ok, err } from "@swati/core";

const POLL_CADENCE_MS = 200;
const MAX_CONCURRENT_OUT = 4;

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface WireChannelOptions {
  endpoint?: string;

  targetNodes?: string[];
}

export class WireChannel implements Transport {
  private readonly link: NodeLink;
  private readonly targetNodes: string[];

  private nodeIdentity: string | null = null;
  private halted = false;
  private activeEmissions = 0;

  private readonly inboundBuffer: Array<{ from: string; bytes: Uint8Array }> = [];
  private drainTrigger: (() => void) | null = null;

  constructor(opts: WireChannelOptions = {}) {
    const endpoint = opts.endpoint ?? process.env["AXL_ENDPOINT"] ?? "http://localhost:9002";
    this.link = new NodeLink(endpoint);
    this.targetNodes = opts.targetNodes ?? [];
    this.launchEventLoop();
  }

  async selfId(): Promise<string> {
    if (this.nodeIdentity) return this.nodeIdentity;
    const snap = await this.link.snapshot();
    this.nodeIdentity = snap.our_public_key;
    return this.nodeIdentity;
  }

  async send(peerId: string, bytes: Uint8Array): Promise<Result<void>> {
    while (this.activeEmissions >= MAX_CONCURRENT_OUT) {
      await pause(50);
    }
    this.activeEmissions++;
    try {
      await this.link.emit(peerId, bytes);
      return ok(undefined);
    } catch (cause) {
      return err(
        "CHANNEL_SEND_FAILED",
        `WireChannel: send to ${peerId.slice(0, 12)}… failed`,
        cause,
      );
    } finally {
      this.activeEmissions--;
    }
  }

  async broadcast(bytes: Uint8Array): Promise<Result<void>> {
    let snap: Awaited<ReturnType<NodeLink["snapshot"]>>;
    try {
      snap = await this.link.snapshot();
    } catch (cause) {
      return err("CHANNEL_BROADCAST_FAILED", "WireChannel: broadcast snapshot failed", cause);
    }

    const activePeers = (snap.peers ?? []).filter((p) => p.up).map((p) => p.public_key);
    const targets = Array.from(new Set([...activePeers, ...this.targetNodes])).filter(
      (p) => p !== snap.our_public_key,
    );

    await Promise.all(targets.map((p) => this.link.emit(p, bytes).catch(() => {})));
    return ok(undefined);
  }

  recv(): AsyncIterable<{ from: string; bytes: Uint8Array }> {
    const buf = this.inboundBuffer;
    const setTrigger = (fn: (() => void) | null) => {
      this.drainTrigger = fn;
    };
    const isHalted = () => this.halted;

    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (true) {
              if (buf.length > 0) {
                return { done: false as const, value: buf.shift()! };
              }
              if (isHalted()) {
                return { done: true as const, value: undefined as never };
              }
              await new Promise<void>((resolve) => setTrigger(resolve));
            }
          },
        };
      },
    };
  }

  async close(): Promise<void> {
    this.halted = true;
    this.drainTrigger?.();
    this.drainTrigger = null;
  }

  async awaitReady(): Promise<void> {
    return this.link.awaitReady();
  }

  async awaitPeers(minCount: number, opts?: Parameters<NodeLink["awaitPeers"]>[1]): Promise<void> {
    return this.link.awaitPeers(minCount, opts);
  }

  private launchEventLoop(): void {
    (async () => {
      while (!this.halted) {
        try {
          const packet = await this.link.poll();

          if (packet?.data && packet.data.byteLength > 0) {
            this.inboundBuffer.push({ from: packet.sourcePeer ?? "", bytes: packet.data });
            this.drainTrigger?.();
            this.drainTrigger = null;
          }
        } catch {}
        await pause(POLL_CADENCE_MS);
      }
    })();
  }
}
