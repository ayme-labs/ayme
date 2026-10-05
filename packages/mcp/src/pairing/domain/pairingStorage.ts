import type { Pairing } from "./pairing";

/** The sessionStorage key that keeps the tab's pairing across reloads. */
export const PAIRING_STORAGE_KEY = "ayme:agent-connection";

/**
 * A pairing as the tab keeps it: with the id the tab presents to the server
 * for it, so the server can tell this tab reconnecting from another tab.
 */
export type StoredPairing = Pairing & Readonly<{ tab: string }>;

/** The stored form of `pairing`. */
export function serializePairing(pairing: StoredPairing): string {
  return JSON.stringify({
    address: pairing.address,
    token: pairing.token,
    tab: pairing.tab,
  });
}

/**
 * The stored pairing, or `undefined` when the value is not one. Its tab id
 * may be missing, as where another way of pairing stored it.
 */
export function parseStoredPairing(
  value: string | null | undefined
): (Pairing & { tab?: string }) | undefined {
  if (!value) return undefined;
  try {
    const { address, token, tab } = JSON.parse(value) as Partial<StoredPairing>;
    if (typeof address !== "string" || typeof token !== "string" || !token)
      return undefined;
    return typeof tab === "string"
      ? { address, token, tab }
      : { address, token };
  } catch {
    return undefined;
  }
}
