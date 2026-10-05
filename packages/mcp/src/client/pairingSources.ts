import {
  autoPairing,
  pairingLinks,
  storedPairing,
  type PairingSource,
} from "../pairing";

/** How the page client learns which server to pair with. */
export const pairingSources: readonly PairingSource[] = [
  pairingLinks,
  storedPairing,
  autoPairing,
];
