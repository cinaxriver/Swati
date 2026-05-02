const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface MeshPeer {
  uri: string;
  up: boolean;
  inbound: boolean;
  public_key: string;
  root: string;
  port: number;
  coords: number[] | null;
}

export interface MeshTreeEntry {
  public_key: string;
  parent: string;
  sequence: number;
}

export interface MeshSnapshot {
  our_ipv6: string;
  our_public_key: string;
  peers: MeshPeer[] | null;
  tree: MeshTreeEntry[] | null;
}

export interface InboundPacket {
  sourcePeer: string;
  data: Uint8Array;
}

export class NodeLink {
  private readonly base: string;

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/$/, "");
  }

  async snapshot(): Promise<MeshSnapshot> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/topology`);
    } catch (cause) {
      throw new Error(`AXL node unreachable at ${this.base}`, { cause });
    }
    if (!res.ok) {
      throw new Error(`AXL /topology → ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<MeshSnapshot>;
  }

  async awaitReady(opts: { attempts?: number; delayMs?: number } = {}): Promise<void> {
    const { attempts = 60, delayMs = 500 } = opts;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.snapshot();
        return;
      } catch {
        if (i === attempts - 1) {
          throw new Error(
            `AXL node at ${this.base} did not become ready after ${attempts * delayMs}ms`,
          );
        }
        await pause(delayMs);
      }
    }
  }

  async awaitPeers(
    minCount: number,
    opts: { timeoutMs?: number; delayMs?: number } = {},
  ): Promise<void> {
    const { timeoutMs = 60_000, delayMs = 500 } = opts;
    const cutoff = Date.now() + timeoutMs;
    while (Date.now() < cutoff) {
      try {
        const snap = await this.snapshot();
        const connected = (snap.peers ?? []).filter((p) => p.up).length;
        if (connected >= minCount) return;
      } catch {}
      await pause(delayMs);
    }
    console.warn(`[node-link] awaitPeers: wanted ${minCount} — mesh may be partial, proceeding`);
  }

  async emit(destPeer: string, data: Uint8Array): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Destination-Peer-Id": destPeer,
        },
        body: data as unknown as BodyInit,
      });
    } catch (cause) {
      throw new Error(`AXL node unreachable at ${this.base}`, { cause });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AXL /send → ${res.status}: ${body}`.trim());
    }
  }

  async poll(): Promise<InboundPacket | null> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/recv`);
    } catch {
      return null;
    }
    if (res.status === 204) return null;
    if (!res.ok) return null;

    const sourcePeer = res.headers.get("x-from-peer-id") ?? "";
    const data = new Uint8Array(await res.arrayBuffer());
    return { sourcePeer, data };
  }
}
