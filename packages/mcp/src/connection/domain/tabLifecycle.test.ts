import { describe, expect, it } from "vitest";

import {
  attached,
  deadline,
  disconnected,
  elapsed,
  holdsPageCalls,
  navigating,
  RECONNECT_WAIT_MS as WAIT,
  reported,
  stopped,
  unpaired,
  type TabLifecycle,
} from "./tabLifecycle";

const url = "http://127.0.0.1:5173/";
/** Tab `a` paired at `url`, with its tools reported, at time 0. */
const paired = reported(attached(unpaired, "a", url, 0).lifecycle, [
  "snapshot",
]).lifecycle;
const name = (lifecycle: TabLifecycle) => lifecycle.name;

describe("the tab's lifecycle", () => {
  it("holds page calls from a new page's connecting until it reports its tools", () => {
    const connected = attached(unpaired, "a", url, 0).lifecycle;

    expect(holdsPageCalls(connected)).toBe(true);
    expect(holdsPageCalls(reported(connected, []).lifecycle)).toBe(false);
  });

  it("answers a disconnected tab's calls with how it left once the wait ends", () => {
    const left = navigating(
      paired,
      { url: `${url}other`, reload: false },
      10
    ).lifecycle;
    const away = disconnected(left, 20).lifecycle;

    expect(deadline(away)).toBe(20 + WAIT);
    expect(name(elapsed(away, 20 + WAIT - 1).lifecycle)).toBe("disconnected");
    const exit = { type: "navigated", url: `${url}other` };
    expect(elapsed(away, 20 + WAIT)).toEqual({
      lifecycle: unpaired,
      left: exit,
      held: exit,
    });
  });

  it("says the tab closed when it disconnected without saying where it went", () => {
    const away = disconnected(paired, 0).lifecycle;

    expect(elapsed(away, WAIT)).toMatchObject({ held: { type: "closed" } });
  });

  it("answers the previous document's calls with the new page's tools once it reports them", () => {
    const away = disconnected(paired, 0).lifecycle;
    const back = attached(away, "a", url, 100).lifecycle;

    expect(reported(back, ["snapshot"])).toEqual({
      lifecycle: { name: "paired", tab: "a", url },
      left: { type: "reloaded", url, tools: ["snapshot"] },
    });
  });

  it("keeps holding for a tab that reconnected just before the wait ended, and answers only the previous document's calls", () => {
    const away = disconnected(paired, 0).lifecycle;
    const back = attached(away, "a", url, WAIT - 100).lifecycle;

    const later = elapsed(back, WAIT);

    expect(later.left).toEqual({ type: "closed" });
    expect(later.held).toBeUndefined();
    expect(name(later.lifecycle)).toBe("reconnected");
    expect(deadline(later.lifecycle)).toBe(2 * WAIT - 100);
  });

  it("pairs a page that said it was navigating but is still there once the wait ends", () => {
    const to = { url: `${url}download`, reload: false };
    const left = navigating(paired, to, 0).lifecycle;

    expect(reported(left, ["snapshot"]).lifecycle).toEqual(left);
    expect(elapsed(left, WAIT)).toEqual({ lifecycle: { ...paired, to } });
  });

  it("answers with where a slow navigation went when the page leaves after the wait", () => {
    const to = { url, reload: false };
    const slow = elapsed(navigating(paired, to, 0).lifecycle, WAIT).lifecycle;
    const away = disconnected(slow, 2 * WAIT).lifecycle;

    expect(elapsed(away, 3 * WAIT)).toMatchObject({
      held: { type: "navigated", url },
    });
    const back = attached(away, "a", url, 2 * WAIT + 10).lifecycle;
    expect(reported(back, []).left).toMatchObject({ type: "navigated" });
  });

  it("answers every call when another tab's page replaces the tab", () => {
    const left = navigating(paired, { url, reload: true }, 0).lifecycle;

    expect(attached(left, "b", url, 10)).toEqual({
      lifecycle: {
        name: "reconnected",
        tab: "b",
        url,
        until: 10 + WAIT,
        replaced: ["a"],
      },
      left: { type: "replaced" },
      held: { type: "replaced" },
    });
  });

  it("keeps the earlier wait when the tab's new page leaves before reporting its tools", () => {
    const away = disconnected(paired, 0).lifecycle;
    const back = attached(away, "a", `${url}other`, 100).lifecycle;

    expect(deadline(disconnected(back, 200).lifecycle)).toBe(WAIT);
  });

  it("pairs nothing else when the first page connects", () => {
    expect(attached(unpaired, "a", url, 0)).toEqual({
      lifecycle: { name: "reconnected", tab: "a", url, until: WAIT },
    });
    expect(deadline(paired)).toBeUndefined();
  });

  it("says a page navigated, not reloaded, when it said so and comes back at the same URL", () => {
    const left = navigating(paired, { url, reload: false }, 0).lifecycle;
    const back = attached(
      disconnected(left, 10).lifecycle,
      "a",
      url,
      20
    ).lifecycle;

    expect(reported(back, ["snapshot"]).left).toEqual({
      type: "navigated",
      url,
      tools: ["snapshot"],
    });
  });

  it("answers with the newest word on where the tab went when its new page navigates before reporting its tools", () => {
    const away = disconnected(paired, 0).lifecycle;
    const back = attached(away, "a", url, 100).lifecycle;
    const again = navigating(
      back,
      { url: `${url}other`, reload: false },
      200
    ).lifecycle;
    const gone = disconnected(again, 300).lifecycle;

    expect(deadline(again)).toBe(WAIT);
    expect(elapsed(gone, WAIT)).toEqual({
      lifecycle: unpaired,
      left: { type: "navigated", url: `${url}other` },
      held: { type: "navigated", url: `${url}other` },
    });
  });

  it("answers the earlier document's calls when the tab's new page reports its tools while already navigating", () => {
    const away = disconnected(paired, 0).lifecycle;
    const back = attached(away, "a", url, 10).lifecycle;
    const again = navigating(back, { url, reload: true }, 20).lifecycle;

    expect(reported(again, ["snapshot"])).toMatchObject({
      lifecycle: { name: "navigating" },
      left: { type: "reloaded", url, tools: ["snapshot"] },
    });
  });

  it("says a page navigated when it comes back at another URL without having said where it went", () => {
    const away = disconnected(paired, 0).lifecycle;
    const back = attached(away, "a", `${url}other`, 10).lifecycle;

    expect(reported(back, []).left).toMatchObject({ type: "navigated" });
  });

  it("lets the paired tab's page connect again, as its new document", () => {
    const back = attached(paired, "a", `${url}other`, 10);

    expect(back.refused).toBeUndefined();
    expect(back.left).toBeUndefined();
    expect(back.lifecycle).toMatchObject({ name: "reconnected", tab: "a" });
  });

  it("remembers the tab another tab's page replaced", () => {
    expect(attached(paired, "b", url, 10)).toEqual({
      lifecycle: {
        name: "reconnected",
        tab: "b",
        url,
        until: 10 + WAIT,
        replaced: ["a"],
      },
      left: { type: "replaced" },
      held: { type: "replaced" },
    });
  });

  it("refuses a page of a replaced tab, and changes nothing", () => {
    const other = attached(paired, "b", url, 10).lifecycle;

    expect(attached(other, "a", url, 20)).toEqual({
      lifecycle: other,
      refused: true,
    });
  });

  it("still refuses a page of a replaced tab once no tab is paired", () => {
    const other = attached(paired, "b", url, 10).lifecycle;
    const gone = elapsed(disconnected(other, 20).lifecycle, 20 + WAIT);

    expect(name(gone.lifecycle)).toBe("unpaired");
    expect(attached(gone.lifecycle, "a", url, 30)).toMatchObject({
      refused: true,
    });
    expect(attached(stopped(other).lifecycle, "a", url, 30)).toMatchObject({
      refused: true,
    });
  });

  it("keeps the tabs it replaced as the paired tab navigates, leaves and comes back", () => {
    const to = { url: `${url}other`, reload: false };
    const other = attached(paired, "b", url, 10).lifecycle;
    const ready = reported(other, ["snapshot"]).lifecycle;
    const slow = elapsed(navigating(ready, to, 20).lifecycle, 20 + WAIT);
    const away = disconnected(slow.lifecycle, 30 + WAIT).lifecycle;
    const back = attached(away, "b", `${url}other`, 40 + WAIT).lifecycle;
    const again = reported(back, ["snapshot"]).lifecycle;

    expect(again).toMatchObject({ name: "paired", replaced: ["a"] });
    expect(attached(again, "a", url, 50 + WAIT).refused).toBe(true);
  });

  it("ignores what can't happen without a page: a navigation, a channel closing again, time passing", () => {
    const away = disconnected(paired, 0).lifecycle;

    expect(navigating(away, { url, reload: true }, 10)).toEqual({
      lifecycle: away,
    });
    expect(navigating(unpaired, { url, reload: true }, 10)).toEqual({
      lifecycle: unpaired,
    });
    expect(disconnected(away, 10)).toEqual({ lifecycle: away });
    expect(disconnected(unpaired, 10)).toEqual({ lifecycle: unpaired });
    expect(elapsed(unpaired, WAIT)).toEqual({ lifecycle: unpaired });
    expect(reported(unpaired, [])).toEqual({ lifecycle: unpaired });
    expect(reported(away, [])).toEqual({ lifecycle: away });
  });
});
