import { describe, expect, it } from "vitest";

import {
  PAIRING_STORAGE_KEY,
  parseStoredPairing,
  serializePairing,
} from "./pairingStorage";

const PAIRING = {
  address: "ws://127.0.0.1:9350",
  token: "abc_123",
  tab: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
};

describe("serializePairing", () => {
  it("keeps the address, token and tab id, which parseStoredPairing reads back", () => {
    const stored = serializePairing(PAIRING);

    expect(JSON.parse(stored)).toEqual(PAIRING);
    expect(parseStoredPairing(stored)).toEqual(PAIRING);
  });

  it("keeps only the stored fields", () => {
    const stored = serializePairing({ ...PAIRING, extra: true } as never);

    expect(JSON.parse(stored)).toEqual(PAIRING);
  });
});

describe("parseStoredPairing", () => {
  it("reads a pairing stored without a tab id", () => {
    expect(
      parseStoredPairing('{"address":"ws://127.0.0.1:9350","token":"abc"}')
    ).toEqual({ address: "ws://127.0.0.1:9350", token: "abc" });
  });

  it.each([null, "", "not json", '{"address":"ws://127.0.0.1:9350"}'])(
    "reads %j as no pairing",
    (value) => {
      expect(parseStoredPairing(value)).toBeUndefined();
    }
  );
});

// apps/mcp-fixture and apps/example-certification read the pairing under this key.
it("keeps the pairing under the key the e2e tests read", () => {
  expect(PAIRING_STORAGE_KEY).toBe("ayme:agent-connection");
});
