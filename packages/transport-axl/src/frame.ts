const MAGIC = 0x53574654;
const HEADER_SIZE = 105;
const FIELD_WIDTH = 32;

export interface WireFrame {
  choreographyId: string;
  sequence: number;
  senderRole: string;
  sig: string;
  payload: Uint8Array;
}

function writeField(view: DataView, offset: number, s: string): void {
  const encoded = new TextEncoder().encode(s);
  for (let i = 0; i < FIELD_WIDTH; i++) {
    view.setUint8(offset + i, i < encoded.length ? encoded[i]! : 0);
  }
}

function readField(view: DataView, offset: number): string {
  const acc: number[] = [];
  for (let i = 0; i < FIELD_WIDTH; i++) {
    const b = view.getUint8(offset + i);
    if (b === 0) break;
    acc.push(b);
  }
  return new TextDecoder().decode(new Uint8Array(acc));
}

export function encodeFrame(frame: WireFrame): Uint8Array {
  const out = new Uint8Array(HEADER_SIZE + frame.payload.length);
  const view = new DataView(out.buffer);

  view.setUint32(0, MAGIC, false);
  view.setUint8(4, 0x01);
  writeField(view, 5, frame.choreographyId);
  view.setUint32(37, frame.sequence, false);
  writeField(view, 41, frame.senderRole);

  const sigBytes = frame.sig
    ? hexToBytes(frame.sig.slice(0, 64))
    : new Uint8Array(32);
  out.set(sigBytes.slice(0, 32), 73);
  out.set(frame.payload, HEADER_SIZE);
  return out;
}

export function decodeFrame(bytes: Uint8Array): WireFrame | null {
  if (bytes.length < HEADER_SIZE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== MAGIC) return null;
  if (view.getUint8(4) !== 0x01) return null;

  return {
    choreographyId: readField(view, 5),
    sequence: view.getUint32(37, false),
    senderRole: readField(view, 41),
    sig: bytesToHex(bytes.slice(73, 105)),
    payload: bytes.slice(HEADER_SIZE),
  };
}

function hexToBytes(hex: string): Uint8Array {
  const len = Math.floor(hex.length / 2);
  const result = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return result;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
