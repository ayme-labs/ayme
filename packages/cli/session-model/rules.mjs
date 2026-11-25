// Writes the three rules files the session model is checked with. Each one
// checks the same statechart (session.json) with a different group of
// outside events switched on, so each run stays inside the checker's
// state budget. Run: node packages/cli/session-model/rules.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const CONNECTED = "in('life.running.browser.connected')";
const visible = (tab) => `(in('life.running.tab.working') && active == ${tab})`;
const orphanOn = (tab) => `(${tab} == 1 ? orph1 : orph2)`;
// The tab's turn on ayme's page queue is held by a running call, or by the
// page work of a call the session already answered (an "abandoned" call).
const turnHeld = (tab) =>
  `((in('agent.callRunning') && aTab == ${tab}) || (in('window.callRunning') && wTab == ${tab}) || ${orphanOn(tab)})`;
const turnsOn = (tab) =>
  `((in('agent.callRunning') && aTab == ${tab}) ? 1 : 0) + ((in('window.callRunning') && wTab == ${tab}) ? 1 : 0) + (${orphanOn(tab)} ? 1 : 0)`;
const listable = "(hasGood || in('life.running.pageObjects.failed'))";

const context = {
  ext: { min: 0, max: 5 },
  owned: "bool",
  browserUp: "bool",
  record: "bool",
  active: { min: 1, max: 2 },
  dialog: { min: 0, max: 2 },
  hasGood: "bool",
  lastFailed: "bool",
  aTab: { min: 1, max: 2 },
  aClose: "bool",
  wTab: { min: 1, max: 2 },
  orph1: "bool",
  orph2: "bool",
  win1: "bool",
  win2: "bool",
  pickBy: { min: 0, max: 2 },
  pickAsk: { min: 0, max: 2 },
  listFirstLine: ["none", "tab", "tabAndFailing", "tabWhileLastBuildFailed"],
  swappedUnderPageWork: "bool",
  closedByAyme: ["none", "owned", "notOwned"],
  scheme: ["session", "perPage"],
  id1: { min: 0, max: 3 },
  id2: { min: 0, max: 3 },
  g1: { min: 0, max: 3 },
  g2: { min: 0, max: 3 },
  hw: { min: 0, max: 3 },
  renamePending: "bool",
  idReused: "bool",
};

const start = {
  ext: 0,
  owned: false,
  browserUp: false,
  record: false,
  active: 1,
  dialog: 0,
  hasGood: false,
  lastFailed: false,
  aTab: 1,
  aClose: false,
  wTab: 1,
  orph1: false,
  orph2: false,
  win1: false,
  win2: false,
  pickBy: 0,
  pickAsk: 0,
  listFirstLine: "none",
  swappedUnderPageWork: false,
  closedByAyme: "none",
  scheme: "session",
  id1: 0,
  id2: 0,
  g1: 0,
  g2: 0,
  hw: 0,
  renamePending: false,
  idReused: false,
};

const out = "ext < 5";
const bump = { ext: "ext + 1" };
// What a session's end clears: everything but the browser, the agent's last
// answer and the id high-water mark.
const sessionReset = {
  dialog: "0",
  hasGood: "false",
  lastFailed: "false",
  orph1: "false",
  orph2: "false",
  win1: "false",
  win2: "false",
  pickBy: "0",
  pickAsk: "0",
  active: "1",
  id1: "0",
  id2: "0",
  g1: "0",
  g2: "0",
  hw: "max(hw, max(g1, g2))",
  renamePending: "false",
};

const guards = {
  outside: out,
  canStart: out,
  browserCanGo: out,
  stopAsked: "in('agent.stopping') && in('life.running')",
  abandonedWorkEnds: `event.tab == 1 ? (orph1 && ${visible(1)} && dialog != 1) : (orph2 && ${visible(2)} && dialog != 2)`,
  canNavigate: `${out} && ${CONNECTED} && (event.tab == 1 ? id1 != 0 : id2 != 0)`,
  canRead: `${CONNECTED} && hasGood && (event.tab == 1 ? id1 == 0 : id2 == 0)`,
  canOpenDialog: `${out} && dialog == 0`,
  dialogIsOpen: `${out} && dialog != 0`,
  buildOk: "event.ok",
  canEdit: out,
  // The session's own view of "a call is running": its own requests.
  canSwap: "!in('agent.callRunning') && !in('window.callRunning')",
  canSwitchTab: `${out} && event.tab != active`,
  canHideTab: out,
  canOpenWindow: `${out} && (event.w == 1 ? !win1 : !win2)`,
  closesLastWindow: `${out} && (event.w == 1 ? (win1 && !win2) : (win2 && !win1))`,
  closesAWindow: `${out} && (event.w == 1 ? win1 : win2)`,
  closesPicker: `${out} && event.w == pickBy && (event.w == 1 ? win1 : win2)`,
  canAskPick: `${out} && pickAsk == 0 && (event.w == 1 ? win1 : win2)`,
  pickIsStarting: "pickAsk != 0",
  askWithoutSession: `${out} && in('life.noSession')`,
  canAsk: `${out} && in('life.running')`,
  agentTabHasDialog: "dialog != 0 && dialog == aTab",
  agentCanList: `${CONNECTED} && dialog != aTab && ${listable} && !${turnHeld("aTab")}`,
  agentTabHidden: `${CONNECTED} && !${visible("aTab")}`,
  noGoodPageObjects: "in('life.running.pageObjects.failed') && !hasGood",
  agentCanStart: `${CONNECTED} && ${visible("aTab")} && dialog != aTab && hasGood && !${turnHeld("aTab")}`,
  agentPageFree: `${visible("aTab")} && dialog != aTab`,
  canRun: `${out} && in('life.running') && (in('life.running.inspector.windowOpen') || in('life.running.inspector.picking'))`,
  windowTabHasDialog: "dialog != 0 && dialog == wTab",
  windowTabHidden: `${CONNECTED} && !${visible("wTab")}`,
  windowCanStart: `${CONNECTED} && ${visible("wTab")} && dialog != wTab && hasGood && !${turnHeld("wTab")}`,
  windowPageFree: `${visible("wTab")} && dialog != wTab`,
};

const newId =
  "scheme == 'session' ? g1 + 1 : (event.tab == 1 ? g1 + 1 : g2 + 1)";
const actions = {
  countOutside: bump,
  startOwnBrowser: {
    ...bump,
    record: "true",
    owned: "true",
    browserUp: "true",
  },
  joinBrowser: { ...bump, record: "true", owned: "false", browserUp: "true" },
  browserGone: {
    ...bump,
    ...sessionReset,
    record: "false",
    browserUp: "false",
  },
  endSession: {
    ...sessionReset,
    record: "false",
    browserUp: "(aClose && owned) ? false : browserUp",
    closedByAyme: "aClose ? (owned ? 'owned' : closedByAyme) : closedByAyme",
  },
  endAbandonedWork: {
    orph1: "event.tab == 1 ? false : orph1",
    orph2: "event.tab == 2 ? false : orph2",
  },
  openDialog: { ...bump, dialog: "event.tab" },
  answerDialog: { ...bump, dialog: "0" },
  keepBuild: { hasGood: "true", lastFailed: "false" },
  failBuild: { lastFailed: "true" },
  edit: { ...bump, renamePending: "renamePending || event.rename" },
  swap: {
    swappedUnderPageWork: "swappedUnderPageWork || orph1 || orph2",
    id1: "renamePending ? 0 : id1",
    id2: "renamePending ? 0 : id2",
    renamePending: "false",
  },
  switchTab: { ...bump, active: "event.tab" },
  openWindow: {
    ...bump,
    win1: "event.w == 1 ? true : win1",
    win2: "event.w == 2 ? true : win2",
  },
  closeWindow: {
    ...bump,
    win1: "event.w == 1 ? false : win1",
    win2: "event.w == 2 ? false : win2",
  },
  closeWindowEndPick: {
    ...bump,
    win1: "event.w == 1 ? false : win1",
    win2: "event.w == 2 ? false : win2",
    pickBy: "0",
  },
  askPick: { ...bump, pickAsk: "event.w" },
  beginPick: { pickBy: "pickAsk", pickAsk: "0" },
  endPick: { ...bump, pickBy: "0" },
  answerNoSession: bump,
  askList: { ...bump, aTab: "event.tab", listFirstLine: "'none'" },
  askCall: { ...bump, aTab: "event.tab" },
  askDetach: { ...bump, aClose: "false" },
  askClose: { ...bump, aClose: "true" },
  answerList: {
    listFirstLine:
      "in('life.running.pageObjects.failed') ? 'tabAndFailing' : (lastFailed ? 'tabWhileLastBuildFailed' : 'tab')",
  },
  abandonAgentCall: {
    orph1: "aTab == 1 ? true : orph1",
    orph2: "aTab == 2 ? true : orph2",
  },
  askRun: { ...bump, wTab: "event.tab" },
  abandonWindowCall: {
    orph1: "wTab == 1 ? true : orph1",
    orph2: "wTab == 2 ? true : orph2",
  },
  navigate: {
    ...bump,
    id1: "event.tab == 1 ? 0 : id1",
    id2: "event.tab == 2 ? 0 : id2",
  },
  read: {
    id1: `event.tab == 1 ? (${newId}) : id1`,
    id2: `event.tab == 2 ? (${newId}) : id2`,
    g1: "(scheme == 'session' || event.tab == 1) ? g1 + 1 : g1",
    g2: "(scheme == 'perPage' && event.tab == 2) ? g2 + 1 : g2",
    idReused: `idReused || (${newId}) <= hw`,
  },
};

const tabs = [{ tab: 1 }, { tab: 2 }];
const windows = [{ w: 1 }, { w: 2 }];
const allEvents = {
  LIST: tabs,
  CALL: tabs,
  RUN: tabs,
  TAB_SWITCH: tabs,
  DIALOG_OPEN: tabs,
  ORPHAN_DONE: tabs,
  NAVIGATE: tabs,
  READ: tabs,
  BUILD_DONE: [{ ok: true }, { ok: false }],
  EDIT: [{ rename: false }, { rename: true }],
  WINDOW_OPEN: windows,
  WINDOW_CLOSE: windows,
  PICK_ASK: windows,
};

// The session's own steps. The developer, the agent, the page and the
// browser owe the model nothing; the session owes every one of these.
const sessionSteps = [
  "BROWSER_READY",
  "BUILD_DONE",
  "SWAP",
  "ORPHAN_DONE",
  "READ",
  "PICK_BEGIN",
  "STOP_DONE",
  "A_LIST",
  "A_DIALOG",
  "A_HIDDEN",
  "A_NO_PAGE_OBJECTS",
  "A_START",
  "A_DONE",
  "W_DIALOG",
  "W_HIDDEN",
  "W_NO_PAGE_OBJECTS",
  "W_START",
  "W_DONE",
];

const commonAssumptions = [
  "Every outside event (a request, an edit, a tab change, a dialog, a window, the browser going away, a start, detach or close) counts against a budget of 5 per run; the session's own steps are free. A liveness rule therefore asks: once the outside world stops acting, does every pending request get its answer from the session alone?",
  "Weak fairness covers only the session's own steps. A dialog nobody answers and a tab nobody shows again are allowed to stay that way forever.",
  "Two tabs. ayme works on the tab in front (`active`); the other tab is hidden. TAB_HIDE hides the front tab too (window minimised or covered).",
  "Two callers: the agent's `ayme` commands (one request at a time) and Inspector windows running a tool. Each queues on ayme's per-page run queue (packages/ayme/src/runtime/session.ts:593).",
  "A Playwright action on a tab with an open dialog, or on a hidden tab, does not finish until the dialog is answered or the tab is shown again.",
  "When the session answers a call early (dialog open, tab hidden), the call's page work keeps the tab's turn on the queue until it really ends (`orph1`, `orph2`): ayme's run queue releases a turn only when its promise settles (packages/ayme/src/runs/application/run.ts:85-91).",
  "A pageObjects listing takes a turn on the page queue, as page_objects does in ayme's runtime, and is modelled as one step. A tools listing would not queue.",
  "The session swaps rebuilt Page Objects when none of its own call requests is running.",
  "A listing's first line names its tab and, when the Page Objects state is `build failed`, says so: one line carries both (rules 6 and 8 each claim the first line).",
  "Request with no session: answered at once by the thin front, in one step. A start's check and its claim of the record are one step.",
];

function rulesFile({
  name,
  focus,
  guardOff,
  events,
  init,
  rules,
  assumptions,
}) {
  const g = { ...guards };
  for (const off of guardOff) g[off] = "false";
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
      canSwap: "packages/ayme/src/runtime/session.ts:593",
      abandonAgentCall: "packages/ayme/src/runs/application/run.ts:85-91",
      abandonWindowCall: "packages/ayme/src/runs/application/run.ts:85-91",
      read: "packages/ayme/src/page-objects/application/pageObjectIds.ts:16-70",
    },
    rules,
    bounds: { maxStates: 400000, timeoutMs: 0 },
    assumptions: [`Focus: ${focus}`, ...commonAssumptions, ...assumptions],
  };
  writeFileSync(
    join(here, `${name}.rules.json`),
    `${JSON.stringify(file, null, 2)}\n`
  );
}

const agentBusy = "!in('agent.idle')";
const agentNeedsPage =
  "(in('agent.listing') || in('agent.calling') || in('agent.callRunning'))";

rulesFile({
  name: "requests",
  focus:
    "requests, calls, the page queue, dialogs, hidden tabs and hot reload (rules 1, 3, 4, 5, 6, 8, 9 and the queue half of 11). Pick, ids, attach and close are off; one Inspector window.",
  guardOff: ["canNavigate", "canRead", "canAskPick"],
  events: {
    WINDOW_OPEN: [{ w: 1 }],
    WINDOW_CLOSE: [{ w: 1 }],
    EDIT: [{ rename: false }],
  },
  init: start,
  assumptions: [],
  rules: [
    {
      id: "R1_AgentRequestAnswered",
      kind: "leads-to",
      description:
        "Rule 1: every request from an `ayme` command gets an answer.",
      when: agentBusy,
      then: "in('agent.idle')",
    },
    {
      id: "R1_InspectorRunAnswered",
      kind: "leads-to",
      description:
        "Rule 1: every tool run from an Inspector window gets an answer.",
      when: "!in('window.idle')",
      then: "in('window.idle')",
    },
    {
      id: "R3_DialogAnswersWithoutWaiting",
      kind: "leads-to",
      description:
        "Rule 3: while a dialog is open on its tab, a request that needs the page is answered by the session alone, without anyone answering the dialog.",
      when: `${agentNeedsPage} && dialog != 0 && dialog == aTab`,
      then: "in('agent.idle')",
    },
    {
      id: "R4_OneCallPerPage",
      kind: "never",
      description: "Rule 4: at most one call holds a page's turn.",
      when: `(${turnsOn(1)}) > 1 || (${turnsOn(2)}) > 1`,
    },
    {
      id: "R5_NoSwapDuringCall",
      kind: "never",
      description:
        "Rule 5: the Page Objects are never swapped while a call's work is still running on a page.",
      when: "swappedUnderPageWork",
    },
    {
      id: "R5_RebuildIsSwappedIn",
      kind: "leads-to",
      description: "Rule 5: a finished rebuild is swapped in.",
      when: "in('life.running.pageObjects.built')",
      then: "!in('life.running.pageObjects.built')",
    },
    {
      id: "R6_ListingSaysBuildFailing",
      kind: "never",
      description:
        "Rule 6: no listing answered while the last finished build failed leaves out that the build is failing.",
      when: "listFirstLine == 'tabWhileLastBuildFailed'",
    },
    {
      id: "R9_HiddenTabCallFailsAtOnce",
      kind: "leads-to",
      description:
        "Rule 9: a call on a hidden tab is answered by the session alone.",
      when: `(in('agent.calling') || in('agent.callRunning')) && ${CONNECTED} && !${visible("aTab")}`,
      then: "in('agent.idle')",
    },
    {
      id: "Reach_SwapWaiting",
      kind: "reachable",
      then: "in('life.running.pageObjects.built') && in('agent.callRunning')",
    },
    { id: "Reach_AbandonedWork", kind: "reachable", then: "orph1 || orph2" },
    {
      id: "Reach_TwoCallersQueued",
      kind: "reachable",
      then: "in('agent.calling') && in('window.callRunning') && aTab == wTab",
    },
  ],
});

rulesFile({
  name: "lifecycle",
  focus:
    "starting, ending, detach, close, the browser going away, Inspector windows and picks (rules 2, 10, 11 and 12). Calls, dialogs, tab changes, edits and ids are off.",
  guardOff: [
    "canNavigate",
    "canRead",
    "canOpenDialog",
    "canSwitchTab",
    "canHideTab",
    "canEdit",
    "canRun",
  ],
  events: { CALL: [{ tab: 1 }], EDIT: [{ rename: false }] },
  init: start,
  assumptions: [
    "`ayme close` on a browser ayme did not start ends the session and leaves the browser running (the rules leave this open).",
  ],
  rules: [
    {
      id: "R1_AgentRequestAnswered",
      kind: "leads-to",
      description: "Rule 1, here for start, stop and the browser going away.",
      when: agentBusy,
      then: "in('agent.idle')",
    },
    {
      id: "R2_NoSessionWithoutBrowser",
      kind: "never",
      description:
        "Rule 2: a session never keeps running after its browser went away.",
      when: "in('life.running') && !browserUp",
    },
    {
      id: "R2_RecordOnlyWhileRunning",
      kind: "never",
      description:
        "Rules 2 and 12: the session's record exists exactly while it runs.",
      when: "record != in('life.running')",
    },
    {
      id: "R10_CloseOnlyOwnBrowser",
      kind: "never",
      description: "Rule 10: ayme never closes a browser it did not start.",
      when: "closedByAyme == 'notOwned'",
    },
    {
      id: "R11_PickNeverOutlivesWindow",
      kind: "never",
      description:
        "Rule 11: a pick is never running for a window that is closed.",
      when: "(pickBy == 1 && !win1) || (pickBy == 2 && !win2)",
    },
    {
      id: "Q_OwnBrowserLeftWithoutSession",
      kind: "reachable",
      description:
        "Question: a browser ayme started keeps running with no session, so no `ayme` command can close it.",
      then: "in('life.noSession') && browserUp && owned",
    },
    {
      id: "Reach_Picking",
      kind: "reachable",
      then: "in('life.running.inspector.picking') && win1 && win2",
    },
  ],
});

rulesFile({
  name: "ids",
  focus:
    "Page Object ids across reads, rebuilds, navigation, tabs and sessions (rule 7). Two initial states: one id counter for the whole session (`scheme: session`), and ayme's runtime as it is, one counter per page (`scheme: perPage`). Requests, dialogs, windows and close are off.",
  guardOff: [
    "canOpenDialog",
    "canOpenWindow",
    "canAsk",
    "canRun",
    "canHideTab",
  ],
  events: { LIST: [{ tab: 1 }], CALL: [{ tab: 1 }] },
  init: [start, { ...start, scheme: "perPage" }],
  assumptions: [
    "A page read gives a Page Object without an id the next id, as packages/ayme/src/page-objects/application/pageObjectIds.ts:53-70 does. NAVIGATE replaces a tab's root element; an edit with `rename` changes a class name, so the swap drops the ids and the next read gives new ones.",
    "A new session starts its counter at 0; `hw` remembers the highest id an earlier session gave out.",
  ],
  rules: [
    {
      id: "R7_UniqueAcrossTabs_SessionCounter",
      kind: "never",
      description:
        "Rule 7 with one counter per session: two tabs never show the same id.",
      when: "scheme == 'session' && id1 != 0 && id1 == id2",
    },
    {
      id: "R7_UniqueAcrossTabs_RuntimePerPageCounter",
      kind: "never",
      description: "Rule 7 with ayme's runtime as it is, one counter per page.",
      when: "scheme == 'perPage' && id1 != 0 && id1 == id2",
    },
    {
      id: "R7_NotReusedAfterRestart",
      kind: "never",
      description:
        "Rule 7 read across sessions: an id an earlier session gave out is never given to a Page Object of a later session.",
      when: "idReused",
    },
    {
      id: "Reach_BothTabsHaveIds",
      kind: "reachable",
      then: "id1 != 0 && id2 != 0",
    },
  ],
});
