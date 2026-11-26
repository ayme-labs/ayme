// Writes the three rules files the Session model is checked with. Each one
// checks the same statechart (session.json) with a different group of
// outside events switched on, so each run stays inside the checker's
// state budget. Run: node packages/cli/session-model/rules.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Per-Tab values. Tabs are 1 and 2; 0 means "no Tab".
const perTabValue = (tab, one, two, none) =>
  `(${tab} == 1 ? ${one} : (${tab} == 2 ? ${two} : ${none}))`;
const tabOpen = (tab) => perTabValue(tab, "t1", "t2", "false");
const dlg = (tab) => perTabValue(tab, "d1", "d2", "0");
const dlgInRun = (tab) => perTabValue(tab, "r1", "r2", "false");
const stopped = (tab) => perTabValue(tab, "s1", "s2", "0");
const tabId = (tab) => perTabValue(tab, "id1", "id2", "0");
const visible = (tab) => `(${tabOpen(tab)} && active == ${tab} && !hidden)`;
const runOn = (tab) =>
  `((in('agent.running') && aTab == ${tab}) || (in('inspector.running') && wTab == ${tab}))`;
const runsOn = (tab) =>
  `((in('agent.running') && aTab == ${tab}) ? 1 : 0) + ((in('inspector.running') && wTab == ${tab}) ? 1 : 0) + (${stopped(tab)} != 0 ? 1 : 0)`;
// A Tab's turn: a Run on it, or the action of a Run that a dialog stopped.
const turnHeld = (tab) => `(${runOn(tab)} || ${stopped(tab)} != 0)`;
const anyRun = `(${runOn(1)} || ${runOn(2)})`;
// A Run's page work finishes only on a Tab that is shown, in the reading
// where a hidden Tab stalls Playwright; otherwise it may finish hidden.
const pageWorkCanFinish = (tab) => `(${visible(tab)} || !hiddenStalls)`;
const RUNNING = "in('life.running')";
// Writes `value` to the per-Tab variable `name` of `event.tab`.
const onEventTab = (name, value) => ({
  [`${name}1`]: `event.tab == 1 ? (${value}) : ${name}1`,
  [`${name}2`]: `event.tab == 2 ? (${value}) : ${name}2`,
});

const context = {
  ext: { min: 0, max: 6 },
  // The model's reading of an open question, fixed per initial state.
  hiddenStalls: "bool",
  listQueues: "bool",
  scheme: ["session", "perPage"],
  // The browser.
  owned: "bool",
  browserUp: "bool",
  t1: "bool",
  t2: "bool",
  active: { min: 0, max: 2 },
  hidden: "bool",
  d1: { min: 0, max: 2 },
  d2: { min: 0, max: 2 },
  r1: "bool",
  r2: "bool",
  // The Session.
  s1: { min: 0, max: 2 },
  s2: { min: 0, max: 2 },
  buildFailing: "bool",
  renamePending: "bool",
  aCmd: ["list", "call", "close", "detach"],
  aTab: { min: 0, max: 2 },
  wTab: { min: 0, max: 2 },
  startFail: ["none", "buildError", "browserGone"],
  // Page Object Ids.
  id1: { min: 0, max: 7 },
  id2: { min: 0, max: 7 },
  g: { min: 0, max: 7 },
  c1: { min: 0, max: 7 },
  c2: { min: 0, max: 7 },
  sessionHw: { min: 0, max: 7 },
  earlierHw: { min: 0, max: 7 },
  // Records for the rules.
  openAnswer: ["none", "started", "buildError", "browserGone", "nameInUse"],
  listLine: ["none", "tabOnly", "tabAndFailing"],
  closedByAyme: ["none", "owned", "notOwned"],
  detachEndedOwn: "bool",
  swapDuringRun: "bool",
  swapWhileStopped: "bool",
  refusedYoung: { min: 0, max: 2 },
  refusedForPassingDialog: "bool",
  runKeptAfterDialog: "bool",
  refusedHiddenAfterSwitch: "bool",
  idReused: "bool",
  idRepeatsEarlierSession: "bool",
};

const start = {
  ext: 0,
  hiddenStalls: false,
  listQueues: false,
  scheme: "session",
  owned: false,
  browserUp: false,
  t1: false,
  t2: false,
  active: 0,
  hidden: false,
  d1: 0,
  d2: 0,
  r1: false,
  r2: false,
  s1: 0,
  s2: 0,
  buildFailing: false,
  renamePending: false,
  aCmd: "list",
  aTab: 0,
  wTab: 0,
  startFail: "none",
  id1: 0,
  id2: 0,
  g: 0,
  c1: 0,
  c2: 0,
  sessionHw: 0,
  earlierHw: 0,
  openAnswer: "none",
  listLine: "none",
  closedByAyme: "none",
  detachEndedOwn: false,
  swapDuringRun: false,
  swapWhileStopped: false,
  refusedYoung: 0,
  refusedForPassingDialog: false,
  runKeptAfterDialog: false,
  refusedHiddenAfterSwitch: false,
  idReused: false,
  idRepeatsEarlierSession: false,
};

const BUDGET = 5;
const out = `ext < ${BUDGET}`;
const bump = { ext: "ext + 1" };
const freshTabs = {
  t1: "true",
  t2: "true",
  active: "1",
  hidden: "false",
  d1: "0",
  d2: "0",
  r1: "false",
  r2: "false",
  id1: "0",
  id2: "0",
  c1: "0",
  c2: "0",
};
// What a Session's end clears. The browser's Tabs and dialogs stay as they
// are when the browser stays; the ids of this Session are remembered in
// `earlierHw` only to show that a later Session repeats them.
const sessionReset = {
  s1: "0",
  s2: "0",
  r1: "false",
  r2: "false",
  renamePending: "false",
  buildFailing: "false",
  id1: "0",
  id2: "0",
  g: "0",
  sessionHw: "0",
  earlierHw: "max(earlierHw, sessionHw)",
  refusedYoung: "0",
};

const newId = `(scheme == 'session' ? g + 1 : (event.tab == 1 ? c1 + 1 : c2 + 1))`;

const guards = {
  // The browser and its Tabs.
  browserCanGo: `${out} && browserUp`,
  canOpenDialog: `${out} && browserUp && ${tabOpen("event.tab")} && ${dlg("event.tab")} == 0`,
  canCloseDialog: `${out} && browserUp && ${dlg("event.tab")} != 0`,
  // The 100 ms passing on a dialog that no Run on its Tab is waiting under;
  // when one is, the Caller's region takes the step (see stopAgentAction).
  dialogAgesOutsideRun: `browserUp && ${dlg("event.tab")} == 1 && !(${dlgInRun("event.tab")} && ${runOn("event.tab")})`,
  canSwitchTab: `${out} && browserUp && ${tabOpen("event.tab")} && active != event.tab`,
  canOpenTab: `${out} && browserUp && !${tabOpen("event.tab")}`,
  canCloseTab: `${out} && browserUp && ${tabOpen("event.tab")}`,
  canHide: `${out} && browserUp && !hidden`,
  canShow: `${out} && browserUp && hidden`,
  canNavigate: `${out} && browserUp && ${tabOpen("event.tab")} && ${dlg("event.tab")} == 0`,
  // Start and end.
  canOpen: `${out} && in('life.noSession') && in('opener.idle')`,
  openNameInUse: `${out} && !in('life.noSession')`,
  canAttach: `${out} && in('life.noSession') && in('opener.idle')`,
  attachNameInUse: `${out} && !in('life.noSession')`,
  firstBuildOk: "event.ok",
  firstBuildFails: "!event.ok",
  sessionRunning: RUNNING,
  noSession: "in('life.noSession')",
  canEndSession: `in('agent.ending') && ${RUNNING} && !(aCmd == 'detach' && owned)`,
  detachRefused: "aCmd == 'detach' && owned",
  // Page Objects and Swap.
  canEdit: out,
  buildOk: "event.ok",
  buildFails: "!event.ok",
  canSwap: `!${anyRun}`,
  stoppedActionCanEnd: `${stopped("event.tab")} == 2 && ${dlg("event.tab")} == 0 && ${pageWorkCanFinish("event.tab")}`,
  canRead: `${tabOpen("event.tab")} && ${tabId("event.tab")} == 0 && ${dlg("event.tab")} == 0`,
  // The agent's `ayme` commands.
  canSendCommand: out,
  beginListing: `${RUNNING} && aCmd == 'list'`,
  beginRun: `${RUNNING} && aCmd == 'call'`,
  beginEnd: `${RUNNING} && (aCmd == 'close' || aCmd == 'detach')`,
  agentTabHasDialog: `${dlg("aTab")} != 0`,
  agentTabGone: `!${tabOpen("aTab")}`,
  agentTabHidden: `${tabOpen("aTab")} && !${visible("aTab")}`,
  agentCanList: `${tabOpen("aTab")} && ${dlg("aTab")} == 0 && (!listQueues || !${turnHeld("aTab")})`,
  agentCanStart: `${visible("aTab")} && ${dlg("aTab")} == 0 && !${turnHeld("aTab")}`,
  agentRunCanEnd: `${dlg("aTab")} == 0 && ${pageWorkCanFinish("aTab")}`,
  agentRunHitDialog: `event.tab == aTab && ${dlg("aTab")} == 1 && ${dlgInRun("aTab")}`,
  agentTabCloses: `${out} && browserUp && event.tab == aTab && ${tabOpen("event.tab")}`,
  // The Inspector's Runs.
  canRunFromInspector: `${out} && ${RUNNING}`,
  inspectorTabHasDialog: `${dlg("wTab")} != 0`,
  inspectorTabGone: `!${tabOpen("wTab")}`,
  inspectorTabHidden: `${tabOpen("wTab")} && !${visible("wTab")}`,
  inspectorCanStart: `${visible("wTab")} && ${dlg("wTab")} == 0 && !${turnHeld("wTab")}`,
  inspectorRunCanEnd: `${dlg("wTab")} == 0 && ${pageWorkCanFinish("wTab")}`,
  inspectorRunHitDialog: `event.tab == wTab && ${dlg("wTab")} == 1 && ${dlgInRun("wTab")}`,
  inspectorTabCloses: `${out} && browserUp && event.tab == wTab && ${tabOpen("event.tab")}`,
};

const actions = {
  // The browser and its Tabs.
  browserGone: {
    ...bump,
    browserUp: "false",
    t1: "false",
    t2: "false",
    active: "0",
    d1: "0",
    d2: "0",
  },
  // The browser going away during a start or a Session: one action per step,
  // because the checker keeps only the last region's assignments when one
  // event moves several regions.
  browserGoneDuringStart: {
    ...bump,
    browserUp: "false",
    t1: "false",
    t2: "false",
    active: "0",
    d1: "0",
    d2: "0",
    startFail: "'browserGone'",
  },
  endSessionBrowserGone: {
    ...bump,
    browserUp: "false",
    t1: "false",
    t2: "false",
    active: "0",
    d1: "0",
    d2: "0",
    ...sessionReset,
  },
  openDialog: {
    ...bump,
    ...onEventTab("d", "1"),
    ...onEventTab("r", runOn("event.tab")),
    // An action stopped by an earlier dialog blocks again under a new one.
    ...onEventTab(
      "s",
      `${stopped("event.tab")} == 2 ? 1 : ${stopped("event.tab")}`
    ),
  },
  closeDialog: {
    ...bump,
    ...onEventTab("d", "0"),
    ...onEventTab("r", "false"),
    ...onEventTab(
      "s",
      `${stopped("event.tab")} == 1 ? 2 : ${stopped("event.tab")}`
    ),
    refusedForPassingDialog: `refusedForPassingDialog || (refusedYoung == event.tab && ${dlg("event.tab")} == 1 && ${runOn("event.tab")})`,
    runKeptAfterDialog: `runKeptAfterDialog || (${dlg("event.tab")} == 1 && ${runOn("event.tab")})`,
  },
  ageDialog: { ...onEventTab("d", "2") },
  switchTab: { ...bump, active: "event.tab" },
  openTab: {
    ...bump,
    active: "event.tab",
    ...onEventTab("t", "true"),
    ...onEventTab("d", "0"),
    ...onEventTab("r", "false"),
    ...onEventTab("s", "0"),
    ...onEventTab("id", "0"),
    ...onEventTab("c", "0"),
  },
  // Rule 9: ayme moves to the next most recently active Tab. With two Tabs
  // that is the other one, when it is open.
  closeTab: {
    ...bump,
    active: `active == event.tab ? (event.tab == 1 ? (t2 ? 2 : 0) : (t1 ? 1 : 0)) : active`,
    ...onEventTab("t", "false"),
    ...onEventTab("d", "0"),
    ...onEventTab("r", "false"),
    ...onEventTab("s", "0"),
    ...onEventTab("id", "0"),
    ...onEventTab("c", "0"),
  },
  hide: { ...bump, hidden: "true" },
  show: { ...bump, hidden: "false" },
  navigate: { ...bump, ...onEventTab("id", "0"), ...onEventTab("c", "0") },
  // Start and end.
  startOwnBrowser: {
    ...bump,
    owned: "true",
    browserUp: "true",
    startFail: "'none'",
    openAnswer: "'none'",
    ...freshTabs,
  },
  joinBrowser: {
    ...bump,
    owned: "false",
    browserUp: "true",
    startFail: "'none'",
    openAnswer: "'none'",
    ...Object.fromEntries(
      Object.entries(freshTabs).map(([k, v]) => [k, `browserUp ? ${k} : ${v}`])
    ),
  },
  startSession: { buildFailing: "false" },
  // Assumed: when the first build fails, ayme closes the browser it opened.
  failStart: {
    startFail: "'buildError'",
    browserUp: "owned ? false : browserUp",
    t1: "owned ? false : t1",
    t2: "owned ? false : t2",
    active: "owned ? 0 : active",
    d1: "owned ? 0 : d1",
    d2: "owned ? 0 : d2",
  },
  endSession: {
    ...sessionReset,
    browserUp: "(aCmd == 'close' && owned) ? false : browserUp",
    t1: "(aCmd == 'close' && owned) ? false : t1",
    t2: "(aCmd == 'close' && owned) ? false : t2",
    active: "(aCmd == 'close' && owned) ? 0 : active",
    d1: "(aCmd == 'close' && owned) ? 0 : d1",
    d2: "(aCmd == 'close' && owned) ? 0 : d2",
    closedByAyme: "(aCmd == 'close' && owned) ? 'owned' : closedByAyme",
    detachEndedOwn: "detachEndedOwn || (aCmd == 'detach' && owned)",
  },
  refuseOpen: { ...bump, openAnswer: "'nameInUse'" },
  answerOpened: { openAnswer: "'started'" },
  answerOpenFailed: {
    openAnswer: "startFail == 'buildError' ? 'buildError' : 'browserGone'",
  },
  // Page Objects and Swap.
  edit: { ...bump, renamePending: "renamePending || event.rename" },
  buildSucceeded: { buildFailing: "false" },
  buildFailed: { buildFailing: "true", renamePending: "false" },
  swap: {
    swapDuringRun: `swapDuringRun || ${anyRun}`,
    swapWhileStopped: "swapWhileStopped || s1 != 0 || s2 != 0",
    // A renamed class is a new Page Object; the next read gives it a new id.
    id1: "renamePending ? 0 : id1",
    id2: "renamePending ? 0 : id2",
    renamePending: "false",
  },
  endStoppedAction: { ...onEventTab("s", "0") },
  read: {
    ...onEventTab("id", newId),
    ...onEventTab("c", `${perTabValue("event.tab", "c1", "c2", "0")} + 1`),
    g: "g + 1",
    sessionHw: `max(sessionHw, ${newId})`,
    idReused: `idReused || ${newId} <= sessionHw`,
    idRepeatsEarlierSession: `idRepeatsEarlierSession || ${newId} <= earlierHw`,
  },
  // Callers.
  sendCommand: { ...bump, aCmd: "event.c" },
  bindAgentTab: { aTab: "active" },
  agentRefusedForDialog: {
    refusedYoung: `(${dlg("aTab")} == 1 && ${dlgInRun("aTab")}) ? aTab : refusedYoung`,
  },
  agentRefusedHidden: {
    refusedHiddenAfterSwitch: "refusedHiddenAfterSwitch || active != aTab",
  },
  answerListing: { listLine: "buildFailing ? 'tabAndFailing' : 'tabOnly'" },
  stopAgentAction: {
    ...onEventTab("d", "2"),
    s1: "aTab == 1 ? 1 : s1",
    s2: "aTab == 2 ? 1 : s2",
  },
  bindInspectorTab: { ...bump, wTab: "active" },
  inspectorRefusedForDialog: {
    refusedYoung: `(${dlg("wTab")} == 1 && ${dlgInRun("wTab")}) ? wTab : refusedYoung`,
  },
  stopInspectorAction: {
    ...onEventTab("d", "2"),
    s1: "wTab == 1 ? 1 : s1",
    s2: "wTab == 2 ? 1 : s2",
  },
};

const tabs = [{ tab: 1 }, { tab: 2 }];
const allEvents = {
  OPEN: [{}],
  ATTACH: [{}],
  COMMAND: [{ c: "list" }, { c: "call" }, { c: "close" }, { c: "detach" }],
  RUN: [{}],
  EDIT: [{ rename: false }, { rename: true }],
  DIALOG_OPEN: tabs,
  DIALOG_CLOSE: tabs,
  DIALOG_TIMEOUT: tabs,
  TAB_SWITCH: tabs,
  TAB_OPEN: tabs,
  TAB_CLOSE: tabs,
  HIDE: [{}],
  SHOW: [{}],
  NAVIGATE: tabs,
  BROWSER_GONE: [{}],
  FIRST_BUILD: [{ ok: true }, { ok: false }],
  BUILD_DONE: [{ ok: true }, { ok: false }],
  STOPPED_END: tabs,
  READ: tabs,
  A_DONE: [{ ok: true }, { ok: false }],
  I_DONE: [{ ok: true }, { ok: false }],
};

// The Session's own steps, and the 100 ms passing. The developer, the agent,
// the page and the browser owe the model nothing; these are owed.
const sessionSteps = [
  "FIRST_BUILD",
  "OPENED",
  "OPEN_FAILED",
  "BUILD_DONE",
  "SWAP",
  "DIALOG_TIMEOUT",
  "STOPPED_END",
  "READ",
  "STOP_DONE",
  "A_NO_SESSION",
  "A_BEGIN",
  "A_LIST",
  "A_DIALOG_OPEN",
  "A_NO_TAB",
  "A_TAB_HIDDEN",
  "A_START",
  "A_DONE",
  "A_REFUSED",
  "I_DIALOG_OPEN",
  "I_NO_TAB",
  "I_TAB_HIDDEN",
  "I_START",
  "I_DONE",
];

const commonAssumptions = [
  `Every outside event (a command, a Run from the Inspector, an edit, a Tab change, hiding or showing the window, a dialog opening or closing, a navigation, the browser going away, \`ayme open\` or \`ayme attach\`) counts against a budget of ${BUDGET} per run; the Session's own steps are free. A liveness rule therefore asks: once the outside world stops acting, does every pending command get its answer from the Session alone?`,
  "Weak fairness covers only the Session's own steps and the 100 ms passing. A dialog nobody answers and a window nobody shows again may stay that way forever.",
  "Two Tabs, both open when a Session starts. `active` is the most recently active Tab; `hidden` means the browser window is minimised or covered, so the active Tab is hidden too. A Tab that is not active is hidden.",
  "Two Callers: the agent's `ayme` commands and the Inspector. Each has one command pending at a time; `ayme open` and `ayme attach` are a third slot (`opener`), so another command can arrive while a Session starts. A command is bound to the active Tab when the Session begins handling it, and stays bound to that Tab.",
  "Commands that need the page: `ayme page-objects`, `ayme tools` (both `list` here) and `ayme call` (`call`). `ayme close` and `ayme detach` do not.",
  "A waiting `ayme call` fails at once when its Tab is hidden, whether it was hidden on arrival or while it waited for its turn (rule 6 read as: a Run never waits for a Tab to be shown).",
  'A dialog belongs to one Tab. It "opened during a Run" when a Run on that same Tab was running when it opened. The 100 ms passing is one step (DIALOG_TIMEOUT).',
  "A Run's action is blocked while a dialog is open on its Tab. A Run whose Tab has no dialog finishes by itself (its own waits are respected and end), with a result or with an error from Page Object code.",
  "A stopped action (the action of a Run that a dialog ended) is `1` while blocked under the dialog and `2` once the dialog closed; it then ends by itself because ayme refuses its next Playwright call. A new dialog on that Tab blocks it again.",
  "A Swap is one step and does not read the page. It waits while any Run is running, on either Tab; it does not wait for a stopped action.",
  "A command is answered when the Session ends (close, detach, browser gone); `ayme close` ends the Session at once and does not wait for a Run.",
  "`ayme open` claims the session name in the same step as it checks it.",
  "When the first build fails, ayme closes the browser it opened.",
  "No guard cites code: the rules are agreed and the Session is not built. Citations point at ayme's runtime only where the model leans on it.",
];

function rulesFile({
  name,
  focus,
  offGuards = [],
  events,
  init,
  rules,
  assumptions = [],
}) {
  const g = { ...guards };
  for (const off of offGuards) g[off] = "false";
  const ev = {};
  for (const [type, payloads] of Object.entries({ ...allEvents, ...events }))
    ev[type] = { payloads };
  const file = {
    context,
    init,
    guards: g,
    actions,
    events: ev,
    fairness: { weak: sessionSteps },
    citations: {
      agentCanStart: "packages/ayme/src/runtime/session.ts:592-593",
      inspectorCanStart: "packages/ayme/src/runtime/session.ts:592-593",
      read: "packages/ayme/src/page-objects/application/pageObjectIds.ts:16-70",
    },
    rules,
    bounds: { maxStates: 1500000, timeoutMs: 0 },
    assumptions: [`Focus: ${focus}`, ...commonAssumptions, ...assumptions],
  };
  writeFileSync(
    join(here, `${name}.rules.json`),
    `${JSON.stringify(file, null, 2)}\n`
  );
}

const agentWaits = "!in('agent.idle')";
const agentNeedsPage = "(in('agent.listing') || in('agent.waitingForTurn'))";
const inspectorNeedsPage = "in('inspector.waitingForTurn')";
const perTab = (f) => `(${f(1)}) || (${f(2)})`;

// The runs focus: what happens on the page.
rulesFile({
  name: "runs",
  focus:
    "Runs, dialogs, hidden Tabs, Tab changes, edits and Swaps (rules 1, 3, 4, 5, 6, 7, 9 and 12). `ayme close`, `ayme detach`, `ayme attach`, the browser going away, navigation, new Tabs and ids are off. Four initial states: a Run whose Tab is hidden mid-Run stalls or finishes (`hiddenStalls`), and a listing waits for the Tab's turn or does not (`listQueues`).",
  offGuards: [
    "canNavigate",
    "canRead",
    "canOpenTab",
    "browserCanGo",
    "canAttach",
    "attachNameInUse",
  ],
  events: {
    COMMAND: [{ c: "list" }, { c: "call" }],
    EDIT: [{ rename: false }],
  },
  init: [
    start,
    { ...start, hiddenStalls: true },
    { ...start, listQueues: true },
    { ...start, hiddenStalls: true, listQueues: true },
  ],
  rules: [
    {
      id: "R1_AgentCommandAnswered",
      kind: "leads-to",
      description:
        "Rule 1: every `ayme` command gets an answer (a Tab hidden mid-Run finishes its page work).",
      when: `!hiddenStalls && ${agentWaits}`,
      then: "in('agent.idle')",
    },
    {
      id: "R1_InspectorRunAnswered",
      kind: "leads-to",
      description:
        "Rule 1: every Run from the Inspector gets an answer (a Tab hidden mid-Run finishes its page work).",
      when: "!hiddenStalls && !in('inspector.idle')",
      then: "in('inspector.idle')",
    },
    {
      id: "HiddenMidRun_AgentCommandAnswered",
      kind: "leads-to",
      description:
        "No rule yet: rule 1 when a Tab hidden mid-Run stalls its page work until it is shown.",
      when: `hiddenStalls && ${agentWaits}`,
      then: "in('agent.idle')",
    },
    {
      id: "HiddenMidRun_InspectorRunAnswered",
      kind: "leads-to",
      description:
        "No rule yet: rule 1 for the Inspector when a Tab hidden mid-Run stalls.",
      when: "hiddenStalls && !in('inspector.idle')",
      then: "in('inspector.idle')",
    },
    {
      id: "R3_OneRunPerTab",
      kind: "never",
      description:
        "Rules 3 and 4: at most one Run, or the stopped action of one, holds a Tab, whichever Caller started it.",
      when: `(${runsOn(1)}) > 1 || (${runsOn(2)}) > 1`,
    },
    {
      id: "R4_DialogEndsRunAfter100ms",
      kind: "never",
      description:
        "Rule 4: no Run is still running once a dialog on its Tab has been open for 100 ms.",
      when: perTab((t) => `${runOn(t)} && ${dlg(t)} == 2`),
    },
    {
      id: "R4_StoppedActionEnds",
      kind: "leads-to",
      description:
        "Rule 4: once its dialog is closed, a stopped action ends by itself.",
      when: "!hiddenStalls && (s1 == 2 || s2 == 2)",
      then: "s1 != 2 && s2 != 2",
    },
    {
      id: "R5_DialogAnswersAtOnce_Agent",
      kind: "leads-to",
      description:
        "Rule 5: while a dialog is open on its Tab, a command that needs the page is answered without anyone answering the dialog.",
      when: `${agentNeedsPage} && ${dlg("aTab")} != 0`,
      then: `in('agent.idle') || ${dlg("aTab")} == 0`,
    },
    {
      id: "R5_DialogAnswersAtOnce_Inspector",
      kind: "leads-to",
      description: "Rule 5 for a Run from the Inspector.",
      when: `${inspectorNeedsPage} && ${dlg("wTab")} != 0`,
      then: `in('inspector.idle') || ${dlg("wTab")} == 0`,
    },
    {
      id: "R6_HiddenTabFailsAtOnce",
      kind: "leads-to",
      description:
        "Rule 6: an `ayme call` for a hidden Tab is answered without anyone showing the Tab.",
      when: `in('agent.waitingForTurn') && ${tabOpen("aTab")} && !${visible("aTab")}`,
      then: `in('agent.idle') || ${visible("aTab")}`,
    },
    {
      id: "R7_NoSwapDuringRun",
      kind: "never",
      description: "Rule 7: Page Objects are swapped only between Runs.",
      when: "swapDuringRun",
    },
    {
      id: "R7_BuildIsSwappedIn",
      kind: "leads-to",
      description:
        "Rule 7: a successful build is swapped in (a Tab hidden mid-Run finishes its page work).",
      when: "!hiddenStalls && in('life.running.pageObjects.waitingToSwap')",
      then: "!in('life.running.pageObjects.waitingToSwap')",
    },
    {
      id: "HiddenMidRun_BuildIsSwappedIn",
      kind: "leads-to",
      description: "No rule yet: rule 7 when a Tab hidden mid-Run stalls.",
      when: "hiddenStalls && in('life.running.pageObjects.waitingToSwap')",
      then: "!in('life.running.pageObjects.waitingToSwap')",
    },
    {
      id: "R9_WorksOnMostRecentTab",
      kind: "never",
      description: "Rule 9: ayme's Tab is open whenever a Tab is open.",
      when: "(active == 0 && (t1 || t2)) || (active == 1 && !t1) || (active == 2 && !t2)",
    },
    {
      id: "Reach_DialogWhileSwapWaits",
      kind: "reachable",
      then: `in('life.running.pageObjects.waitingToSwap') && (${perTab((t) => `${runOn(t)} && ${dlg(t)} != 0`)})`,
    },
    {
      id: "Reach_RunKeptAfterDialogClosedIn100ms",
      kind: "reachable",
      then: "runKeptAfterDialog",
    },
    {
      id: "Reach_RunWaitsForStoppedAction",
      kind: "reachable",
      then: `(in('agent.waitingForTurn') && ${stopped("aTab")} == 2) || (in('inspector.waitingForTurn') && ${stopped("wTab")} == 2)`,
    },
    {
      id: "Q_SwapWhileStoppedActionEnds",
      kind: "reachable",
      description:
        "Question: a Swap happens while the old Page Objects' stopped action has not ended.",
      then: "swapWhileStopped",
    },
    {
      id: "Q_RefusedForDialogThatPassed",
      kind: "reachable",
      description:
        'Question: a Caller is told "a dialog is open" for a dialog that then closes within the 100 ms, and the Run it would have waited for goes on.',
      then: "refusedForPassingDialog",
    },
    {
      id: "Q_QueuedRunFailsAfterTabSwitch",
      kind: "reachable",
      description:
        "Question: an `ayme call` waiting for its turn fails as hidden because the user switched Tabs while it waited.",
      then: "refusedHiddenAfterSwitch",
    },
    {
      id: "Q_ListingWaitsOnHiddenTab",
      kind: "reachable",
      description:
        "Question: with listings waiting for the Tab's turn, a listing waits behind a Run stalled on a hidden Tab.",
      then: `listQueues && hiddenStalls && in('agent.listing') && ${runOn("aTab")} && !${visible("aTab")}`,
    },
  ],
});

// The lifecycle focus: start, end and the browser, with Runs and dialogs on
// one Tab so the end can land in the middle of them.
rulesFile({
  name: "lifecycle",
  focus:
    "starting, ending, `ayme open`, `ayme attach`, `ayme close`, `ayme detach` and the browser going away, crossed with Runs and dialogs on one Tab (rules 1, 2, 10, 11 and 12). Tab changes, hiding, edits, navigation and ids are off.",
  offGuards: [
    "canSwitchTab",
    "canOpenTab",
    "canCloseTab",
    "canHide",
    "canShow",
    "canNavigate",
    "canRead",
    "canEdit",
  ],
  events: {
    DIALOG_OPEN: [{ tab: 1 }],
    DIALOG_CLOSE: [{ tab: 1 }],
    DIALOG_TIMEOUT: [{ tab: 1 }],
    STOPPED_END: [{ tab: 1 }],
  },
  init: start,
  rules: [
    {
      id: "R1_AgentCommandAnswered",
      kind: "leads-to",
      description:
        "Rule 1: every `ayme` command gets an answer, including during a start and an end.",
      when: agentWaits,
      then: "in('agent.idle')",
    },
    {
      id: "R1_OpenAnswered",
      kind: "leads-to",
      description: "Rule 1: `ayme open` and `ayme attach` get an answer.",
      when: "in('opener.waiting')",
      then: "in('opener.idle')",
    },
    {
      id: "R1_InspectorRunAnswered",
      kind: "leads-to",
      description:
        "Rule 1: every Run from the Inspector gets an answer, including when the Session ends under it.",
      when: "!in('inspector.idle')",
      then: "in('inspector.idle')",
    },
    {
      id: "R2_NoSessionWithoutBrowser",
      kind: "never",
      description:
        "Rule 2: a Session never runs, or starts, without its browser.",
      when: "(in('life.running') || in('life.starting')) && !browserUp",
    },
    {
      id: "R10_OpenReportsBuildError",
      kind: "never",
      description:
        "Rule 10: `ayme open` never reports a start when the first build failed.",
      when: "openAnswer == 'started' && startFail == 'buildError'",
    },
    {
      id: "R11_CloseOnlyOwnBrowser",
      kind: "never",
      description: "Rule 11: ayme never closes a browser it joined.",
      when: "closedByAyme == 'notOwned'",
    },
    {
      id: "R11_DetachRefusedOnOwnBrowser",
      kind: "never",
      description:
        "Rule 11: `ayme detach` never ends a Session on a browser ayme opened.",
      when: "detachEndedOwn",
    },
    {
      id: "R11_OwnBrowserNeverLeftAlone",
      kind: "never",
      description:
        "Rules 2, 10 and 11 together: a browser ayme opened never keeps running without a Session.",
      when: "in('life.noSession') && browserUp && owned",
    },
    {
      id: "Reach_CloseDuring100ms",
      kind: "reachable",
      then: "in('inspector.running') && d1 == 1 && in('agent.ending')",
    },
    {
      id: "Reach_CloseWhileStoppedActionEnds",
      kind: "reachable",
      then: "s1 == 2 && in('agent.ending')",
    },
    {
      id: "Reach_DialogDuringStart",
      kind: "reachable",
      then: "in('life.starting') && d1 != 0 && in('agent.waitingForStart')",
    },
    {
      id: "Reach_JoinedBrowserLeftWithDialog",
      kind: "reachable",
      then: "in('life.noSession') && browserUp && !owned && d1 != 0",
    },
  ],
});

// The ids focus: Page Object Ids across reads, Swaps, navigation, Tabs and
// Sessions.
rulesFile({
  name: "ids",
  focus:
    "Page Object Ids across reads, Swaps, navigation, opening and closing Tabs, and Sessions (rules 8 and 9). Two initial states: one id counter for the whole Session (`scheme: session`), and ayme's runtime as it is, one counter per page (`scheme: perPage`). Runs, listings, dialogs, hiding, the Inspector and attach are off.",
  offGuards: [
    "canOpenDialog",
    "canHide",
    "canShow",
    "canRunFromInspector",
    "canAttach",
    "attachNameInUse",
  ],
  events: {
    COMMAND: [{ c: "close" }],
  },
  init: [start, { ...start, scheme: "perPage" }],
  assumptions: [
    "A read gives a Page Object without an id the next id, as packages/ayme/src/page-objects/application/pageObjectIds.ts:16-70 does. NAVIGATE replaces a Tab's page and its elements; an edit with `rename` changes a class name, so the Swap drops the ids and the next read gives new ones. A Tab reopened in a closed Tab's slot is a new Tab.",
  ],
  rules: [
    {
      id: "R8_UniqueAcrossTabs_SessionCounter",
      kind: "never",
      description:
        "Rule 8 with one counter per Session: two Tabs never show the same id.",
      when: "scheme == 'session' && id1 != 0 && id1 == id2",
    },
    {
      id: "R8_NeverReusedInSession_SessionCounter",
      kind: "never",
      description:
        "Rule 8 with one counter per Session: an id is never given to another Page Object in that Session.",
      when: "scheme == 'session' && idReused",
    },
    {
      id: "R8_UniqueAcrossTabs_RuntimePerPageCounter",
      kind: "never",
      description: "Rule 8 with ayme's runtime as it is, one counter per page.",
      when: "scheme == 'perPage' && id1 != 0 && id1 == id2",
    },
    {
      id: "R8_NeverReusedInSession_RuntimePerPageCounter",
      kind: "never",
      description:
        "Rule 8 with ayme's runtime as it is: an id is never given again in that Session.",
      when: "scheme == 'perPage' && idReused",
    },
    {
      id: "R9_WorksOnMostRecentTab",
      kind: "never",
      description: "Rule 9: ayme's Tab is open whenever a Tab is open.",
      when: "(active == 0 && (t1 || t2)) || (active == 1 && !t1) || (active == 2 && !t2)",
    },
    {
      id: "Intended_NewSessionRepeatsIds",
      kind: "reachable",
      description: "Rule 8: a new Session starts its ids again.",
      then: "scheme == 'session' && idRepeatsEarlierSession",
    },
    {
      id: "Reach_BothTabsHaveIds",
      kind: "reachable",
      then: "id1 != 0 && id2 != 0",
    },
  ],
});
