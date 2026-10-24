import { describe, expect, it } from "vitest";

import { ToolInputError } from "../../shared";
import { navigationDestination } from "./navigationDestination";

const BASE = "https://app.test/projects/list";
const ORIGIN = "https://app.test";

const destination = (url: string) =>
  navigationDestination(url, BASE, ORIGIN)?.href;

describe("navigationDestination", () => {
  it("resolves a path against the document's base URL", () => {
    expect(destination("/settings")).toBe("https://app.test/settings");
    expect(destination("detail?id=2")).toBe(
      "https://app.test/projects/detail?id=2"
    );
  });

  it("takes a URL on the page's own origin as it is", () => {
    expect(destination("https://app.test/a#b")).toBe("https://app.test/a#b");
  });

  it("has no destination for a string that is no URL", () => {
    expect(destination("http://")).toBeUndefined();
  });

  it.each([
    ["javascript:alert(1)", "javascript:"],
    ["blob:https://app.test/0b5e", "blob:"],
    ["data:text/html,<p>Hi</p>", "data:"],
  ])("refuses %s, whose protocol is not http(s)", (url, protocol) => {
    expect(() => destination(url)).toThrow(
      new ToolInputError(
        `Cannot navigate to "${url}": the protocol ${protocol} is not supported.`
      )
    );
  });

  it("refuses a URL on another origin", () => {
    const url = "https://other.test/";
    expect(() => destination(url)).toThrow(
      new ToolInputError(
        `Cannot navigate to "${url}": it is not on the page's own origin, ${ORIGIN}. Leaving the origin would lose the connection to this page.`
      )
    );
  });
});
