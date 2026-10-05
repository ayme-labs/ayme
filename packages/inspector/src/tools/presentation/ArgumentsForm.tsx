import type { ComponentProps } from "react";

import { ArgumentsFormView } from "../view/ArgumentsFormView";
import { JsonControl } from "./JsonControl";
import { KeyField } from "./KeyField";
import { RefField } from "./RefField";
import { ValueRows } from "./ValueRows";

const controls = {
  ref: RefField,
  key: KeyField,
  map: ValueRows,
  json: JsonControl,
};

/** The typed form: one control per field, editing the arguments in place. */
export function ArgumentsForm(
  props: Omit<ComponentProps<typeof ArgumentsFormView>, "controls">
) {
  return <ArgumentsFormView {...props} controls={controls} />;
}
