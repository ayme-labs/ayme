import type { Pairing } from "./pairing";

/** The sessionStorage key that keeps the tab's pairing across reloads. */
export const PAIRING_STORAGE_KEY = "ayme:agent-connection";

export function serializePairing(pairing: Pairing): string {
  return JSON.stringify({ address: pairing.address, token: pairing.token });
}

/** The stored pairing, or `undefined` when the value is not one. */
export function parseStoredPairing(
  value: string | null | undefined
): Pairing | undefined {
  if (!value) return undefined;
  try {
    const { address, token } = JSON.parse(value) as Partial<Pairing>;
    return typeof address === "string" && typeof token === "string"
      ? { address, token }
      : undefined;
  } catch {
    return undefined;
  }
}
