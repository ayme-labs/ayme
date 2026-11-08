export { busyRefuses, probeAnswer } from "./domain/busyServer";
export {
  SERVER_HOST,
  SERVER_PORTS,
  connectLink,
  pairingFromFragment,
  socketUrl,
} from "./domain/pairing";
export type {
  NotConnectedReason,
  Pairing,
  PairingSource,
} from "./domain/pairing";
export type { StoredPairing } from "./domain/pairingStorage";
export {
  PAIRING_STORAGE_KEY,
  parseStoredPairing,
  serializePairing,
} from "./domain/pairingStorage";
export {
  admit,
  isLocalOrigin,
  isLocalProcess,
  isLoopbackHostHeader,
} from "./domain/admission";
export type { AymeVersion } from "./domain/versionGap";
export { OUR_AYME, versionGap } from "./domain/versionGap";
export { autoPairing } from "./infrastructure/autoPairing";
export {
  listenOnFirstFreePort,
  listenOnPort,
} from "./infrastructure/firstFreePort";
export { pairingLinks } from "./infrastructure/pairingLinks";
export { findServers } from "./infrastructure/serverScan";
export {
  forgetStoredPairing,
  storePairing,
  storedPairing,
  storedTabId,
} from "./infrastructure/storedPairing";
