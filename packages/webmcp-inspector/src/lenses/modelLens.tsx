import { BracesIcon, GlobeIcon } from "lucide-react";

import type { Lens } from "../frame/lens";
import { NavItem } from "../frame/NavItem";
import type { RenderRun } from "../frame/runSlot";
import type { Selection } from "../frame/selection";
import { PageObjectsTab, type HighlightControls } from "../PageObjectsTab";
import type { PomClass } from "../pomModel";

/**
 * The Model lens. Ticket E replaces this skeleton: for now it lists the Page
 * Object Models, and the page's and a model's detail are the skeleton's
 * Page objects view.
 */
export function modelLens({
  host,
  pomClasses,
  selection,
  onSelect,
  highlight,
  renderRun,
}: {
  /** The page's host, e.g. localhost:5173. */
  host: string;
  pomClasses: readonly PomClass[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  highlight: HighlightControls;
  renderRun: RenderRun;
}): Lens {
  const selectedClass =
    selection.kind === "model" ? selection.className : undefined;
  return {
    id: "model",
    label: "Model",
    tree: (
      <div className="flex flex-col">
        <NavItem
          selected={selection.kind === "page"}
          onClick={() => onSelect({ kind: "page" })}
        >
          <GlobeIcon className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-mono">/</span>
          <span className="truncate text-xs text-muted-foreground">{host}</span>
        </NavItem>
        <ul aria-label="Page object models">
          {pomClasses.map((pomClass) => (
            <li key={pomClass.className}>
              <NavItem
                depth={1}
                selected={pomClass.className === selectedClass}
                onClick={() =>
                  onSelect({ kind: "model", className: pomClass.className })
                }
              >
                <BracesIcon
                  className="size-3.5 text-muted-foreground"
                  aria-hidden
                />
                <span className="font-mono">{pomClass.className}</span>
              </NavItem>
            </li>
          ))}
        </ul>
      </div>
    ),
    searchEntries: pomClasses.map((pomClass) => ({
      key: `model:${pomClass.className}`,
      kind: "POM",
      label: pomClass.className,
      description: `Page object · ${
        pomClass.instances.length
          ? `${pomClass.instances.length} on page`
          : "not on page"
      }`,
      selection: { kind: "model", className: pomClass.className },
    })),
    legend: {},
    detail: (selected) => {
      if (selected.kind === "page")
        return (
          <PageObjectsTab
            pomClasses={pomClasses}
            highlight={highlight}
            renderRun={renderRun}
          />
        );
      if (selected.kind !== "model") return undefined;
      return (
        <PageObjectsTab
          pomClasses={pomClasses.filter(
            (pomClass) => pomClass.className === selected.className
          )}
          highlight={highlight}
          renderRun={renderRun}
        />
      );
    },
  };
}
