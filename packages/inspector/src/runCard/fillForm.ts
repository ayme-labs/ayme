import type { StructureNode } from "../adapter/structure";

/** The roles `fill_form` fills, as its fields' `type`. */
const fieldTypes = [
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "slider",
] as const;

export type FormFieldType = (typeof fieldTypes)[number];

/** One of `fill_form`'s `fields`. */
export type FormField = {
  target: string;
  name: string;
  type: FormFieldType;
  value: string;
};

/**
 * A row of `fill_form`'s form: one fillable element on the page, or one
 * radio group, with the value the page shows now.
 */
export type FormRow = {
  /** Stable across looks at the page: the ref, or the radio group's key. */
  key: string;
  type: FormFieldType;
  /** The accessible name, or a radio group's. */
  name: string;
  /**
   * The value the page shows, as `fill_form` takes it. A radio group's is
   * the checked radio's ref, or "" when none is.
   */
  value: string;
  /** The ref to highlight while the row is hovered. */
  preview: string;
  /** For a textarea: its text can hold line breaks. */
  multiline?: boolean;
  /**
   * The choices: a combobox's option labels, or a radio group's radios
   * (labelled by name, valued by ref).
   */
  options?: { label: string; value: string }[];
  /** A slider's bounds and step, when the page has them. */
  range?: { min: number; max: number; step: number | "any" };
};

/**
 * Every element `fill_form` can fill, in page order, from the page's
 * structure: a radio group's radios collapse into one row, at its first
 * radio. Radios group by their name in a form, or else by the nearest
 * group around them.
 */
export function formRows(roots: readonly StructureNode[]): FormRow[] {
  const rows: FormRow[] = [];
  const radioGroups = new Map<string, FormRow>();
  const addRadio = (
    radio: StructureNode & { ref: string },
    group: StructureNode | undefined
  ) => {
    const key = `radio:${radio.control?.group ?? group?.ref ?? radio.ref}`;
    let row = radioGroups.get(key);
    if (!row) {
      row = {
        key,
        type: "radio",
        name: group?.name ?? "",
        value: "",
        preview: group?.ref ?? radio.ref,
        options: [],
      };
      radioGroups.set(key, row);
      rows.push(row);
    }
    row.options!.push({ label: radio.name, value: radio.ref });
    if ((radio.control?.value ?? String(isChecked(radio))) === "true")
      row.value = radio.ref;
  };
  const visit = (
    nodes: readonly StructureNode[],
    group: StructureNode | undefined
  ) => {
    for (const node of nodes) {
      const type = fieldTypes.find((candidate) => candidate === node.role);
      if (node.ref !== undefined && type === "radio")
        addRadio(node as StructureNode & { ref: string }, group);
      else if (node.ref !== undefined && type && type !== "radio")
        rows.push(elementRow(node as StructureNode & { ref: string }, type));
      visit(
        node.children,
        node.role === "radiogroup" || node.role === "group" ? node : group
      );
    }
  };
  visit(roots, undefined);
  // A group without a name is named by its radios.
  for (const row of radioGroups.values())
    row.name ||= row.options!.map((option) => option.label).join(" / ");
  return rows;
}

function elementRow(
  node: StructureNode & { ref: string },
  type: Exclude<FormFieldType, "radio">
): FormRow {
  const { control } = node;
  const row: FormRow = {
    key: node.ref,
    type,
    name: node.name,
    value: control?.value ?? "",
    preview: node.ref,
  };
  if (control?.multiline) row.multiline = true;
  if (control?.range) row.range = control.range;
  if (type === "checkbox") {
    row.value = control?.value ?? String(isChecked(node));
    return row;
  }
  if (type === "combobox") {
    const options = node.children.filter((child) => child.role === "option");
    const labels = control?.options ?? options.map((option) => option.name);
    if (labels.length)
      row.options = labels.map((label) => ({ label, value: label }));
    if (!control)
      row.value =
        options.find((option) => option.state?.selected)?.name ?? textOf(node);
    return row;
  }
  if (!control) row.value = textOf(node);
  return row;
}

function isChecked(node: StructureNode) {
  return node.state?.checked === true;
}

/** The text the page state shows after a node's name: a field's value. */
function textOf(node: StructureNode) {
  return (
    node.children.find((child) => child.role === "text" && !child.ref)?.name ??
    ""
  );
}

/**
 * Whether the person changed the row: their value differs from the page's,
 * and for a radio group, the radio they chose is still on the page.
 */
export function isChanged(
  row: FormRow,
  edits: ReadonlyMap<string, string>
): boolean {
  const edit = edits.get(row.key);
  return (
    edit !== undefined &&
    edit !== row.value &&
    (row.type !== "radio" ||
      row.options!.some((option) => option.value === edit))
  );
}

/** The fields to fill: the changed rows, in the rows' order. */
export function changedFields(
  rows: readonly FormRow[],
  edits: ReadonlyMap<string, string>
): FormField[] {
  return rows
    .filter((row) => isChanged(row, edits))
    .map((row) => {
      const value = edits.get(row.key)!;
      if (row.type !== "radio")
        return { target: row.key, name: row.name, type: row.type, value };
      const radio = row.options!.find((option) => option.value === value)!;
      return {
        target: radio.value,
        name: radio.label,
        type: row.type,
        value: "true",
      };
    });
}

/**
 * The rows in fill order: the order the person dragged them into, if any,
 * with rows new since then after the row before them in page order.
 */
export function inFillOrder(
  rows: readonly FormRow[],
  order: readonly string[] | undefined
): FormRow[] {
  if (!order) return [...rows];
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const ordered = order.flatMap((key) => byKey.get(key) ?? []);
  rows.forEach((row, index) => {
    if (ordered.includes(row)) return;
    const before = index === 0 ? -1 : ordered.indexOf(rows[index - 1]!);
    ordered.splice(before + 1, 0, row);
  });
  return ordered;
}
