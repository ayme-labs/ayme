import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { useGlide } from "./useGlide";

// Unit tests: the glide where the browser has no matchMedia, as in jsdom.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("moves the panel at once where the browser can't say whether motion is reduced", () => {
  expect(window.matchMedia).toBeUndefined();
  let move = () => {};
  function Panel() {
    const panel = useRef<HTMLDivElement>(null);
    const glide = useGlide(panel);
    const [left, setLeft] = useState(0);
    move = () => {
      glide.from();
      setLeft(100);
    };
    return <div ref={panel} style={{ left }} />;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Panel />));

  act(() => move());

  expect(container.firstElementChild).toHaveProperty("style.left", "100px");
  act(() => root.unmount());
});
