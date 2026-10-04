export {
  SERVER_HOST,
  SERVER_PORTS,
  connectLink,
  pairingFromFragment,
  socketUrl,
} from "./domain/pairing";
export type { Pairing, PairingSource } from "./domain/pairing";
export {
  PAIRING_STORAGE_KEY,
  parseStoredPairing,
  serializePairing,
} from "./domain/pairingStorage";
export { listenOnFirstFreePort } from "./infrastructure/firstFreePort";
export { pairingLinks } from "./infrastructure/pairingLinks";
