import type { SchemaViolation } from "@ayme-dev/ayme/internal";

import type { OnHover } from "../../navigation";
import {
  openImageFullSize,
  type CollectionItem,
  type Run,
  type ToolArguments,
} from "../../runs";
import { argumentsToJson } from "../domain/fields";
import type { RefSource } from "../domain/refTree";
import type { RunnableTool } from "../domain/runnableTools";
import { JsonEditor, RunCardView } from "../view/RunCardView";
import { ArgumentsForm } from "./ArgumentsForm";
import { FillFormFields } from "./FillFormFields";
import { LocatorGroups } from "./LocatorGroups";
import { useRunCard } from "./useRunCard";

export type RunCardProps = {
  tool: RunnableTool;
  /** Whether WebMCP publishes it now. Otherwise it shows dimmed, without Run. */
  available: boolean;
  /**
   * The head: the action's name and signature, its description, and Run.
   * Without it, as on a tool's own view, the form is open and Run sits at
   * the foot.
   */
  head?: boolean;
  /** For a collection action: the item it runs on, when the view has one. */
  item?: CollectionItem;
  /** For a collection action without an item: the items to pick from. */
  items?: readonly CollectionItem[];
  /**
   * The Structural Ref the view runs the tool on, e.g. a structure node's:
   * it fills the tool's `ref` argument.
   */
  structuralRef?: string;
  /** Where a ref argument chooses its ref from: the page's structure. */
  refSource?: RefSource;
  /** This tool's runs, newest first. */
  runs: readonly Run[];
  /**
   * How arguments break the tool's schema, as the runtime checks them. The
   * JSON editor lists them, and Run is off while there are any.
   */
  argumentViolations?: (args: ToolArguments) => readonly SchemaViolation[];
  /** Runs the tool with its input, on the item for a collection action. */
  onRun: (input: ToolArguments, item?: CollectionItem) => void;
  /** Shows a run in Runs. */
  onShowRun: (runId: number) => void;
  /** Highlights an item on the page while it's hovered. */
  onHover?: OnHover;
};

/**
 * The run card: runs one tool, the same way wherever something can be run.
 * Run is always there. With nothing to fill in it runs at once; otherwise
 * the first press opens the typed form and the next one runs.
 */
export function RunCard(props: RunCardProps) {
  const card = useRunCard(props);
  const { tool, items = [], refSource, onShowRun, onHover } = props;
  const { args, json, violations, fields, last } = card;
  const form = tool.fillForm ? (
    <FillFormFields
      source={refSource ?? { roots: [] }}
      lastRun={last}
      onChange={card.setFormFields}
    />
  ) : tool.locatorGroups && json === undefined ? (
    <LocatorGroups
      source={refSource ?? { roots: [] }}
      lastRun={last}
      onChange={card.setGroups}
    />
  ) : json === undefined ? (
    <ArgumentsForm
      fields={fields}
      values={args}
      refSource={refSource}
      onChange={card.changeArgument}
      onValidity={card.setValidity}
    />
  ) : (
    <JsonEditor
      text={json.text ?? argumentsToJson(args)}
      error={json.error}
      errorLine={json.position?.line}
      violations={violations}
      onChange={card.changeJson}
      onFormat={card.formatJson}
    />
  );
  return (
    <RunCardView
      {...card}
      tool={tool}
      available={props.available}
      items={items}
      onHover={onHover}
      onShowRun={onShowRun}
      onOpenImage={(src) => void openImageFullSize(src)}
      form={form}
    />
  );
}
