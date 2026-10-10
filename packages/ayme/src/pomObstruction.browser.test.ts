import { afterEach, describe, expect, it } from "vitest";

import { findObstruction } from "./pomObstruction";

const root = () => document.querySelector("#root")!;

describe("what is in the way of an unavailable root", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  it("names the element over the root's centre", () => {
    document.body.innerHTML =
      '<section id="root" style="width:200px;height:100px">Content</section><div id="overlay" style="position:fixed;inset:0"></div>';

    expect(findObstruction(root())?.id).toBe("overlay");
  });

  it("names the open native modal the root is not in, over whatever covers the centre", () => {
    document.body.innerHTML =
      '<section id="root" style="width:200px;height:100px">Content</section><dialog id="first"><button>First</button></dialog><dialog id="second"><button>Second</button></dialog>';
    document.querySelector<HTMLDialogElement>("#first")!.showModal();
    document.querySelector<HTMLDialogElement>("#second")!.showModal();

    expect(findObstruction(root())?.id).toBe("second");
  });

  it("names the inert ancestor", () => {
    document.body.innerHTML =
      '<div id="wrapper" inert><section id="root" style="width:200px;height:100px">Content</section></div>';

    expect(findObstruction(root())?.id).toBe("wrapper");
  });

  it("names the root's own ancestor when nothing else takes the click", () => {
    document.body.style.pointerEvents = "none";
    document.body.innerHTML =
      '<section id="root" style="width:200px;height:100px">Content</section>';

    expect(findObstruction(root())).toBe(document.documentElement);
  });

  it("finds nothing for a root the viewport does not show", () => {
    document.body.innerHTML =
      '<section id="root" style="position:absolute;left:-5000px;width:200px;height:100px">Content</section>';

    expect(findObstruction(root())).toBeUndefined();
  });

  it("finds the covering element inside an open shadow root", () => {
    document.body.innerHTML =
      '<section id="root" style="width:200px;height:100px">Content</section><div id="host"></div>';
    const shadow = document
      .querySelector("#host")!
      .attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<div id="cover" style="position:fixed;inset:0;background:white"></div>';

    expect(findObstruction(root())?.id).toBe("cover");
  });
});
