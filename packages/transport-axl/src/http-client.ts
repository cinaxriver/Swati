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
  peers: AxlTopologyPeer[];
  tree: AxlTopologyTree[];
}

export interface AxlReceivedMessage {
  fromPeerId: string;
  data: Uint8Array;
}

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
          `Is it running?`,
        { cause },
      );
    }
    if (!res.ok) {
      throw new Error(`AXL /topology returned ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<AxlTopology>;
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
          `Is it running?`,
        { cause },
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`AXL /send failed (${res.status}): ${detail}`.trim());
    }
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
}
