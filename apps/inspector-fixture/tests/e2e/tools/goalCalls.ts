import type { JsonValue } from "e2e";

import type { Call } from "./scripted";

// For trying arm 3's config without a model: the Page Object Tool calls
// that answer each goal of tests/goals, by the goal as the test writes it.
// Each is the call the goal's arm-2 twin makes, so a goal this table does
// not cover stops its test at once. Where twins make different calls for one
// goal, the test's title tells them apart.

type Params = Readonly<Record<string, JsonValue>>;

/** The test the goal is in: its title, the innermost of its title path. */
type Test = { readonly title: string };

const one = (tool: string, input: object = {}): Call[] => [{ tool, input }];
/** A drag's distance as the offset `resizeBy` and `dragBy` take. */
const offset = (distance: number, direction: string) =>
  ({
    up: { deltaX: 0, deltaY: -distance },
    down: { deltaX: 0, deltaY: distance },
    left: { deltaX: -distance, deltaY: 0 },
    right: { deltaX: distance, deltaY: 0 },
  })[direction];
const resize = (p: Params) =>
  one("PanelShell_resizeBy", {
    handle: p.edge,
    ...offset(Number(p.distance), String(p.direction)),
  });

export const goalCalls: Readonly<
  Record<string, (params: Params, test: Test) => Call[]>
> = {
  // The panel
  "collapse the panel": () => one("Inspector_collapse"),
  "open the panel from the ayme logo": () => one("CollapsedLogo_open"),
  "drag the panel by its header {left} px left and {down} px down": (p) =>
    one("InspectorHeader_dragBy", {
      deltaX: -Number(p.left),
      deltaY: Number(p.down),
    }),
  "drag the panel's {edge} edge {distance} px {direction}": resize,
  "drag the panel's {edge} edge {distance} px to the {direction}": resize,
  "set the layout to {layout}": (p) =>
    one("LayoutMenu_choose", { choice: p.layout }),
  "open the Layout menu with the mouse": () => one("LayoutMenu_open"),
  "choose {layout} in the Layout menu with the mouse": (p) =>
    one("LayoutMenu_pick", { choice: p.layout }),
  "press the theme switch once with the mouse": () => one("ThemeSwitch_press"),
  "open the Connections popover": () => one("Connections_open"),
  // The navigator
  "show the {lens} lens": (p) => one("Navigator_showLens", { name: p.lens }),
  "search the navigator for {query}": (p) =>
    one("Navigator_search", { query: p.query }),
  "select the search result {result}": (p) =>
    one("Navigator_selectResult", { label: p.result }),
  "hover the search result {result}": (p) =>
    one("Navigator_hoverResult", { label: p.result }),
  // runs.e2e.ts clicks the navigator's item; toolsLens.e2e.ts the lens's tool.
  "select {tool} in the Tools lens": (p, { title }) =>
    title.startsWith("Runs switches")
      ? one("Navigator_selectItem", { text: p.tool })
      : one("ToolsLens_select", { name: p.tool }),
  // The tag shows the member without its class, `.newItemInput`; the twin
  // names it in full.
  "select the node tagged {tag} in the Structure lens": (p) =>
    one("StructureLens_selectNode", { member: `ListPage${String(p.tag)}` }),
  "hover the node tagged {tag} in the Structure lens": (p) =>
    one("StructureLens_hoverNode", { member: `ListPage${String(p.tag)}` }),
  "select the {role} {name} node in the Structure lens": (p) =>
    one("StructureLens_selectNodeNamed", { role: p.role, name: p.name }),
  "select {object} under On this page in the Model lens": (p) =>
    one("ModelLens_select", { path: p.object }),
  // The twin names the row by its path on the TodoPage.
  'select the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens':
    (p) =>
      one("ModelLens_select", {
        path: `TodoPage.${String(p.collection)}${String(p.item)}`,
      }),
  'hover the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens':
    (p) =>
      one("ModelLens_hover", {
        path: `TodoPage.${String(p.collection)}${String(p.item)}`,
      }),
  "collapse the {pane} pane in the Model lens": (p) =>
    one("ModelLens_togglePane", { name: p.pane }),
  "select its {member} member": (p) =>
    one("ModelDetailView_selectMember", { name: p.member }),
  "hover its {member} member": (p) =>
    one("ModelDetailView_hoverMember", { name: p.member }),
  // A tool's page, a node's view and their run cards
  "open the {tool} tool in the Tools lens": (p) =>
    one("Inspector_tool", { name: p.tool }),
  // A node's view in one test of detailRuns.e2e.ts; a tool's page elsewhere.
  "open What the model sees": (_, { title }) =>
    one(
      title.includes("in its node's What the model sees")
        ? "NodeView_modelSees_open"
        : "ToolPage_modelSees_open"
    ),
  "run it": () => one("RunCard_pressRun"),
  "run it with the text {text}": (p) =>
    one("RunCard_run", { args: { text: p.text } }),
  "run it with the query {query}": (p) =>
    one("RunCard_run", { args: { query: p.query } }),
  "choose {ref} as its ref element and run it": (p) =>
    one("RunCard_run", { args: { ref: p.ref } }),
  "run it with the goal {goal} and at most {maxSteps} steps": (p) =>
    one("RunCard_run", { args: { goal: p.goal, maxSteps: p.maxSteps } }),
  "run {tool} with the text {text}": (p) =>
    one("NodeView_runTool", { name: p.tool, args: { text: p.text } }),
  "set the key to {key}": (p) => one("RunCard_fill", { args: { key: p.key } }),
  "pick the {item} item with the mouse": (p) =>
    one("RunCard_pickItem", { label: p.item }),
  "switch the arguments editor to JSON": () =>
    one("RunCard_switchEditor", { to: "JSON" }),
  "switch the arguments editor back to Form": () =>
    one("RunCard_switchEditor", { to: "Form" }),
  "set the state to {state} with the mouse": (p) =>
    one("RunCard_choose", { path: "state", option: p.state }),
  "open the page structure tree of the {field} field": (p) =>
    one("RunCard_openChooser", { field: p.field }),
  "start picking the {field} element on the page": (p) =>
    one("RunCard_pickOnPage", { field: p.field }),
  "set {field} to {value} in the form": (p) =>
    one("FillForm_set", { name: p.field, value: p.value }),
  "check {field} in the form": (p) =>
    one("FillForm_set", { name: p.field, value: true }),
  "undo the change to {field}": (p) => one("FillForm_undo", { name: p.field }),
  "add {targets} to group {group} from its tree": (p) =>
    one("LocatorGroups_toggleFromTree", { number: p.group, refs: p.targets }),
  "add a group": () => one("LocatorGroups_addGroup"),
  // Runs
  "show all runs in Runs": () => one("RunsView_showAll"),
  "show all runs in Runs with the mouse": () => one("RunsView_showAll"),
  "show only the selection's runs in Runs with the mouse": () =>
    one("RunsView_showSelection"),
  "clear Runs": () => one("RunsView_clear"),
  "open the Result of the latest {tool} run in Runs": (p) =>
    one("RunsView_toggleResult", { toolName: p.tool }),
  "copy the result of the latest {tool} run": (p) =>
    one("RunsView_copyResult", { toolName: p.tool }),
  "hover the {position} Interaction of the latest {tool} run in Runs": (p) =>
    one("RunsView_hoverInteraction", {
      toolName: p.tool,
      index: ["first", "second", "third", "fourth"].indexOf(String(p.position)),
    }),
};
