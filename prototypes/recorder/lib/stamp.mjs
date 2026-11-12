// Ways to get a package ref into a stock trace snapshot, as the DOM attribute
// the shipped skill reads (`__playwright_aria_ref__`). The released recorder
// patched Playwright to write it; stock Playwright keeps a ref only as a
// JavaScript property (`_ariaRef`) in its utility world, which a trace does not
// record. Each way here writes the attribute onto the live element before the
// trace point is taken, and `unstampRefs` removes it right after.
//
//   locators  public API only: one `locator('aria-ref=<ref>')` call per node.
//   private   Playwright's own server objects, reached in-process through the
//             client connection (`_connection.toImpl`): one evaluate per frame
//             in the utility world, reading `_ariaRef` off every element.
//   mirror    public API only, an init script (see MIRROR_INIT_SCRIPT): an
//             accessor on Element.prototype in the page's main world. It only
//             sees refs assigned in the main world.
export const STAMP_ATTR = "__playwright_aria_ref__";

const isPackageRef = (ref) => /^(f\d+)*e\d+$/.test(ref);

export async function stampRefs(page, tree, how) {
  const refs = tree.getAllRefs().filter(isPackageRef);
  const started = Date.now();
  let stamped = 0;
  if (how === "locators") {
    const results = await Promise.all(
      refs.map((ref) =>
        page
          .locator(`aria-ref=${ref}`)
          .evaluate(
            (el, [attr, value]) => el.setAttribute(attr, value),
            [STAMP_ATTR, ref]
          )
          .then(
            () => 1,
            () => 0
          )
      )
    );
    stamped = results.reduce((a, b) => a + b, 0);
  } else if (how === "private") {
    const toImpl = page._connection?.toImpl;
    if (!toImpl) throw new Error("stamp: Playwright does not run in-process");
    const wanted = new Set(refs);
    for (const frame of page.frames()) {
      const impl = toImpl(frame);
      const context = await (impl.utilityContext?.() ?? impl._utilityContext());
      const injected = await context.injectedScript();
      stamped += await injected.evaluate(
        (injected, { attr, refs }) => {
          const wanted = new Set(refs);
          let n = 0;
          const visit = (root) => {
            for (const el of root.querySelectorAll("*")) {
              const ref = el._ariaRef?.ref;
              if (ref && wanted.has(ref)) {
                el.setAttribute(attr, ref);
                n += 1;
              }
              if (el.shadowRoot) visit(el.shadowRoot);
            }
          };
          visit(document);
          return n;
        },
        { attr: STAMP_ATTR, refs: [...wanted] }
      );
    }
  } else if (how === "mirror") {
    // the init script did the work, if it could
    for (const frame of page.frames())
      stamped += await frame
        .evaluate(
          (attr) => document.querySelectorAll(`[${attr}]`).length,
          STAMP_ATTR
        )
        .catch(() => 0);
  } else throw new Error(`stamp: unknown way ${how}`);
  return { how, wanted: refs.length, stamped, ms: Date.now() - started };
}

export async function unstampRefs(page) {
  for (const frame of page.frames())
    await frame
      .evaluate((attr) => {
        const visit = (root) => {
          for (const el of root.querySelectorAll("*")) {
            el.removeAttribute(attr);
            if (el.shadowRoot) visit(el.shadowRoot);
          }
        };
        visit(document);
      }, STAMP_ATTR)
      .catch(() => {});
}

/** The `mirror` way: whenever main-world code sets `_ariaRef`, copy the ref into the attribute. */
export const MIRROR_INIT_SCRIPT = `(() => {
  const store = new WeakMap();
  Object.defineProperty(Element.prototype, '_ariaRef', {
    configurable: true,
    get() { return store.get(this); },
    set(value) {
      store.set(this, value);
      if (value && typeof value.ref === 'string') this.setAttribute(${JSON.stringify(STAMP_ATTR)}, value.ref);
    },
  });
})()`;
