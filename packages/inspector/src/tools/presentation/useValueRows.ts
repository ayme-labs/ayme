import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { JsonValue } from "@ayme-dev/ayme";

import {
  otherType,
  readRows,
  rowsOf,
  typeOf,
  type ValueRow,
  type ValueType,
} from "../domain/valueRows";

export type ValueRowsProps = {
  /** The argument's path, e.g. "values"; it names the rows' controls. */
  name: string;
  valueTypes: readonly ValueType[];
  optional: boolean;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
  /** Whether every row can be sent; while one can't, the card doesn't run. */
  onValidity: (valid: boolean) => void;
};

type Part = "label" | "value";

const emptyRow = (): ValueRow => ({ label: "", value: "", fixed: null });

/**
 * The rows' UI logic: the rows as typed, which are the source of the map;
 * the map they make, sent up as the argument; and the rows' problems.
 */
export function useValueRows({
  valueTypes,
  optional,
  value,
  onChange,
  onValidity,
}: ValueRowsProps) {
  const [rows, setRows] = useState(() => rowsOf(value, valueTypes));
  const read = useMemo(() => readRows(rows, valueTypes), [rows, valueTypes]);

  // A map set from elsewhere, such as the JSON editor, replaces the rows.
  const made = JSON.stringify(read.values);
  const given = JSON.stringify(rowsOf(value, valueTypes).length ? value : {});
  useEffect(() => {
    if (given !== made) setRows(rowsOf(value, valueTypes));
    // Only a change of the given map, not of the rows, resets them.
  }, [given]);

  const valid = read.problems.every((problem) => problem === undefined);
  useEffect(() => {
    onValidity(valid);
  }, [valid, onValidity]);
  useEffect(() => () => onValidity(true), [onValidity]);

  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [focus, setFocus] = useState<{ row: number; part: Part }>();
  useEffect(() => {
    if (!focus) return;
    inputs.current.get(`${focus.part} ${focus.row}`)?.focus();
    setFocus(undefined);
  }, [focus]);

  const update = (next: ValueRow[]) => {
    setRows(next);
    const map = readRows(next, valueTypes).values;
    onChange(Object.keys(map).length || !optional ? map : undefined);
  };
  const edit = (index: number, change: Partial<ValueRow>) =>
    update(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));
  const add = () => {
    update([...rows, emptyRow()]);
    setFocus({ row: rows.length, part: "label" });
  };
  const remove = (index: number) =>
    update(rows.filter((_, at) => at !== index));

  return {
    rows: rows.map((row, index) => ({
      ...row,
      type: typeOf(row, valueTypes),
      problem: read.problems[index],
    })),
    count: Object.keys(read.values).length,
    /** Whether a click on a row's type does anything: both types are allowed. */
    switchable: valueTypes.length > 1,
    register: useCallback(
      (part: Part, row: number) => (element: HTMLInputElement | null) => {
        if (element) inputs.current.set(`${part} ${row}`, element);
        else inputs.current.delete(`${part} ${row}`);
      },
      []
    ),
    add,
    remove,
    setLabel: (index: number, label: string) => edit(index, { label }),
    setValue: (index: number, text: string) => edit(index, { value: text }),
    switchType: (index: number) =>
      edit(index, { fixed: otherType(rows[index]!, valueTypes) }),
    /**
     * Enter in a label moves to its value, Enter in the last value adds a
     * row, and Backspace in an empty row removes it.
     */
    keyDown: (index: number, part: Part, event: KeyboardEvent) => {
      const row = rows[index]!;
      if (event.key === "Enter") {
        event.preventDefault();
        if (part === "label") setFocus({ row: index, part: "value" });
        else if (index === rows.length - 1) add();
        else setFocus({ row: index + 1, part: "label" });
      } else if (
        event.key === "Backspace" &&
        row.label === "" &&
        row.value === ""
      ) {
        event.preventDefault();
        remove(index);
        if (index > 0) setFocus({ row: index - 1, part: "value" });
      }
    },
  };
}
