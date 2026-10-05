import type { PairingSource } from "../domain/pairing";
import { pairingFromFragment } from "../domain/pairing";
import { storePairing } from "./storedPairing";

/**
 * Pairs from a connect link: reads `#ayme=` from the address bar on load and
 * on every hash change, keeps the pairing in sessionStorage for the tab, and
 * removes the fragment from the address bar without reloading.
 */
export const pairingLinks: PairingSource = (onPairing) => {
  const read = () => {
    const pairing = pairingFromFragment(window.location.hash);
    if (!pairing) return;
    storePairing(pairing);
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, "", pathname + search);
    onPairing(pairing);
  };
  read();
  window.addEventListener("hashchange", read);
  return () => window.removeEventListener("hashchange", read);
};
