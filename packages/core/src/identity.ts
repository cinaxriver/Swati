import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalBytes } from "./canonical.js";
import type { Identity, Pubkey, Signature } from "./types.js";

export async function generateIdentity(name?: string): Promise<Identity> {
  const privateKey = ed.utils.randomPrivateKey();
  const pubkey = await ed.getPublicKeyAsync(privateKey);
  return name !== undefined
    ? { pubkey, privateKey, name }
    : { pubkey, privateKey };
}

export async function loadIdentityFromFile(path: string): Promise<Identity> {
  const { readFileSync } = await import("node:fs");
  const raw = JSON.parse(readFileSync(path, "utf-8")) as {
    privateKey: string;
    name?: string;
  };
  const privBytes = new Uint8Array(
    raw.privateKey.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
  const pubkey = await ed.getPublicKeyAsync(privBytes);
  return raw.name !== undefined
    ? { privateKey: privBytes, pubkey, name: raw.name }
    : { privateKey: privBytes, pubkey };
}

export async function loadIdentityFromHex(
  hex: string,
  name?: string,
): Promise<Identity> {
  const privBytes = new Uint8Array(
    hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
  const pubkey = await ed.getPublicKeyAsync(privBytes);
  return name !== undefined
    ? { privateKey: privBytes, pubkey, name }
    : { privateKey: privBytes, pubkey };
}

export async function sign(
  privateKey: Uint8Array,
  value: unknown,
): Promise<Signature> {
  const bytes = canonicalBytes(value);
  return ed.signAsync(bytes, privateKey);
}

export async function verify(
  pubkey: Pubkey,
  signature: Signature,
  value: unknown,
): Promise<boolean> {
  try {
    const bytes = canonicalBytes(value);
    return ed.verifyAsync(signature, bytes, pubkey);
  } catch {
    return false;
  }
}

export function hashBytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function pubkeyToHex(pubkey: Pubkey): string {
  return Array.from(pubkey)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToPubkey(hex: string): Pubkey {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
