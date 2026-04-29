export type PeerStatus = "active" | "suspected" | "unknown";

export interface FailureDetector {
  recordHeartbeat(peer: string): void;
  status(peer: string): PeerStatus;
  suspected(): string[];
}

export function makeFailureDetector(timeoutMs: number): FailureDetector {
  const lastSeen = new Map<string, number>();

  return {
    recordHeartbeat(peer: string): void {
      lastSeen.set(peer, Date.now());
    },

    status(peer: string): PeerStatus {
      const ts = lastSeen.get(peer);
      if (ts === undefined) return "unknown";
      return Date.now() - ts > timeoutMs ? "suspected" : "active";
    },

    suspected(): string[] {
      const now = Date.now();
      return [...lastSeen.entries()]
        .filter(([, ts]) => now - ts > timeoutMs)
        .map(([peer]) => peer);
    },
  };
}
