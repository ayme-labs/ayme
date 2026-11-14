import { describe, expect, it } from "vitest";

import type { RecorderUpdate } from "../../contract";
import { toolbarBridge } from "./toolbarBridge";
import type { WindowTarget } from "./windowChannelRouter";

// The toolbar's bridge on its own, with a stand-in for the recorder: a
// toolbar pulls the state one update at a time.

const update = (revision: number) =>
  ({
    revision,
    state: { phase: "notRecording", visits: [], commands: ["record"] },
  }) as unknown as RecorderUpdate;

/** A stand-in for the recorder's handle, at revision 1. */
function standIn() {
  const listeners = new Set<(update: RecorderUpdate) => void>();
  const target: WindowTarget = {
    send: () => Promise.resolve("applied"),
    subscribe(listener) {
      listeners.add(listener);
      listener(update(1));
      return () => listeners.delete(listener);
    },
  };
  return {
    target,
    publish: (revision: number) => {
      for (const listener of listeners) listener(update(revision));
    },
  };
}

describe("the toolbar's bridge", () => {
  it("wakes a toolbar that waits with the next update", async () => {
    const bridge = toolbarBridge();
    const recorder = standIn();
    bridge.attach(recorder.target);
    const waiting = bridge.answer({ kind: "update", after: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    recorder.publish(2);

    await expect(waiting).resolves.toEqual(update(2));
  });

  it("answers a toolbar that still waits when the recorder ends with nothing", async () => {
    const bridge = toolbarBridge();
    bridge.attach(standIn().target);
    const waiting = bridge.answer({ kind: "update", after: 99 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    bridge.close();

    await expect(waiting).resolves.toBeNull();
  });
});
