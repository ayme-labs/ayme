// Plays the human with raw CDP input. It arrives like real input (trusted,
// through the browser's input pipeline) and is not a Playwright action, so it
// never collides with what the gate re-sends through page.mouse/page.keyboard.
import { sleep } from "./pw.mjs";

const KEYS = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Tab: { code: "Tab", vk: 9 },
  Escape: { code: "Escape", vk: 27 },
  Backspace: { code: "Backspace", vk: 8 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  F8: { code: "F8", vk: 119 },
  " ": { code: "Space", vk: 32, text: " " },
};
const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

function describeKey(key) {
  if (KEYS[key]) return { key, ...KEYS[key] };
  if (key.length === 1) {
    const upper = key.toUpperCase();
    const isLetter = upper >= "A" && upper <= "Z";
    const isDigit = key >= "0" && key <= "9";
    return {
      key,
      code: isLetter ? `Key${upper}` : isDigit ? `Digit${key}` : "",
      vk: isLetter || isDigit ? upper.charCodeAt(0) : 0,
      text: key,
    };
  }
  throw new Error(`human: no key table entry for ${key}`);
}

export async function createHuman(context, page) {
  const cdp = await context.newCDPSession(page);
  const mouse = (type, x, y, extra = {}) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "none",
      pointerType: "mouse",
      ...extra,
    });

  const human = {
    cdp,
    /** Centre of a locator in main-frame viewport coordinates. */
    async centre(locator) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      return [box.x + box.width / 2, box.y + box.height / 2];
    },
    async move(x, y) {
      await mouse("mouseMoved", x, y);
    },
    async click(
      x,
      y,
      { button = "left", clickCount = 1, holdMs = 70, modifiers = 0 } = {}
    ) {
      const buttons = button === "left" ? 1 : button === "right" ? 2 : 4;
      await mouse("mouseMoved", x, y, { modifiers });
      await mouse("mousePressed", x, y, {
        button,
        buttons,
        clickCount,
        modifiers,
      });
      await sleep(holdMs);
      await mouse("mouseReleased", x, y, {
        button,
        buttons: 0,
        clickCount,
        modifiers,
      });
    },
    async clickOn(locator, options) {
      const [x, y] = await human.centre(locator);
      await human.click(x, y, options);
    },
    async dblclick(x, y) {
      await human.click(x, y, { clickCount: 1, holdMs: 50 });
      await sleep(90);
      await human.click(x, y, { clickCount: 2, holdMs: 50 });
    },
    async drag(from, to, { steps = 8, holdMs = 60 } = {}) {
      await mouse("mouseMoved", from[0], from[1]);
      await mouse("mousePressed", from[0], from[1], {
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await sleep(holdMs);
      for (let i = 1; i <= steps; i += 1) {
        await mouse(
          "mouseMoved",
          from[0] + ((to[0] - from[0]) * i) / steps,
          from[1] + ((to[1] - from[1]) * i) / steps,
          { button: "left", buttons: 1 }
        );
        await sleep(15);
      }
      await mouse("mouseReleased", to[0], to[1], {
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
    },
    async key(key, { modifiers = [], holdMs = 40 } = {}) {
      const k = describeKey(key);
      const bits = modifiers.reduce((sum, m) => sum | MODIFIER_BITS[m], 0);
      const base = {
        key: k.key,
        code: k.code,
        windowsVirtualKeyCode: k.vk,
        nativeVirtualKeyCode: k.vk,
        modifiers: bits,
      };
      const text = bits & ~MODIFIER_BITS.Shift ? undefined : k.text;
      await cdp.send("Input.dispatchKeyEvent", {
        type: text ? "keyDown" : "rawKeyDown",
        ...base,
        ...(text ? { text, unmodifiedText: text } : {}),
      });
      await sleep(holdMs);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    },
    async type(text, { delay = 60 } = {}) {
      for (const char of text) {
        await human.key(char, { holdMs: 20 });
        await sleep(delay);
      }
    },
  };
  return human;
}
