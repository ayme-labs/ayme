// Runs before the gate and recorder listeners, in every frame.
export function installPageUI() {
  let mode = "recording";
  let root, toolbar, box;
  const host = document.createElement("ayme-recorder-trial");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;contain:strict!important";
  root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    *{box-sizing:border-box} aside{position:fixed;right:12px;bottom:12px;padding:8px;background:#18232e;color:white;border-radius:8px;font:13px system-ui;pointer-events:auto;display:flex;gap:8px;align-items:center}
    button{font:inherit;border:0;border-radius:4px;padding:6px;cursor:pointer} #box{position:fixed;border:2px solid #00a99d;background:#00a99d22;pointer-events:none;display:none}
  </style><div id="box"></div>`;
  box = root.getElementById("box");
  if (window === top) {
    toolbar = document.createElement("aside");
    toolbar.innerHTML =
      '<span>● Recording</span><button data-command="assert">Assert visibility</button><button data-command="finish">Finish</button>';
    root.append(toolbar);
  }
  // Throwaway probe seam: the real page cannot query our closed shadow root.
  window.__aymeWindowInspect = () => ({
    mode,
    box: box.style.cssText,
    buttons: [...(toolbar?.querySelectorAll("button") ?? [])].map((b) => ({
      command: b.dataset.command,
      rect: b.getBoundingClientRect().toJSON(),
    })),
  });
  const mount = () => {
    if (document.documentElement && !host.isConnected)
      document.documentElement.append(host);
  };
  new MutationObserver(mount).observe(document, {
    childList: true,
    subtree: true,
  });
  mount();
  window.__aymeWindowState = (state) => {
    mode = window.__aymeWindowMode = state.mode;
    if (toolbar) {
      toolbar.querySelector("span").textContent =
        state.phase === "recording"
          ? mode === "assertingVisibility"
            ? "◎ Pick visible element"
            : "● Recording"
          : state.phase;
      for (const b of toolbar.querySelectorAll("button"))
        b.disabled = state.phase !== "recording";
    }
    if (mode !== "assertingVisibility") box.style.display = "none";
  };
  window.__aymeWindowDraw = (rect) => {
    box.style.display = rect ? "block" : "none";
    if (rect)
      Object.assign(box.style, {
        left: rect.x + "px",
        top: rect.y + "px",
        width: rect.width + "px",
        height: rect.height + "px",
      });
  };
  // Stop before document's recorder handlers and the gate on window.
  for (const type of [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
    "dblclick",
    "keydown",
    "keyup",
  ]) {
    window.addEventListener(
      type,
      (e) => {
        if (!e.composedPath().includes(host)) return;
        e.stopImmediatePropagation();
        if (type === "mousedown") e.preventDefault(); // preserve the page's focus
        if (type === "click") {
          const command = root
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest("button")?.dataset.command;
          if (command) window.__aymeWindowCommand(command).catch(console.error);
        }
      },
      true
    );
  }
  window.addEventListener(
    "mousemove",
    (e) => {
      if (mode !== "assertingVisibility" || e.composedPath().includes(host))
        return;
      const el = e.composedPath()[0];
      if (el instanceof Element)
        window.__aymeWindowDraw(el.getBoundingClientRect());
    },
    true
  );
  window
    .__aymeWindowGetState()
    .then(window.__aymeWindowState)
    .catch(() => {});
  // Mutations notify Node; no polling. Ignore our UI and PW's overlay.
  let timer;
  const own = (n) => n === host || n.nodeName === "X-PW-GLASS";
  new MutationObserver((records) => {
    if (
      !records.some(
        (r) =>
          !own(r.target) &&
          (r.type !== "childList" ||
            [...r.addedNodes, ...r.removedNodes].some((n) => !own(n)))
      )
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(() => window.__aymeWindowDirty().catch(() => {}), 1000);
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
}
