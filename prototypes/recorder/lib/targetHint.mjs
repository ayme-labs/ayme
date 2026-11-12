// Where a target that is not in the tree sits, as of the moment of the action.
//
// Playwright's recorder takes its event snapshot in the page's main world and
// leaves each element it put in that snapshot tagged with its ref (`_ariaRef`,
// a private detail, present in 1.62 to 1.65). Right after the recorder has
// handled an event, this script reads those tags off the target's ancestor
// chain. Node then picks the nearest ancestor whose ref is in the action's
// event snapshot, and the classifier maps it to the public tree.
//
// It reads nothing about what the human did (no kind, value or selector):
// only which ancestors of the target Playwright's own snapshot contains.
const IN_PAGE = () => {
  if (window.__aymeTargetHint) return;
  window.__aymeTargetHint = true;
  const report = (e) => {
    if (!e.isTrusted) return;
    const chain = [];
    for (
      let n = e.composedPath()[0];
      n && n.nodeType === 1;
      n = n.parentElement ?? n.getRootNode()?.host
    )
      chain.push(n._ariaRef?.ref ?? null);
    window.__aymeTargetChain?.({ type: e.type, chain });
  };
  // Playwright's recorder listens on `document` in the capture phase; a capture
  // listener on the root element runs right after it.
  const install = () => {
    for (const type of ["click", "auxclick", "contextmenu", "keydown", "input"])
      document.documentElement.addEventListener(type, report, true);
  };
  if (document.documentElement) install();
  else
    new MutationObserver((_, observer) => {
      if (document.documentElement) {
        observer.disconnect();
        install();
      }
    }).observe(document, { childList: true });
};

const TYPES = {
  click: ["click", "auxclick", "contextmenu"],
  check: ["click", "keydown"],
  uncheck: ["click", "keydown"],
  press: ["keydown"],
  fill: ["input"],
  select: ["input"],
};

export async function installTargetHints(context) {
  const reports = new WeakMap();
  await context.exposeBinding("__aymeTargetChain", ({ page }, report) => {
    const list = reports.get(page) ?? [];
    list.push(report);
    if (list.length > 20) list.shift();
    reports.set(page, list);
  });
  const script = `(${IN_PAGE.toString()})()`;
  await context.addInitScript(script);
  for (const page of context.pages())
    for (const frame of page.frames())
      await frame.evaluate(script).catch(() => {});
  return {
    dump: (page) => (reports.get(page) ?? []).slice(-3),
    /**
     * For an action whose target is not in its event snapshot: the ref (event
     * numbering) of the target's nearest ancestor that is.
     */
    nearestAncestorRef(page, action, eventTree) {
      const types = TYPES[action.name] ?? [];
      const list = reports.get(page) ?? [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const { type, chain } = list[i];
        if (!types.includes(type)) continue;
        if (chain[0] !== null && eventTree.hasNode(chain[0])) continue; // that target was in the tree
        const ref = chain
          .slice(1)
          .find((r) => r !== null && eventTree.hasNode(r));
        if (ref) return ref;
      }
      return undefined;
    },
  };
}
