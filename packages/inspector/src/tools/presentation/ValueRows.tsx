import { ValueRowsView } from "../view/ValueRowsView";
import { useValueRows, type ValueRowsProps } from "./useValueRows";

/**
 * A map of labelled values, such as `goal`'s `values`, edited as rows. Each
 * value's type is guessed from what is typed until the person fixes it.
 */
export function ValueRows(
  props: ValueRowsProps & { description?: string; maxEntries?: number }
) {
  const rows = useValueRows(props);
  return (
    <ValueRowsView
      {...rows}
      name={props.name}
      description={props.description}
      maxEntries={props.maxEntries}
    />
  );
}
