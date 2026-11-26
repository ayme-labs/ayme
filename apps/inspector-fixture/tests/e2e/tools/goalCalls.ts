import type { JsonValue } from "e2e";

import type { Call } from "./scripted";

// For trying arm 3's config without a model: the Page Object Tool calls
// that answer each goal of tests/goals, by the goal as the test writes it.
// Each is the call the goal's arm-2 twin makes, so a goal this table does
// not cover stops its test at once.

type Params = Readonly<Record<string, JsonValue>>;

const one = (tool: string, input: object = {}): Call[] => [{ tool, input }];
const showLens = (name: string): Call => ({
  tool: "Navigator_showLens",
  input: { name },
});
/** A drag's distance as the offset `resizeBy` and `dragBy` take. */
const offset = (distance: number, direction: string) =>
  ({
    up: { deltaX: 0, deltaY: -distance },
    down: { deltaX: 0, deltaY: distance },
    left: { deltaX: -distance, deltaY: 0 },
    right: { deltaX: distance, deltaY: 0 },
  })[direction];

export const goalCalls: Readonly<Record<string, (params: Params) => Call[]>> = {
  // The panel
  "open the ayme panel": () => one("Inspector_open"),
  "collapse the panel": () => one("Inspector_collapse"),
  "open the panel from the ayme logo": () => one("CollapsedLogo_open"),
  "drag the panel by its header {left} px left and {down} px down": (p) =>
    one("InspectorHeader_dragBy", {
      deltaX: -Number(p.left),
      deltaY: Number(p.down),
    }),
  "drag the panel's {edge} edge {distance} px {direction}": (p) =>
    one("PanelShell_resizeBy", {
      handle: p.edge,
      ...offset(Number(p.distance), String(p.direction)),
    }),
  "drag the panel's {edge} edge {distance} px to the {direction}": (p) =>
    one("PanelShell_resizeBy", {
      handle: p.edge,
      ...offset(Number(p.distance), String(p.direction)),
    }),
  "set the layout to {layout}": (p) =>
    one("LayoutMenu_choose", { choice: p.layout }),
  "open the Layout menu": () => one("LayoutMenu_open"),
  "choose {layout} in the Layout menu": (p) =>
    one("LayoutMenu_pick", { choice: p.layout }),
  "switch the theme": () => one("ThemeSwitch_press"),
  "open the Connections popover": () => one("Connections_open"),
  // The navigator
  "show the Tools lens": () => [showLens("Tools")],
  "show the {lens} lens": (p) => [showLens(String(p.lens))],
  "search the navigator for {query}": (p) =>
    one("Navigator_search", { query: p.query }),
  "select the search result {result}": (p) =>
    one("Navigator_selectResult", { label: p.result }),
  "hover the search result {result}": (p) =>
    one("Navigator_hoverResult", { label: p.result }),
  "select {tool} in the Tools lens": (p) =>
    one("ToolsLens_select", { name: p.tool }),
  "select {object} under On this page in the Model lens": (p) => [
    showLens("Model"),
    { tool: "ModelLens_select", input: { path: p.object } },
  ],
  "hover {object} under On this page in the Model lens": (p) => [
    showLens("Model"),
    { tool: "ModelLens_hover", input: { path: p.object } },
  ],
  "collapse the {pane} pane in the Model lens": (p) =>
    one("ModelLens_togglePane", { name: p.pane }),
  "click its {member} member": (p) =>
    one("ModelDetailView_selectMember", { name: p.member }),
  "hover its {member} member": (p) =>
    one("ModelDetailView_hoverMember", { name: p.member }),
  // A tool's page and its run card
  "open the {tool} tool": (p) => one("Inspector_tool", { name: p.tool }),
  "open What the model sees": () => one("WhatTheModelSees_open"),
  "run it": () => one("RunCard_pressRun"),
  "run it with the text {text}": (p) =>
    one("RunCard_run", { args: { text: p.text } }),
  "run it with the ref {ref}": (p) =>
    one("RunCard_run", { args: { ref: p.ref } }),
  "run it with the goal {goal} and at most {maxSteps} steps": (p) =>
    one("RunCard_run", { args: { goal: p.goal, maxSteps: p.maxSteps } }),
  "pick the {item} item": (p) => one("RunCard_pickItem", { label: p.item }),
  "switch the arguments editor to JSON": () =>
    one("RunCard_switchEditor", { to: "JSON" }),
  "switch the arguments editor back to Form": () =>
    one("RunCard_switchEditor", { to: "Form" }),
  "set the state to {state}": (p) =>
    one("RunCard_choose", { path: "state", option: p.state }),
  // Runs
  "show all runs in Runs": () => one("RunsView_showAll"),
  "show only the selection's runs in Runs": () => one("RunsView_showSelection"),
  "show the result of the latest {tool} run": (p) =>
    one("RunsView_toggleResult", { toolName: p.tool }),
  "hover the {position} Interaction of the latest {tool} run in Runs": (p) =>
    one("RunsView_hoverInteraction", {
      toolName: p.tool,
      index: ["first", "second", "third", "fourth"].indexOf(String(p.position)),
    }),
};
