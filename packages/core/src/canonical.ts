import { utf8ToBytes } from "@noble/hashes/utils";

export function canonicalBytes(value: unknown): Uint8Array {
  return utf8ToBytes(canonicalJson(value));
}

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!isFinite(value))
      throw new Error("Non-finite numbers are not canonical");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Uint8Array) return JSON.stringify(bufferToHex(value));
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const sorted = Object.keys(value as Record<string, unknown>).sort();
    const pairs = sorted.map((k) => {
      const v = (value as Record<string, unknown>)[k];
      return JSON.stringify(k) + ":" + canonicalJson(v);
    });
    return "{" + pairs.join(",") + "}";
  }
  throw new Error(`Cannot canonicalize type: ${typeof value}`);
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
