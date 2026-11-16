// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { startNavigation } from "./navigation";

describe("startNavigation without the Navigation API", () => {
  it("waits for the browser Page's call to end", async () => {
    // jsdom's window has no `navigation`, as in a browser without the API.
    let end!: () => void;
    const started = vi.fn();
    void startNavigation(
      document,
      () => new Promise<void>((resolve) => (end = resolve))
    ).then(started);
    await Promise.resolve();
    await Promise.resolve();
    expect(started).not.toHaveBeenCalled();

    end();
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
  });
});
