// Stryker disable all
// Picking a Structural Ref by pointing at the document: the pointer hovers
// elements that carry a ref, a click picks one, Esc cancels. Part of the page
// part, so it is built into the install function with the rest.

/** What picking tells its host as the pointer moves: the ref hovered and whether it can be picked. */
export type PickNotice = { ref: string; usable: boolean } | { ref?: undefined };

export type PickArguments = {
  /** The refs that can be picked; the element of any other ref shows greyed. */
  accept: readonly string[];
  /** A CSS selector for the subtrees picking leaves alone: no hover, no blocked press. */
  ignore?: string;
};

/**
 * Starts picking in this document and answers when it ends: with the ref
 * clicked, or with none when Esc cancels or `cancel` is called.
 *
 * @param refOf the ref an element was given, if any.
 * @param notify tells the host what the pointer is over.
 */
export function startPicking(
  { accept, ignore }: PickArguments,
  refOf: (element: Element) => string | undefined,
  notify: (notice: PickNotice) => void
): { result: Promise<string | undefined>; cancel(): void } {
  const usable = new Set(accept);
  let end!: (ref: string | undefined) => void;
  const result = new Promise<string | undefined>((resolve) => (end = resolve));

  const style = document.createElement("style");
  style.dataset.aymePicking = "";
  style.textContent = [
    "html, html * { cursor: crosshair !important; }",
    ...(ignore ? [`${ignore}, ${ignore} * { cursor: auto !important; }`] : []),
  ].join("\n");
  document.head.append(style);

  const inIgnored = (event: Event) =>
    ignore !== undefined &&
    event
      .composedPath()
      .some((node) => node instanceof Element && node.matches(ignore));

  /** The element with a ref at an event's target, climbing out of shadow roots. */
  const pointedAt = (target: EventTarget | undefined) => {
    for (
      let element = target as Element | null | undefined;
      element instanceof Element;
      element =
        element.parentElement ??
        ((element.getRootNode() as ShadowRoot).host as Element | undefined)
    ) {
      const ref = refOf(element);
      if (ref !== undefined) return { ref, usable: usable.has(ref) };
    }
  };

  let told: string | undefined;
  const show = (pointed: ReturnType<typeof pointedAt>) => {
    if (pointed?.ref === told) return;
    told = pointed?.ref;
    notify(pointed ?? {});
  };

  const onMove = (event: PointerEvent) =>
    show(inIgnored(event) ? undefined : pointedAt(event.composedPath()[0]));
  // Presses on the page pick; the page itself never sees them.
  const block = (event: Event) => {
    if (inIgnored(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onClick = (event: MouseEvent) => {
    if (inIgnored(event)) return;
    block(event);
    const picked = pointedAt(event.composedPath()[0]);
    if (picked?.usable) stop(picked.ref);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stop(undefined);
  };

  // Every press but the click, which picks: a double click on an element
  // that can't be picked, or a right or middle press, never reaches the page.
  const blocked = [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "dblclick",
    "auxclick",
    "contextmenu",
  ];
  let stopped = false;
  const stop = (ref: string | undefined) => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKey, true);
    for (const type of blocked) window.removeEventListener(type, block, true);
    style.remove();
    show(undefined);
    end(ref);
  };

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);
  for (const type of blocked) window.addEventListener(type, block, true);
  return { result, cancel: () => stop(undefined) };
}
