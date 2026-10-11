import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUSY_SERVER, PROBE_PATH, SERVER_IDENTITY } from "../domain/admission";
import { SERVER_PORTS } from "../domain/pairing";
import { PAIRING_STORAGE_KEY } from "../domain/pairingStorage";
import { autoPairing } from "./autoPairing";

const PORT_COUNT = SERVER_PORTS.last - SERVER_PORTS.first + 1;
const SERVER = `ws://127.0.0.1:${SERVER_PORTS.first + 3}`;
const OTHER_SERVER = `ws://127.0.0.1:${SERVER_PORTS.first + 5}`;

/** A probe the scan opened, which the test answers. */
class FakeProbe extends EventTarget {
  static opened: FakeProbe[] = [];
  constructor(readonly url: string) {
    super();
    FakeProbe.opened.push(this);
  }
  closed = false;
  close() {
    this.closed = true;
  }
  answer(as: "server" | "busy" | { code: number; reason: string } | undefined) {
    const { code, reason } =
      as === "server"
        ? SERVER_IDENTITY
        : as === "busy"
          ? BUSY_SERVER
          : (as ?? { code: 1006, reason: "" });
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason }));
  }
}

/**
 * Answers every open probe, as if only `servers` were running, and `busy`
 * besides them, busy with another tab.
 */
async function answerScan(
  servers: readonly string[] = [],
  busy: readonly string[] = []
) {
  const probes = FakeProbe.opened.splice(0);
  expect(probes).toHaveLength(PORT_COUNT);
  const at = (addresses: readonly string[], probe: FakeProbe) =>
    addresses.some((address) => probe.url === address + PROBE_PATH);
  for (const probe of probes)
    probe.answer(
      at(servers, probe) ? "server" : at(busy, probe) ? "busy" : undefined
    );
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

  it("with lookNow false, waits for the tab's next focus before it scans", async () => {
    autoPairing(() => {}, { lookNow: false });
    await new Promise((resolve) => setTimeout(resolve));
    expect(FakeProbe.opened).toHaveLength(0);

    page.dispatchEvent(new Event("focus"));

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

  it.each([
    ["no server answers", [], [], "no-server"],
    ["several servers answer", [SERVER, OTHER_SERVER], [], "several-servers"],
    ["the only server is busy with another tab", [], [SERVER], "other-tab"],
  ] as const)(
    "says why it did not pair when %s",
    async (_case, servers, busy, reason) => {
      const onUnpaired = vi.fn();
      autoPairing(() => {}, { onUnpaired });

      await answerScan(servers, busy);

      expect(onUnpaired).toHaveBeenCalledExactlyOnceWith(reason);
    }
  );

  it("counts a port only when it answers with both the server's close code and reason", async () => {
    const onUnpaired = vi.fn();
    autoPairing(() => {}, { onUnpaired });
    const answers = [
      { code: SERVER_IDENTITY.code, reason: "Something else." },
      { code: 1000, reason: SERVER_IDENTITY.reason },
      { code: BUSY_SERVER.code, reason: "Something else." },
      { code: 1000, reason: BUSY_SERVER.reason },
    ];

    for (const [index, probe] of FakeProbe.opened.splice(0).entries())
      probe.answer(answers[index]);
    await new Promise((resolve) => setTimeout(resolve));

    expect(onUnpaired).toHaveBeenCalledExactlyOnceWith("no-server");
  });

  it("gives up on a port that does not answer, and closes its probe", async () => {
    vi.useFakeTimers();
    const onUnpaired = vi.fn();
    autoPairing(() => {}, { onUnpaired });
    const probes = [...FakeProbe.opened];

    await vi.runAllTimersAsync();

    expect(probes.every((probe) => probe.closed)).toBe(true);
    expect(onUnpaired).toHaveBeenCalledExactlyOnceWith("no-server");
    vi.useRealTimers();
  });

  it("pairs with the one free server beside a busy one", async () => {
    const onPairing = vi.fn();
    const onUnpaired = vi.fn();
    autoPairing(onPairing, { onUnpaired });

    await answerScan([SERVER], [OTHER_SERVER]);

    expect(onPairing).toHaveBeenCalledExactlyOnceWith({
      address: SERVER,
      token: "",
    });
    expect(onUnpaired).not.toHaveBeenCalled();
  });

  it("says a page off localhost never looks for a server", () => {
    window.location.hostname = "app.example.com";
    const onUnpaired = vi.fn();

    autoPairing(() => {}, { onUnpaired });

    expect(onUnpaired).toHaveBeenCalledExactlyOnceWith("not-local");
    expect(FakeProbe.opened).toHaveLength(0);
  });

  it("needs no one to tell off localhost", () => {
    window.location.hostname = "app.example.com";

    expect(() => autoPairing(() => {})).not.toThrow();
  });

  it("says nothing off localhost when the tab already has a pairing", () => {
    window.location.hostname = "app.example.com";
    storage.set(PAIRING_STORAGE_KEY, "{}");
    const onUnpaired = vi.fn();

    autoPairing(() => {}, { onUnpaired });

    expect(onUnpaired).not.toHaveBeenCalled();
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
