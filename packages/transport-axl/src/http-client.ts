export interface AxlTopologyPeer {
  uri: string;
  up: boolean;
  inbound: boolean;
  public_key: string;
  root: string;
  port: number;
  coords: number[] | null;
}

export interface AxlTopologyTree {
  public_key: string;
  parent: string;
  sequence: number;
}

export interface AxlTopology {
  our_ipv6: string;
  our_public_key: string;
  peers: AxlTopologyPeer[] | null;
  tree: AxlTopologyTree[] | null;
}

export interface AxlReceivedMessage {
  fromPeerId: string;
  data: Uint8Array;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class AxlHttpClient {
  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint.replace(/\/$/, "");
  }

  async getTopology(): Promise<AxlTopology> {
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/topology`);
    } catch (cause) {
      throw new Error(
        `AXL daemon unreachable at ${this.endpoint}. ` +
          `Is it running? `,
        { cause },
      );
    }
    if (!res.ok) {
      throw new Error(`axls /topology returned ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<AxlTopology>;
  }

  async waitForReady(
    opts: { retries?: number; intervalMs?: number } = {},
  ): Promise<void> {
    const { retries = 60, intervalMs = 500 } = opts;
    for (let i = 0; i < retries; i++) {
      try {
        await this.getTopology();
        return;
      } catch {
        if (i === retries - 1)
          throw new Error(
            `AXL daemon at ${this.endpoint} did not become ready after ${retries * intervalMs}ms`,
          );
        await sleep(intervalMs);
      }
    }
  }

  async waitForPeers(
    minCount: number,
    opts: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<void> {
    const { timeoutMs = 60_000, intervalMs = 500 } = opts;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const topo = await this.getTopology();
        const count = (topo.peers ?? []).filter((p) => p.up).length;
        if (count >= minCount) return;
      } catch {
      }
      await sleep(intervalMs);
    }
    console.warn(
      `[axl] waitForPeers: wanted ${minCount}, mesh may be partial — proceeding anyway`,
    );
  }

  async sendMessage(destPeerId: string, data: Uint8Array): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Destination-Peer-Id": destPeerId,
        },
        body: data,
      });
    } catch (cause) {
      throw new Error(
        `AXL daemon unreachable at ${this.endpoint}. ` +
          `Is it running? `,
        { cause },
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`axls /send failed (${res.status}): ${detail}`.trim());
    }
  }

  async sendJson(destPeerId: string, payload: unknown): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    return this.sendMessage(destPeerId, bytes);
  }

  async recvMessage(): Promise<AxlReceivedMessage | null> {
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/recv`);
    } catch {
      return null;
    }
    if (res.status === 204) return null;
    if (!res.ok) return null;

    const fromPeerId = res.headers.get("x-from-peer-id") ?? "";
    const data = new Uint8Array(await res.arrayBuffer());
    return { fromPeerId, data };
  }

  async recvJson(): Promise<{ data: unknown; fromPeerId: string } | null> {
    const msg = await this.recvMessage();
    if (!msg) return null;
    return {
      data: JSON.parse(new TextDecoder().decode(msg.data)),
      fromPeerId: msg.fromPeerId,
    };
  }

  async pollRecv(
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<AxlReceivedMessage> {
    const { intervalMs = 200, timeoutMs = 30_000 } = opts;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await this.recvMessage();
      if (msg) return msg;
      await sleep(intervalMs);
    }
    throw new Error(`axls /recv timed out after ${timeoutMs}ms`);
  }
}
