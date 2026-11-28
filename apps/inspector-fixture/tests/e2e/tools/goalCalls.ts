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

export const goalCalls: Readonly<
  Record<string, (params: Params, test: Test) => Call[]>
> = {
  // The panel
  "collapse the panel": () => one("Inspector_collapse"),
  "open the panel from the ayme logo": () => one("CollapsedLogo_open"),
  "collapse the panel with the mouse": () => one("Inspector_collapse"),
  "open the panel from the ayme logo with the mouse": () =>
    one("CollapsedLogo_open"),
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
  "select {tool} in the Tools lens": (p) =>
    one("ToolsLens_select", { name: p.tool }),
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
  "select its {member} member": (p) =>
    one("ModelDetailView_selectMember", { name: p.member }),
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
  "choose {ref} as its ref element and run it": (p) =>
    one("RunCard_run", { args: { ref: p.ref } }),
  "run it with the goal {goal} and at most {maxSteps} steps": (p) =>
    one("RunCard_run", { args: { goal: p.goal, maxSteps: p.maxSteps } }),
  "run {tool} from the selected Structure node's card with the text {text}": (
    p
  ) => one("NodeView_runTool", { name: p.tool, args: { text: p.text } }),
  "set the key to {key}": (p) => one("RunCard_fill", { args: { key: p.key } }),
  "select the {item} item with the mouse": (p) =>
    one("RunCard_pickItem", { label: p.item }),
  "set the state to {state} with the mouse": (p) =>
    one("RunCard_choose", { path: "state", option: p.state }),
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
  "clear Runs": () => one("RunsView_clear"),
  "open the Result of the latest {tool} run in Runs": (p) =>
    one("RunsView_toggleResult", { toolName: p.tool }),
};
