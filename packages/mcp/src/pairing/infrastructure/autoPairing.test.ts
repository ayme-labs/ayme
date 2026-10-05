import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROBE_PATH, SERVER_IDENTITY } from "../domain/admission";
import { SERVER_PORTS } from "../domain/pairing";
import { PAIRING_STORAGE_KEY } from "../domain/pairingStorage";
import { autoPairing } from "./autoPairing";

const PORT_COUNT = SERVER_PORTS.last - SERVER_PORTS.first + 1;
const SERVER = `ws://127.0.0.1:${SERVER_PORTS.first + 3}`;

/** A probe the scan opened, which the test answers. */
class FakeProbe extends EventTarget {
  static opened: FakeProbe[] = [];
  constructor(readonly url: string) {
    super();
    FakeProbe.opened.push(this);
  }
  close() {}
  answer(isServer: boolean) {
    const event = Object.assign(new Event("close"), {
      code: isServer ? SERVER_IDENTITY.code : 1006,
      reason: isServer ? SERVER_IDENTITY.reason : "",
    });
    this.dispatchEvent(event);
  }
}

/** Answers every open probe, as if only `servers` were running. */
async function answerScan(servers: readonly string[] = []) {
  const probes = FakeProbe.opened.splice(0);
  expect(probes).toHaveLength(PORT_COUNT);
  for (const probe of probes)
    probe.answer(servers.some((server) => probe.url === server + PROBE_PATH));
  await new Promise((resolve) => setTimeout(resolve));
}

let storage: Map<string, string>;
let page: EventTarget;
let tabDocument: EventTarget & { visibilityState: string };

beforeEach(() => {
  FakeProbe.opened = [];
  storage = new Map();
  page = new EventTarget();
  tabDocument = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  vi.stubGlobal("WebSocket", FakeProbe);
  vi.stubGlobal("document", tabDocument);
  vi.stubGlobal(
    "window",
    Object.assign(page, {
      location: { hostname: "localhost", hash: "" },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
      },
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("autoPairing", () => {
  it("scans again when an unpaired tab gains focus, and pairs with the server started since", async () => {
    const onPairing = vi.fn();
    autoPairing(onPairing);
    await answerScan();
    expect(onPairing).not.toHaveBeenCalled();

    page.dispatchEvent(new Event("focus"));
    await answerScan([SERVER]);

    expect(onPairing).toHaveBeenCalledExactlyOnceWith({
      address: SERVER,
      token: "",
    });
  });

  it("scans again when the tab becomes visible, but not when it is hidden", async () => {
    autoPairing(() => {});
    await answerScan();

    tabDocument.visibilityState = "hidden";
    tabDocument.dispatchEvent(new Event("visibilitychange"));
    expect(FakeProbe.opened).toHaveLength(0);

    tabDocument.visibilityState = "visible";
    tabDocument.dispatchEvent(new Event("visibilitychange"));
    expect(FakeProbe.opened).toHaveLength(PORT_COUNT);
  });

  it("runs one scan at a time", () => {
    autoPairing(() => {});

    page.dispatchEvent(new Event("focus"));
    page.dispatchEvent(new Event("focus"));

    expect(FakeProbe.opened).toHaveLength(PORT_COUNT);
  });

  it("stops scanning once it paired the tab", async () => {
    autoPairing(() => {});
    await answerScan([SERVER]);

    page.dispatchEvent(new Event("focus"));

    expect(FakeProbe.opened).toHaveLength(0);
  });

  it("stops scanning once another source paired the tab", async () => {
    const onPairing = vi.fn();
    autoPairing(onPairing);
    await answerScan();
    storage.set(PAIRING_STORAGE_KEY, "{}");

    page.dispatchEvent(new Event("focus"));
    storage.clear();
    page.dispatchEvent(new Event("focus"));

    expect(FakeProbe.opened).toHaveLength(0);
    expect(onPairing).not.toHaveBeenCalled();
  });

  it("stops scanning once it is stopped, and drops a scan in flight", async () => {
    const onPairing = vi.fn();
    const stop = autoPairing(onPairing);

    stop();
    await answerScan([SERVER]);
    page.dispatchEvent(new Event("focus"));

    expect(onPairing).not.toHaveBeenCalled();
    expect(FakeProbe.opened).toHaveLength(0);
  });
});
