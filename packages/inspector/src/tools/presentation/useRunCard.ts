import { useCallback, useMemo, useState, type FormEvent } from "react";

import type { ToolArguments } from "../../runs";
import { needsInput } from "../application/needsInput";
import {
  argumentsFromJson,
  argumentsToJson,
  fieldsOf,
  initialArguments,
  signatureOf,
  withArgument,
} from "../domain/fields";
import type { FormField } from "../domain/fillForm";
import type { LocatorGroup } from "../domain/locatorGroups";
import type { RunCardProps } from "./RunCard";

/** The JSON editor's text, and its syntax error, if any. */
export type JsonState = {
  text?: string;
  error?: string;
  /** Where the syntax error is, 1-based. */
  position?: { line: number; column: number };
};

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
  argumentViolations,
  schemaText,
  onRun,
}: RunCardProps) {
  const fields = useMemo(
    () =>
      fieldsOf(tool.argumentsSchema, {
        ref: tool.refField,
        key: tool.keyField,
        typeOf: schemaText.type,
      }),
    [tool.argumentsSchema, tool.refField, tool.keyField, schemaText]
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
  const [json, setJson] = useState<JsonState>();
  // While the JSON editor is open: how its arguments break the tool's schema.
  const violations = useMemo(
    () =>
      json && !json.error && argumentViolations ? argumentViolations(args) : [],
    [json, args, argumentViolations]
  );
  // The fields that can't be sent as they are; while any is, Run doesn't run.
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const setValidity = useCallback(
    (path: string, valid: boolean) =>
      setInvalid((current) => {
        if (valid !== current.has(path)) return current;
        const next = new Set(current);
        if (valid) next.delete(path);
        else next.add(path);
        return next;
      }),
    []
  );
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
    if (json?.error || violations.length || invalid.size) return;
    if (!collection) onRun(args);
    else if (target) onRun({ ref: target.ref, args }, target);
  };

  return {
    head,
    signature: signatureOf(tool.argumentsSchema, schemaText.signature),
    fields,
    args,
    json,
    violations,
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
    invalid:
      invalid.size > 0 || json?.error !== undefined || violations.length > 0,
    setValidity,
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
      } else
        setJson({
          text,
          error: parsed.error,
          ...(parsed.position ? { position: parsed.position } : {}),
        });
    },
    /** Pretty-prints the JSON, once it's valid. */
    formatJson: () => {
      if (!json?.error) setJson({ text: argumentsToJson(args) });
    },
  };
}
