import type { Pairing } from "./pairing";

/** The sessionStorage key that keeps the tab's pairing across reloads. */
export const PAIRING_STORAGE_KEY = "ayme:agent-connection";

/**
 * A pairing as the tab keeps it: with the id the tab presents to the server
 * for it, so the server can tell this tab reconnecting from another tab.
 */
export type StoredPairing = Pairing & Readonly<{ tab: string }>;

/** A new tab id: 128 random bits as hex. */
export function newTabId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

/**
 * The stored form of `pairing`. A pairing without a tab id, such as one a
 * connect link just gave, gets a new one.
 */
export function serializePairing(pairing: Pairing | StoredPairing): string {
  const tab = "tab" in pairing ? pairing.tab : newTabId();
  return JSON.stringify({
    address: pairing.address,
    token: pairing.token,
    tab,
  });
}

/**
 * The stored pairing, or `undefined` when the value is not one. Its token
 * may be empty, and its tab id missing, as where another way of pairing
 * stored it.
 */
export function parseStoredPairing(
  value: string | null | undefined
): (Pairing & { tab?: string }) | undefined {
  if (!value) return undefined;
  try {
    const { address, token, tab } = JSON.parse(value) as Partial<StoredPairing>;
    if (typeof address !== "string" || typeof token !== "string")
      return undefined;
    return typeof tab === "string"
      ? { address, token, tab }
      : { address, token };
  } catch {
    return undefined;
  }
}
