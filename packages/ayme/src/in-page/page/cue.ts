// Stryker disable all
// Demo Mode's click cue: a ring that fades out where a click will land.

/** Shows the cue at the centre of `element`'s box and answers when it has gone. */
export async function showCue(element: Element): Promise<void> {
  const document = element.ownerDocument;
  const window = document.defaultView;
  const bounds = element.getBoundingClientRect();
  if (!window || !bounds.width || !bounds.height) return;

  const cue = document.createElement("div");
  cue.dataset.demoClickCue = "";
  cue.setAttribute("aria-hidden", "true");
  Object.assign(cue.style, {
    background: "rgb(77 126 219 / 18%)",
    border: "2px solid rgb(77 126 219 / 80%)",
    borderRadius: "999px",
    height: "2rem",
    left: `${bounds.left + bounds.width / 2}px`,
    pointerEvents: "none",
    position: "fixed",
    top: `${bounds.top + bounds.height / 2}px`,
    transform: "translate(-50%, -50%)",
    width: "2rem",
    zIndex: "2147483647",
  });
  document.body.append(cue);
  try {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    cue.animate(
      reducedMotion
        ? [{ opacity: 0.9 }, { opacity: 0 }]
        : [
            { opacity: 0.9, transform: "translate(-50%, -50%) scale(0.95)" },
            { opacity: 0, transform: "translate(-50%, -50%) scale(1.35)" },
          ],
      {
        duration: 160,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "forwards",
      }
    );
    await new Promise((resolve) => window.setTimeout(resolve, 160));
  } finally {
    cue.remove();
  }
}
