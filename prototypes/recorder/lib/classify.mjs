// Step 2, the free "before". Playwright's recorder hands each action an aria
// snapshot it took in the browser at the moment of the action (the event
// snapshot, E). It is frame-local and numbered differently from the public
// snapshots, so it is used only to classify: for every change between the
// previous public snapshot (P) and the next one (N), was it already there when
// the action happened?
//
// The answer is expressed as a virtual "before" tree B made of public nodes:
// - a change already visible in E is taken into B (it happened earlier),
// - a change not yet visible in E is left out of B (the interaction made it),
// - a node only E has (appeared after P, gone in N) enters B with an `s_` ref,
// - a node P and N have but E lacks (gone after P, back in N) is left out of B.
// Then reconcile(P, B) is what changed between interactions ("unassigned") and
// reconcile(B, N) is what the interaction changed. E itself is never rendered.
//
// E is matched to the public trees by role, name, contents and position, and
// by count where siblings are truly identical: among identical siblings the
// ones present in both P and N are matched first, so E having one more or one
// fewer than P decides whether an added or removed sibling was already so.
import { StructuralNode } from "../../../packages/core/dist/index.mjs";
import { reconcile } from "./core.mjs";

const SEP = "\u0001";
const kindOf = (node) => node.status?.kind;
const nodeKids = (node) => node.children.filter((c) => typeof c !== "string");
const directText = (node) =>
  node.children.filter((c) => typeof c === "string").join("\u0002");

// Focus is left out: the event snapshot is taken after pointerdown, so it
// already shows the focus the interaction itself moved.
const selfSig = (node, text = directText(node)) =>
  [
    node.role,
    node.name,
    node.state.checked ?? "",
    node.state.disabled ?? "",
    node.state.expanded ?? "",
    node.state.selected ?? "",
    node.state.pressed ?? "",
    node.state.level ?? "",
    node.cursorPointer ? "p" : "",
    JSON.stringify(node.props),
    text,
  ].join(SEP);

const idKey = (node, kids = nodeKids(node)) =>
  `${node.role}${SEP}${node.name !== "" ? node.name : kids.length > 0 ? "" : directText(node)}`;

/**
 * @param prev   StructuralTree of the previous public snapshot (P)
 * @param next   StructuralTree of the next public snapshot (N)
 * @param event  StructuralTree parsed from the action's own snapshot (E)
 * @param scopeRef public ref of the iframe node E belongs to; undefined for the main frame
 * @param action the recorder's action ({ name, ref })
 * @param locate { ref, exact }: the event-snapshot node to find in the public
 *               tree: the target itself (exact) or its nearest ancestor
 * @param parser the recording's parser (for synthetic refs and tree building)
 */
export function buildBefore({
  prev,
  next,
  event,
  scopeRef,
  action,
  locate = { ref: action.ref, exact: true },
  parser,
}) {
  const R = reconcile(prev, next);
  const stats = { matched: 0, eventOnly: 0, notInEvent: 0, targetVia: null };
  let targetRef;
  // fill and select are recorded on `input`: E already shows the target's new
  // value, options included, so the whole target subtree is taken from P.
  const targetIsAfterItsOwnChange =
    action.name === "fill" || action.name === "select";

  const pFace = (r) =>
    kindOf(r) === "added"
      ? null
      : kindOf(r) === "removed"
        ? prev.getNode(r.ref)
        : (R.getBeforeNodeForAfterRef(r.ref) ?? prev.getNode(r.ref));

  // Deep signatures: of a plain node (E or P), and of an R node as N has it.
  const pureSigs = new WeakMap();
  const pureSig = (node) => {
    let sig = pureSigs.get(node);
    if (sig === undefined) {
      const kids =
        node.role === "iframe"
          ? ""
          : node.children
              .map((c) => (typeof c === "string" ? `t:${c}` : pureSig(c)))
              .join(SEP);
      sig = `(${selfSig(node)}|${kids})`;
      pureSigs.set(node, sig);
    }
    return sig;
  };
  const nSigs = new WeakMap();
  const nSig = (r) => {
    let sig = nSigs.get(r);
    if (sig === undefined) {
      const kids =
        r.role === "iframe"
          ? ""
          : r.children
              .filter((c) => typeof c === "string" || kindOf(c) !== "removed")
              .map((c) => (typeof c === "string" ? `t:${c}` : nSig(c)))
              .join(SEP);
      sig = `(${selfSig(r)}|${kids})`;
      nSigs.set(r, sig);
    }
    return sig;
  };
  const nIdKey = (r) =>
    idKey(
      r,
      nodeKids(r).filter((c) => kindOf(c) !== "removed")
    );

  const deepMatches = (e, r) => {
    const sig = pureSig(e);
    const p = pFace(r);
    return (
      (kindOf(r) !== "removed" && sig === nSig(r)) ||
      (p !== null && p !== undefined && sig === pureSig(p))
    );
  };
  const shallowMatches = (e, r) => {
    const key = idKey(e);
    const p = pFace(r);
    return (
      (kindOf(r) !== "removed" && key === nIdKey(r)) ||
      (p !== null && p !== undefined && key === idKey(p))
    );
  };
  // Among lookalikes, nodes in both P and N come first: that is the count rule.
  const tiers = [
    (r) => kindOf(r) !== "added" && kindOf(r) !== "removed",
    (r) => kindOf(r) === "removed",
    (r) => kindOf(r) === "added",
  ];

  // A wrapper Playwright folds away when it has one child and keeps when it has
  // two: the event snapshot can have it while the public trees do not (a toast
  // next to <main> makes <body> appear).
  const isBareWrapper = (e) =>
    e.role === "generic" && e.name === "" && nodeKids(e).length > 0;

  function matchKids(eKids, rKids) {
    const eOfR = new Map();
    const matchedE = new Set();
    for (const matches of [deepMatches, shallowMatches])
      for (const e of eKids) {
        if (matchedE.has(e)) continue;
        for (const tier of tiers) {
          const hit = rKids.find(
            (r) => !eOfR.has(r) && tier(r) && matches(e, r)
          );
          if (hit === undefined) continue;
          eOfR.set(hit, e);
          matchedE.add(e);
          break;
        }
      }
    // See through an unmatched wrapper: its children may be these R siblings.
    const claimed = new Set(); // R siblings that sit inside an event-only wrapper
    const inner = new Map();
    for (const e of eKids) {
      if (matchedE.has(e) || !isBareWrapper(e)) continue;
      const free = rKids.filter((r) => !eOfR.has(r) && !claimed.has(r));
      const nested = matchKids(nodeKids(e), free);
      if (nested.eOfR.size === 0 && nested.claimed.size === 0) continue;
      inner.set(e, nested);
      for (const r of nested.eOfR.keys()) claimed.add(r);
      for (const r of nested.claimed) claimed.add(r);
    }
    // An E-only node is anchored after the R sibling its previous E sibling matched.
    const rOfE = new Map([...eOfR].map(([r, e]) => [e, r]));
    const extras = [];
    let anchor = null;
    for (const e of eKids) {
      if (matchedE.has(e)) anchor = rOfE.get(e);
      else extras.push({ after: anchor, e, nested: inner.get(e) });
    }
    return { eOfR, extras, claimed };
  }

  /** The B node of an E-only node: a wrapper around matched nodes, or a plain copy. */
  function fromEvent({ e, nested }) {
    if (!nested) return eventOnly(e);
    stats.eventOnly += 1;
    const rOfE = new Map([...nested.eOfR].map(([r, child]) => [child, r]));
    const extraOfE = new Map(nested.extras.map((extra) => [extra.e, extra]));
    const children = [];
    for (const child of e.children) {
      if (typeof child === "string") children.push(child);
      else if (rOfE.has(child)) {
        const built = present(rOfE.get(child), child);
        if (built) children.push(built);
      } else children.push(fromEvent(extraOfE.get(child)));
    }
    return new StructuralNode({
      ref: parser.factory.create(),
      role: e.role,
      name: e.name,
      state: { ...e.state, active: undefined },
      cursorPointer: e.cursorPointer,
      props: { ...e.props },
      children,
    });
  }

  /** A node only the event snapshot has, copied with synthetic refs. */
  function eventOnly(e) {
    stats.eventOnly += 1;
    const ref = parser.factory.create();
    if (locate.ref && e.ref === locate.ref) {
      targetRef = ref;
      stats.targetVia = "event-only node";
    }
    return new StructuralNode({
      ref,
      role: e.role,
      name: e.name,
      state: { ...e.state, active: undefined },
      cursorPointer: e.cursorPointer,
      props: { ...e.props },
      children: e.children.map((c) =>
        typeof c === "string" ? c : eventOnly(c)
      ),
    });
  }

  /** P's version of an R node as it stands: the fallback where E says nothing. */
  const asInPrev = (r) => pFace(r) ?? null;

  /**
   * Puts a B node together: self from one face, node children in R's order,
   * each text child after the sibling it followed in that face.
   */
  function assemble(r, face, builtOfKid, extras) {
    const p = pFace(r);
    const source = face === "p" && p ? p : r;
    const rKids = nodeKids(r);
    const rKidOfSource =
      source === r
        ? (child) => child
        : (child) => rKids.find((kid) => pFace(kid)?.ref === child.ref);
    const textAfter = new Map();
    let last = null;
    for (const child of source.children) {
      if (typeof child !== "string") {
        last = rKidOfSource(child) ?? last;
        continue;
      }
      const list = textAfter.get(last) ?? [];
      list.push(child);
      textAfter.set(last, list);
    }
    const children = [];
    const emitAfter = (anchor) => {
      children.push(...(textAfter.get(anchor) ?? []));
      for (const extra of extras)
        if (extra.after === anchor) children.push(fromEvent(extra));
    };
    emitAfter(null);
    for (const kid of rKids) {
      const built = builtOfKid(kid);
      if (built) children.push(built);
      emitAfter(kid);
    }
    return source.copy({
      ref: r.ref,
      status: undefined,
      childListOrderRelevant: false,
      state: { ...source.state, active: p ? p.state.active : undefined },
      children,
    });
  }

  /** The B node for R node `r`, which E shows as `e`. */
  function present(r, e) {
    stats.matched += 1;
    const located = Boolean(locate.ref) && e.ref === locate.ref;
    if (located) {
      targetRef = r.ref;
      stats.targetVia = "event match";
    }
    const isTarget = located && locate.exact;
    if (isTarget && targetIsAfterItsOwnChange)
      return asInPrev(r) ?? assemble(r, "n", () => null, []);
    const p = pFace(r);
    let face = "p";
    if (kindOf(r) === "added") face = "n";
    else if (isTarget) {
      // The target's own change is the interaction's: a checkbox is already
      // toggled when its click is dispatched, a pressed button already focused.
      face = "p";
    } else if (kindOf(r) === "updated" && r.status.selfChanged && p) {
      const eSelf = selfSig(e);
      const nSelf = selfSig(r);
      if (eSelf === nSelf && eSelf !== selfSig(p)) face = "n";
    }
    // E never holds an iframe's content: keep what P had.
    if (r.role === "iframe")
      return asInPrev(r) ?? assemble(r, "n", () => null, []);
    const { eOfR, extras, claimed } = matchKids(nodeKids(e), nodeKids(r));
    return assemble(
      r,
      face,
      (kid) => (claimed.has(kid) ? null : kidAtActionTime(kid, eOfR.get(kid))),
      extras
    );
  }

  function kidAtActionTime(kid, e) {
    if (e !== undefined) return present(kid, e);
    // E does not show this node.
    if (kindOf(kid) === "added") return null; // not there yet: the interaction added it
    if (kindOf(kid) === "removed") return null; // already gone: it left before the action
    // In P and in N, yet not in E although its parent is: it was away at the
    // moment of the action (left after P, back in N). The shapes are the same,
    // so absence is evidence. E never shows what sits inside an iframe, though.
    stats.notInEvent += 1;
    return null;
  }

  /** The tree above the scope (an iframe node): P's self, the scope rebuilt. */
  function outside(r, pathRefs) {
    if (r.ref === scopeRef) {
      const { eOfR, extras, claimed } = matchKids(
        event.getRootNodes(),
        nodeKids(r)
      );
      return assemble(
        r,
        "p",
        (kid) =>
          claimed.has(kid) ? null : kidAtActionTime(kid, eOfR.get(kid)),
        extras
      );
    }
    if (!pathRefs.has(r.ref)) return kindOf(r) === "added" ? null : asInPrev(r);
    return assemble(r, "p", (kid) => outside(kid, pathRefs), []);
  }

  let roots;
  const rRoots = R.getRootNodes();
  if (scopeRef === undefined) {
    const { eOfR, extras, claimed } = matchKids(event.getRootNodes(), rRoots);
    roots = [];
    const emitExtras = (anchor) => {
      for (const extra of extras)
        if (extra.after === anchor) roots.push(fromEvent(extra));
    };
    emitExtras(null);
    for (const r of rRoots) {
      const built = claimed.has(r) ? null : kidAtActionTime(r, eOfR.get(r));
      if (built) roots.push(built);
      emitExtras(r);
    }
  } else {
    const scope = R.getNode(scopeRef);
    const path = scope ? [scope, ...R.getAncestorsOf(scopeRef)] : [];
    if (scope === null || path.some((n) => kindOf(n) === "added"))
      return {
        before: prev,
        targetRef: undefined,
        stats: { ...stats, gaveUp: "scope not in previous tree" },
      };
    const pathRefs = new Set(path.map((n) => n.ref));
    roots = rRoots.map((r) => outside(r, pathRefs)).filter(Boolean);
  }

  const root =
    roots.length === 1
      ? roots[0]
      : new StructuralNode({
          ref: "s_root",
          role: "fragment",
          name: "",
          cursorPointer: false,
          children: roots,
        });
  return { before: parser.tree(root), targetRef, stats };
}
