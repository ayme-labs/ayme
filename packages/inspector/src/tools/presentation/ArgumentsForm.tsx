import type { ComponentProps } from "react";

import { ArgumentsFormView } from "../view/ArgumentsFormView";
import { KeyField } from "./KeyField";
import { RefField } from "./RefField";

const controls = { ref: RefField, key: KeyField };

/** The typed form: one control per field, editing the arguments in place. */
export function ArgumentsForm(
  props: Omit<ComponentProps<typeof ArgumentsFormView>, "controls">
) {
  return <ArgumentsFormView {...props} controls={controls} />;
}
