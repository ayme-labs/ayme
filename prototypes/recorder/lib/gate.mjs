// Step 3, the gate: block the human's input in the page, let Node take a
// public snapshot ("before"), then re-send the input through Playwright's
// public API. Playwright's recorder sits on `document` (capture); the gate
// sits on `window` (capture), which runs first, so the recorder never sees the
// swallowed input and records the re-sent one, once.
//
// Variant A swallows the whole press: pointerdown, mousedown, pointerup,
//   mouseup, click. The re-sent click fires all of them.
// Variant B lets press and release through and swallows only the final click.
//   The re-sent click's press and release are swallowed, so they do not fire a
//   second time; only its click reaches the page.
// Keys: what Playwright's recorder would record as a `press` is gated, typing
//   is not (the rule is `_shouldGenerateKeyPressFor` of its JSON record tool).
// Not gated, so they fall back to step 2: typing, native select and other
//   native pickers (the recorder ignores their mouse events too), non-left
//   buttons, and clicks with detail 0 (keyboard or label activation).

const IN_PAGE = (VARIANT) => {
  if (window.__aymeGate) return;
  const now = () => performance.now();
  const gate = {
    variant: VARIANT,
    state: "idle", // idle | waiting | replay
    pending: 0,
    replay: null,
    gesture: null,
    swallowDblclick: false,
    swallowKeyup: new Set(),
    lags: [],
    dropped: [],
    open(info) {
      gate.state = "replay";
      gate.replay = { ...info, downAt: null, downSeen: false, upSeen: false };
    },
    close() {
      gate.pending = Math.max(0, gate.pending - 1);
      gate.replay = null;
      gate.state = gate.pending > 0 ? "waiting" : "idle";
    },
  };
  window.__aymeGate = gate;

  const NATIVE_PICKERS = new Set([
    "color",
    "date",
    "datetime-local",
    "file",
    "month",
    "range",
    "time",
    "week",
  ]);
  const deepTarget = (e) => e.composedPath()[0] ?? e.target;
  // Playwright's recorder ignores mouse events on these; so does the gate.
  const skipped = (el) =>
    !el ||
    el.nodeName === "SELECT" ||
    el.nodeName === "OPTION" ||
    (el.nodeName === "INPUT" && NATIVE_PICKERS.has(el.type));
  const modifiers = (e) =>
    [
      e.altKey && "Alt",
      e.ctrlKey && "Control",
      e.metaKey && "Meta",
      e.shiftKey && "Shift",
    ].filter(Boolean);
  const stop = (e) => e.stopImmediatePropagation();
  const swallow = (e) => {
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  const notify = (payload) => {
    gate.pending += 1;
    gate.state = "waiting";
    window.__aymeGateNotify(payload);
  };

  function onMouse(e) {
    if (!e.isTrusted) return;
    // The window trial owns these events; assert picks must reach PW untouched.
    if (
      e.composedPath().some((n) => n.nodeName === "AYME-RECORDER-TRIAL") ||
      window.__aymeWindowMode === "assertingVisibility"
    )
      return;
    if (gate.state === "replay" && gate.replay.kind === "click") {
      if (e.type === "pointerdown") gate.replay.downAt = now();
      if (e.type === "click") {
        // a label forwards a second click to its control: count the first only
        if (gate.replay.downSeen) return;
        gate.replay.downSeen = true;
        gate.lags.push({
          kind: "click",
          // from the human's click to the page receiving the re-sent click
          click: now() - gate.replay.tClick,
          // from the human's press to the page receiving a press (A re-sends it)
          press: VARIANT === "A" ? gate.replay.downAt - gate.replay.tDown : 0,
        });
        return;
      }
      if (e.type === "dblclick") return;
      // B: press and release already reached the page once, from the human.
      if (VARIANT === "B") {
        if (e.type === "mousedown") swallow(e);
        else stop(e);
      }
      return;
    }
    if (gate.state === "replay") return;

    if (e.type === "dblclick") {
      if (gate.swallowDblclick) {
        gate.swallowDblclick = false;
        swallow(e);
      }
      return;
    }
    const target = deepTarget(e);
    if (VARIANT === "A") {
      if (e.type === "pointerdown") {
        if (e.button !== 0 || !e.isPrimary || skipped(target)) {
          gate.gesture = null;
          return;
        }
        gate.gesture = { tDown: now(), x: e.clientX, y: e.clientY };
        stop(e); // not preventDefault: mousedown is swallowed next, with its defaults
        return;
      }
      if (!gate.gesture) return;
      if (e.type === "mousedown") {
        swallow(e);
        return;
      }
      if (e.type === "pointerup") {
        stop(e);
        return;
      }
      if (e.type === "mouseup") {
        stop(e);
        // a press that ends without a click (a drag, a selection) is lost
        const gesture = gate.gesture;
        setTimeout(() => {
          if (gate.gesture === gesture) {
            gate.gesture = null;
            gate.dropped.push("press without click");
          }
        }, 0);
        return;
      }
      if (e.type === "click") {
        const gesture = gate.gesture;
        gate.gesture = null;
        swallow(e);
        if (e.detail >= 2) gate.swallowDblclick = true;
        notify({
          kind: "click",
          x: gesture.x,
          y: gesture.y,
          detail: e.detail,
          modifiers: modifiers(e),
          tDown: gesture.tDown,
          tClick: now(),
        });
      }
      return;
    }
    // Variant B
    if (e.type === "pointerdown") {
      gate.gesture = { tDown: now() };
      return;
    }
    if (e.type !== "click") return;
    if (e.button !== 0 || e.detail === 0 || skipped(target)) return;
    swallow(e);
    if (e.detail >= 2) gate.swallowDblclick = true;
    notify({
      kind: "click",
      x: e.clientX,
      y: e.clientY,
      detail: e.detail,
      modifiers: modifiers(e),
      tDown: gate.gesture?.tDown ?? now(),
      tClick: now(),
    });
    gate.gesture = null;
  }

  const editable = (el) =>
    el.nodeName === "TEXTAREA" ||
    el.nodeName === "INPUT" ||
    el.isContentEditable;
  // Playwright's JsonRecordActionTool._shouldGenerateKeyPressFor, 1.62 to 1.65.
  function recordedAsPress(e) {
    if (typeof e.key !== "string") return false;
    const target = deepTarget(e);
    if (
      e.key === "Enter" &&
      (target.nodeName === "TEXTAREA" || target.isContentEditable)
    )
      return false;
    if (["Backspace", "Delete", "AltGraph"].includes(e.key)) return false;
    if (e.key === "@" && e.code === "KeyL") return false;
    if (navigator.platform.includes("Mac")) {
      if (e.key === "v" && e.metaKey) return false;
    } else {
      if (e.key === "v" && e.ctrlKey) return false;
      if (e.key === "Insert" && e.shiftKey) return false;
    }
    if (["Shift", "Control", "Meta", "Alt", "Process"].includes(e.key))
      return false;
    const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
    if (e.key.length === 1 && !hasModifier) return !editable(target);
    return true;
  }

  function onKey(e) {
    if (!e.isTrusted) return;
    // The window trial owns these events; assert picks must reach PW untouched.
    if (
      e.composedPath().some((n) => n.nodeName === "AYME-RECORDER-TRIAL") ||
      window.__aymeWindowMode === "assertingVisibility"
    )
      return;
    const replaying = gate.state === "replay" && gate.replay.kind === "key";
    if (e.type === "keydown") {
      if (replaying) {
        if (!gate.replay.downSeen && e.code === gate.replay.code) {
          gate.replay.downSeen = true;
          gate.lags.push({
            kind: "key",
            click: now() - gate.replay.tDown,
            press: 0,
          });
        }
        return;
      }
      if (!recordedAsPress(e)) return; // typing is never gated
      swallow(e);
      gate.swallowKeyup.add(e.code);
      notify({
        kind: "key",
        key: e.key,
        code: e.code,
        modifiers: modifiers(e),
        tDown: now(),
      });
      return;
    }
    if (
      replaying &&
      gate.replay.downSeen &&
      !gate.replay.upSeen &&
      e.code === gate.replay.code
    ) {
      gate.replay.upSeen = true;
      return;
    }
    if (gate.swallowKeyup.has(e.code)) {
      gate.swallowKeyup.delete(e.code);
      stop(e);
    }
  }

  for (const type of [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
    "dblclick",
  ])
    window.addEventListener(type, onMouse, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
};

export const gateInitScript = (variant) =>
  `(${IN_PAGE.toString()})(${JSON.stringify(variant)})`;

/**
 * Installs the gate on a context. `onCycle(cycle)` is called at once for every
 * gated input with { kind, page, before: Promise<yaml>, replayed: Promise }.
 */
export async function installGate(context, variant, { takeBefore, onCycle }) {
  const queues = new WeakMap(); // one input at a time per page
  await context.exposeBinding("__aymeGateNotify", (source, payload) => {
    const { page, frame } = source;
    const tNotified = Date.now();
    // The before snapshot starts at once, unless an earlier input is still
    // being re-sent: then it shows the page after that one.
    const previous = queues.get(page) ?? Promise.resolve();
    const before = previous.then(() => takeBefore(page));
    const replayed = previous.then(async () => {
      const timing = { waitedMs: 0, snapshotMs: 0, replayMs: 0 };
      await before.catch(() => {});
      timing.snapshotMs = Date.now() - tNotified;
      const tReplay = Date.now();
      try {
        if (payload.kind === "click") {
          const [x, y] = await toPageCoords(page, frame, payload.x, payload.y);
          await frame.evaluate((info) => window.__aymeGate.open(info), {
            kind: "click",
            tDown: payload.tDown,
            tClick: payload.tClick,
          });
          for (const m of payload.modifiers) await page.keyboard.down(m);
          await page.mouse.move(x, y);
          const clickCount = Math.max(1, payload.detail);
          await page.mouse.down({ clickCount });
          await page.mouse.up({ clickCount });
          for (const m of payload.modifiers) await page.keyboard.up(m);
        } else {
          await frame.evaluate((info) => window.__aymeGate.open(info), {
            kind: "key",
            code: payload.code,
            tDown: payload.tDown,
          });
          const key = payload.key === " " ? "Space" : payload.key;
          const combo = [
            ...payload.modifiers.filter((m) => m !== key),
            key,
          ].join("+");
          await page.keyboard
            .press(combo)
            .catch(() =>
              page.keyboard.press(
                [...payload.modifiers, payload.code].join("+")
              )
            );
        }
      } finally {
        // the frame may be gone if the input navigated
        await frame.evaluate(() => window.__aymeGate?.close()).catch(() => {});
      }
      timing.replayMs = Date.now() - tReplay;
      return timing;
    });
    queues.set(
      page,
      replayed.catch(() => {})
    );
    onCycle({
      kind: payload.kind,
      payload,
      page,
      frame,
      before,
      replayed,
      tNotified,
    });
  });
  await context.addInitScript(gateInitScript(variant));
}

/** Frame-local client coordinates to main-frame viewport coordinates. */
async function toPageCoords(page, frame, x, y) {
  if (frame === page.mainFrame()) return [x, y];
  const element = await frame.frameElement();
  const box = await element.boundingBox(); // already in main-frame viewport coordinates
  const [left, top] = await element.evaluate((el) => {
    const style = getComputedStyle(el);
    return [
      el.clientLeft + parseFloat(style.paddingLeft),
      el.clientTop + parseFloat(style.paddingTop),
    ];
  });
  return [box.x + left + x, box.y + top + y];
}

export async function readLags(page) {
  const lags = [];
  for (const frame of page.frames())
    lags.push(
      ...(await frame
        .evaluate(() => window.__aymeGate?.lags.splice(0) ?? [])
        .catch(() => []))
    );
  return lags;
}
