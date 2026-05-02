import { keccak256, toHex, fromHex } from "viem";

export function manifestIdToBytes32(manifestId: string): `0x${string}` {
  const match = manifestId.match(/^swati:([0-9a-f]{64})\//);
  if (!match?.[1]) {
    throw new Error(
      `Invalid swati manifest ID: "${manifestId}". Expected format: swati:<64-char-hex>/<name>`,
    );
  }
  return `0x${match[1]}` as `0x${string}`;
}

export function bytes32ToHex(bytes32: `0x${string}`): string {
  return bytes32.slice(2).toLowerCase();
}

export function pubkeyToHash(pubkeyHex: string): `0x${string}` {
  const normalized = pubkeyHex.startsWith("0x") ? pubkeyHex : `0x${pubkeyHex}`;
  return keccak256(toHex(normalized));
}

export function verifyPubkeyHash(pubkeyHex: string, onChainHash: `0x${string}`): boolean {
  return pubkeyToHash(pubkeyHex) === onChainHash.toLowerCase();
}
