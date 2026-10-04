export { BUSY_SERVER, SERVER_IDENTITY } from "./domain/admission";
export { busyRefuses } from "./domain/busyServer";
export {
  SERVER_HOST,
  SERVER_PORTS,
  connectLink,
  pairingFromFragment,
  socketUrl,
} from "./domain/pairing";
export type { Pairing, PairingSource } from "./domain/pairing";
export type { StoredPairing } from "./domain/pairingStorage";
export {
  PAIRING_STORAGE_KEY,
  parseStoredPairing,
  serializePairing,
} from "./domain/pairingStorage";
export { admit } from "./domain/admission";
export { autoPairing } from "./infrastructure/autoPairing";
export {
  listenOnFirstFreePort,
  listenOnPort,
} from "./infrastructure/firstFreePort";
export { pairingLinks } from "./infrastructure/pairingLinks";
export {
  forgetStoredPairing,
  storedPairing,
  storedTabId,
} from "./infrastructure/storedPairing";
