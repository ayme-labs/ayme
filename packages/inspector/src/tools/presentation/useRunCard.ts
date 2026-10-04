import { useCallback, useMemo, useState, type FormEvent } from "react";

import type { ToolArguments } from "../../runs";
import { needsInput } from "../application/needsInput";
import {
  argumentsFromJson,
  fieldsOf,
  initialArguments,
  signatureOf,
  withArgument,
} from "../domain/fields";
import type { FormField } from "../domain/fillForm";
import type { LocatorGroup } from "../domain/locatorGroups";
import type { RunCardProps } from "./RunCard";

/**
 * A run card's UI logic: its arguments (typed, as JSON, or fill_form's
 * fields), whether its form is open, the item it runs on, its last runs,
 * and what Run does. With nothing to fill in, Run runs at once; otherwise
 * the first press opens the form and the next one runs.
 */
export function useRunCard({
  tool,
  available,
  head = true,
  item,
  items = [],
  structuralRef,
  runs,
  onRun,
}: RunCardProps) {
  const fields = useMemo(
    () =>
      fieldsOf(tool.argumentsSchema, {
        ref: tool.refField,
        key: tool.keyField,
      }),
    [tool.argumentsSchema, tool.refField, tool.keyField]
  );
  // The field the given ref fills: a Custom Tool's `ref`, a Browser Tool's `target`.
  const refField =
    structuralRef === undefined
      ? undefined
      : fields.find((field) => field.kind === "ref")?.name;
  const [args, setArgs] = useState(() => {
    const initial = initialArguments(tool.argumentsSchema);
    return refField
      ? withArgument(initial, [refField], structuralRef)
      : initial;
  });
  const [json, setJson] = useState<{ text?: string; error?: string }>();
  const [open, setOpen] = useState(false);
  const [pickedPath, setPickedPath] = useState<string>();
  const setFormFields = useCallback(
    (formFields: FormField[]) => setArgs({ fields: formFields }),
    []
  );
  const setGroups = useCallback(
    (groups: LocatorGroup[]) => setArgs({ groups }),
    []
  );

  const collection = tool.collection !== undefined;
  const picking = collection && !item;
  const target =
    item ??
    items.find((candidate) => candidate.path === pickedPath) ??
    items[0];
  const canOpen = fields.length > 0 || picking;
  const showBody = available && (!head || open);
  const needs = needsInput(tool, {
    itemGiven: item !== undefined,
    givenArguments: refField ? [refField] : [],
  });

  const cardRuns = collection
    ? runs.filter((run) => run.item?.path === target?.path)
    : runs;
  const last = cardRuns[0];
  const lastSuccess = cardRuns.find((run) => run.status === "succeeded");
  const running = last?.status === "running";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!available || running) return;
    if (head && needs && !open) {
      setOpen(true);
      return;
    }
    if (json?.error) return;
    if (!collection) onRun(args);
    else if (target) onRun({ ref: target.ref, args }, target);
  };

  return {
    head,
    signature: signatureOf(tool.argumentsSchema),
    fields,
    args,
    json,
    open,
    collection,
    picking,
    target,
    canOpen,
    showBody,
    needs,
    last,
    lastSuccess,
    running,
    submit,
    setFormFields,
    setGroups,
    toggleOpen: () => setOpen(!open),
    pickItem: setPickedPath,
    showJson: (shown: boolean) => setJson(shown ? {} : undefined),
    changeArgument: (
      path: readonly string[],
      value: ToolArguments[string] | undefined
    ) => setArgs((current) => withArgument(current, path, value)),
    changeJson: (text: string) => {
      const parsed = argumentsFromJson(text);
      if (parsed.ok) {
        setArgs(parsed.arguments);
        setJson({ text });
      } else setJson({ text, error: parsed.error });
    },
  };
}
