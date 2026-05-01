export const TEXT_RECORD_KEYS = {
  AXL_PUBKEY: "swati.axl_pubkey",

  PUBKEY: "swati.pubkey",

  CAPS: "swati.caps",

  CHOREOGRAPHIES: "swati.choreographies",

  REP: "swati.rep",
} as const;

export type TextRecordKey =
  (typeof TEXT_RECORD_KEYS)[keyof typeof TEXT_RECORD_KEYS];

export interface SwatiEnsRecord {
  axlPubkey: string;
  pubkeyHex: string;
  caps?: string | undefined;
  choreographies?: string[] | undefined;
  rep?: string | undefined;
}

export function parseEnsRecords(
  records: Partial<Record<TextRecordKey, string>>,
): SwatiEnsRecord | null {
  const axlPubkey = records[TEXT_RECORD_KEYS.AXL_PUBKEY];
  const pubkeyHex = records[TEXT_RECORD_KEYS.PUBKEY];

  if (!axlPubkey || !pubkeyHex) return null;

  const choreosRaw = records[TEXT_RECORD_KEYS.CHOREOGRAPHIES];
  const choreographies = choreosRaw
    ? choreosRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const record: SwatiEnsRecord = { axlPubkey, pubkeyHex };
  const caps = records[TEXT_RECORD_KEYS.CAPS];
  if (caps !== undefined) record.caps = caps;
  if (choreographies !== undefined) record.choreographies = choreographies;
  const rep = records[TEXT_RECORD_KEYS.REP];
  if (rep !== undefined) record.rep = rep;
  return record;
}

export function canJoinChoreography(
  record: SwatiEnsRecord,
  choreoId: string,
): boolean {
  if (!record.choreographies || record.choreographies.length === 0) return true;
  return record.choreographies.includes(choreoId);
}
