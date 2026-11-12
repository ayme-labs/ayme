// This projection uses core nodes only, not the released AI presentation model.
const detail = (n) =>
  n && {
    ref: n.ref,
    role: n.role,
    text: n.name || n.children.filter((c) => typeof c === "string").join(" "),
  };
export function effects(tree) {
  const rows = [];
  function walk(node, parent) {
    const k = node.status?.kind;
    if (
      k === "added" ||
      k === "removed" ||
      (k === "updated" && node.status.selfChanged)
    ) {
      const before = tree.getBeforeNodeForAfterRef(node.ref);
      let text =
        k === "added"
          ? "appeared in"
          : k === "removed"
            ? "was removed from"
            : "changed in";
      if (k === "updated" && before?.state.checked !== node.state.checked)
        text = node.state.checked ? "became checked in" : "became unchecked in";
      rows.push({ element: detail(node), text, context: detail(parent) });
    }
    for (const c of node.children) if (typeof c !== "string") walk(c, node);
  }
  for (const n of tree.getRootNodes()) walk(n, null);
  return rows;
}
export function projectEntry(entry) {
  const p = entry.pkg;
  if (!p) return [];
  const visit = { id: p.visit.visitId, url: p.visit.url };
  const rows = effects(p.changeTree);
  const target = p.target.ref
    ? detail(p.changeTree.getNode(p.target.ref))
    : null;
  const action = entry.action;
  const title =
    action.name === "fill"
      ? `Fill '${action.text}'`
      : action.name === "press"
        ? `Press ${action.key}`
        : action.name === "assertVisible"
          ? "Assert visibility"
          : action.name[0].toUpperCase() + action.name.slice(1);
  const result = [
    {
      id: entry.interactionId,
      order: entry.index * 2 + 1,
      visit,
      title,
      target: { ...target, selector: action.selector, exact: p.target.exact },
      rows,
    },
  ];
  if (p.change) {
    const rows = effects(p.change.changeTree);
    if (rows.length)
      result.unshift({
        id: `before:${entry.interactionId}`,
        order: entry.index * 2,
        visit,
        title: "Change without interaction",
        rows,
      });
  }
  return result;
}
