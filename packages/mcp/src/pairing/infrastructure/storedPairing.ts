import type { Pairing, PairingSource } from "../domain/pairing";
import {
  PAIRING_STORAGE_KEY,
  newTabId,
  parseStoredPairing,
  type StoredPairing,
} from "../domain/pairingStorage";

function readStoredPairing(): StoredPairing | undefined {
  try {
    return parseStoredPairing(
      window.sessionStorage.getItem(PAIRING_STORAGE_KEY)
    );
  } catch {
    return undefined;
  }
}

/**
 * Pairs from the pairing the tab keeps in sessionStorage, so a reloaded or
 * navigated document reconnects by itself.
 */
export const storedPairing: PairingSource = (onPairing) => {
  const stored = readStoredPairing();
  if (stored) onPairing(stored);
  return () => {};
};

/**
 * The tab id the tab keeps with `pairing`, or a new one when it keeps
 * another pairing or none.
 */
export function storedTabId(pairing: Pairing): string {
  const stored = readStoredPairing();
  return stored?.address === pairing.address && stored.token === pairing.token
    ? stored.tab
    : newTabId();
}

/** Forgets the stored pairing, if it is still the one with tab id `tab`. */
export function forgetStoredPairing(tab: string) {
  try {
    if (readStoredPairing()?.tab === tab)
      window.sessionStorage.removeItem(PAIRING_STORAGE_KEY);
  } catch {
    // Storage is unavailable, so it keeps nothing to forget.
  }
}
