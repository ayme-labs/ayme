import { useEffect, useMemo, useRef, useState } from "react";

import type { Run } from "../../runs";
import {
  addTarget,
  groupOutcomes,
  initialGroups,
  setContainer,
  toggleTarget,
  type LocatorGroup,
} from "../domain/locatorGroups";
import { refTreeRows, type RefSource } from "../domain/refTree";

/**
 * The locator form's UI logic: the groups it edits, the tree that adds
 * targets to one group, picking targets on the page one after another, and
 * what the last run gave each target.
 */
export function useLocatorGroups({
  source,
  lastRun,
  onChange,
}: {
  source: RefSource;
  lastRun: Run | undefined;
  onChange: (groups: LocatorGroup[]) => void;
}) {
  const [groups, setGroups] = useState<LocatorGroup[]>(() => [
    ...initialGroups,
  ]);
  const [treeOpen, setTreeOpen] = useState<number>();
  const [query, setQuery] = useState("");
  const [pickingInto, setPickingInto] = useState<number>();
  const [copied, setCopied] = useState<string>();
  const stopPicking = useRef<() => void>(undefined);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => onChange(groups), [groups, onChange]);
  useEffect(
    () => () => {
      stopPicking.current?.();
      clearTimeout(copiedTimer.current);
    },
    []
  );

  const outcomes = useMemo(
    () => groupOutcomes(groups, lastRun),
    [groups, lastRun]
  );
  const rows =
    treeOpen === undefined ? [] : refTreeRows(source.roots, { query });

  const endPicking = () => {
    stopPicking.current?.();
    stopPicking.current = undefined;
    setPickingInto(undefined);
  };
  // Each click on the page adds a target and picks again, until Esc.
  const pickInto = (index: number) => {
    stopPicking.current = source.onPick?.({
      accept: () => true,
      onEnd: (ref) => {
        if (ref === undefined) {
          stopPicking.current = undefined;
          setPickingInto(undefined);
          return;
        }
        setGroups((current) => addTarget(current, index, ref));
        pickInto(index);
      },
    });
  };

  return {
    groups,
    outcomes,
    rows,
    query,
    setQuery,
    treeOpen,
    pickingInto,
    canPick: source.onPick !== undefined,
    copied,
    onPreview: source.onPreview,
    onPreviewEnd: source.onPreviewEnd,
    toggleTarget: (index: number, ref: string) =>
      setGroups((current) => toggleTarget(current, index, ref)),
    setContainer: (index: number, within: string | undefined) =>
      setGroups((current) => setContainer(current, index, within)),
    addGroup: () => setGroups((current) => [...current, { targets: [] }]),
    removeGroup: (index: number) => {
      endPicking();
      setTreeOpen(undefined);
      setGroups((current) => current.filter((_, at) => at !== index));
    },
    toggleTree: (index: number) => {
      setQuery("");
      setTreeOpen(treeOpen === index ? undefined : index);
    },
    togglePicking: (index: number) => {
      const again = pickingInto === index;
      endPicking();
      if (again) return;
      setPickingInto(index);
      pickInto(index);
    },
    copy: (locator: string) => {
      void navigator.clipboard?.writeText(locator).then(() => {
        setCopied(locator);
        clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(undefined), 1200);
      });
    },
  };
}
