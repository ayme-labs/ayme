import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { findRefNode, refTreeRows, type RefSource } from "../domain/refTree";

/**
 * A ref field's UI logic: the tree that opens on a press and closes on a
 * press outside it, its search, and picking a ref by pointing at the page.
 */
export function useRefField({
  value,
  onChange,
  source,
}: {
  value: string;
  onChange: (ref: string | undefined) => void;
  source: RefSource;
}) {
  const {
    roots,
    canUse,
    onPick,
    pickPrompt = "Click an element on the page",
    onPreview,
    onPreviewEnd,
  } = source;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLButtonElement>(null);
  const stopPicking = useRef<() => void>(undefined);
  // Picking outlives renders: it judges refs by the tree as it is now.
  const latest = useRef({ roots, canUse });
  useEffect(() => {
    latest.current = { roots, canUse };
  });

  const chosen = value ? findRefNode(roots, value) : undefined;
  const rows = open ? refTreeRows(roots, { query, canUse }) : [];

  const close = () => {
    setOpen(false);
    setQuery("");
    onPreviewEnd?.();
  };
  const choose = (ref: string) => {
    onChange(ref);
    close();
    chooser.current?.focus();
  };
  const endPicking = () => {
    stopPicking.current?.();
    stopPicking.current = undefined;
    setPicking(false);
  };

  // The tree closes on a press outside the field. The panel's shadow root
  // may be closed: a window listener sees its presses only as the host's,
  // so the root's own listener judges those.
  useEffect(() => {
    const field = wrap.current;
    if (!open || !field) return;
    const root = field.getRootNode();
    const host = root instanceof ShadowRoot ? root.host : undefined;
    const dismiss = () => {
      setOpen(false);
      setQuery("");
      onPreviewEnd?.();
    };
    const onPagePress = (event: Event) => {
      if (!(host && event.composedPath().includes(host))) dismiss();
    };
    const onRootPress = (event: Event) => {
      if (!event.composedPath().includes(field)) dismiss();
    };
    window.addEventListener("pointerdown", onPagePress, true);
    root.addEventListener("pointerdown", onRootPress, true);
    return () => {
      window.removeEventListener("pointerdown", onPagePress, true);
      root.removeEventListener("pointerdown", onRootPress, true);
    };
  }, [open, onPreviewEnd]);
  useEffect(() => () => stopPicking.current?.(), []);

  const togglePicking = () => {
    if (picking) return endPicking();
    if (!onPick) return;
    close();
    setPicking(true);
    stopPicking.current = onPick({
      accept: (ref) => {
        const { roots, canUse } = latest.current;
        const node = findRefNode(roots, ref);
        // A node the tree doesn't show yet is left for the tool to judge.
        return !node || !canUse || canUse(node);
      },
      onEnd: (ref) => {
        stopPicking.current = undefined;
        setPicking(false);
        if (ref !== undefined) onChange(ref);
      },
    });
  };

  const onTreeKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
    chooser.current?.focus();
  };
  const onSearchKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    // Enter chooses the first match the tool can use; it never submits.
    event.preventDefault();
    const first = rows.find((row) => row.match && row.usable);
    if (first) choose(first.node.ref);
  };

  const toggleTree = () => {
    if (open) return close();
    endPicking();
    setOpen(true);
  };

  return {
    open,
    query,
    setQuery,
    picking,
    pickPrompt,
    canPick: onPick !== undefined,
    wrap,
    chooser,
    chosen,
    rows,
    choose,
    toggleTree,
    togglePicking,
    endPicking,
    onTreeKey,
    onSearchKey,
    onPreview,
    onPreviewEnd,
  };
}
