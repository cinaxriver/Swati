export function resolveSwatiWalletKey(fromCli?: string): string | undefined {
  const t = fromCli?.trim();
  if (t) return t;
  const keys = ["SWATI_WALLET_KEY", "SWATI_PUBLISHER_PRIVATE_KEY", "ZEROG_PRIVATE_KEY"] as const;
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}
