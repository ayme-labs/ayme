// The structural recorder. Interactions come from Playwright's own recorder in
// API mode; trees come from the public page.ariaSnapshot({ mode: 'ai' }),
// called from Node; Change Trees come from core's reconcile and renderers.
//
// Modes:
//   after   after-only: one public snapshot after each interaction settles.
//   before  + the free "before": the action's own snapshot splits the changes.
//   gate-a  + the gate, swallowing from pointerdown on.
//   gate-b  + the gate, swallowing only the final click.
// In the gate modes whatever the gate does not cover falls back to `before`.
import fs from "node:fs";
import path from "node:path";
import { startRecorder, HIDE_OVERLAY } from "./pw.mjs";
import {
  createParser,
  Observations,
  renderChangeTree,
  renderTree,
  changeCounts,
} from "./core.mjs";
import { buildBefore } from "./classify.mjs";
import { settle, QUIET_MS, DEADLINE_MS } from "./settle.mjs";
import { installGate, gateInitScript, readLags } from "./gate.mjs";
import { installTargetHints } from "./targetHint.mjs";

export const MODES = ["after", "before", "gate-a", "gate-b"];
const LIFECYCLE = ["openPage", "closePage", "navigate"];
// Playwright's own monotonic clock (isomorphic/time.ts), valid while its server
// runs in this process: the trace's action times are on the same clock.
export const monotonic = () => Math.floor(performance.now() * 1e3) / 1e3;

const FRAME_SEP = " >> internal:control=enter-frame >> ";
const MARK = "data-ayme-anc";

export class Recording {
  constructor({ context, page, mode, version, onEntry, trace, stamp }) {
    if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
    this.context = context;
    this.page = page;
    this.mode = mode;
    this.version = version;
    this.onEntry = onEntry ?? (() => {});
    this.parser = createParser();
    this.observations = new Observations(this.parser, { now: monotonic });
    this.entries = [];
    this.pages = new Map();
    this.queue = Promise.resolve();
    this.startedAt = Date.now();
    this.unpairedCycles = 0;
    this.label = null; // set by a scripted flow: the step the next actions belong to
    this.visits = []; // every visit of the recording, in order
    this.interactionSeq = 0;
    this.trace = trace ?? null; // { stamp } when stock tracing runs on the context
    if (stamp && stamp !== "none") throw new Error("This engine trial only supports unstamped stock traces");
    this.stamp = "none"; // how package refs get into trace snapshots
    this.tracePoints = new Map(); // interaction id -> the last trace point taken for it
    this.traceMarkMs = [];
    this.snapshotSeq = 0;
  }

  get gated() {
    return this.mode.startsWith("gate");
  }

  async start() {
    const { context } = this;
    if (this.gated) {
      const variant = this.mode === "gate-a" ? "A" : "B";
      await installGate(context, variant, {
        takeBefore: async (page) => {
          const visit = this.state(page).visits.at(-1);
          const snap = await this.snap(page);
          if (visit) await this.observations.observe(visit, snap);
          return snap;
        },
        onCycle: (cycle) => this.onCycle(cycle),
      });
      for (const page of context.pages())
        for (const frame of page.frames())
          await frame.evaluate(gateInitScript(variant)).catch(() => {});
    }
    // after-only stays the plain baseline: nothing of ours in the page
    if (this.mode !== "after") this.hints = await installTargetHints(context);
    await context.addInitScript(HIDE_OVERLAY);
    for (const page of context.pages())
      for (const frame of page.frames())
        await frame.evaluate(HIDE_OVERLAY).catch(() => {});
    this.recorder = await startRecorder(context, (event) =>
      this.onRecorderEvent(event)
    );
    context.on("page", (page) => this.watch(page));
    for (const page of context.pages()) this.watch(page);
    await this.queue;
    return this;
  }

  enqueue(job) {
    this.queue = this.queue.then(job).catch((error) => {
      console.error("recorder job failed:", error);
    });
    return this.queue;
  }

  state(page) {
    let st = this.pages.get(page);
    if (!st) {
      st = { visits: [], cycles: [], watched: false };
      this.pages.set(page, st);
    }
    return st;
  }

  // --- visits ---------------------------------------------------------------
  /** A visit per page load: every main-frame navigation that changes origin or path. */
  watch(page) {
    const st = this.state(page);
    if (st.watched) return;
    st.watched = true;
    // the trace names a page by the same guid (private client field)
    st.pageId = page._guid ?? `page@unknown-${this.pages.size}`;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.onNavigated(page, frame.url());
    });
    this.onNavigated(page, page.url());
  }

  onNavigated(page, url) {
    const st = this.state(page);
    if (!url || url === "about:blank") return;
    const cause = this.visits.length === 0 ? "initial" : st.visits.length === 0 ? "openPage" : "navigate";
    const registered = this.observations.session.recordNavigation({ pageId: st.pageId, url, cause });
    if (registered.kind !== "visit-started") return;
    const visit = {
      visitId: registered.visit.id,
      pageId: st.pageId,
      page,
      url,
      cause,
      startedAt: Date.now(),
      startedAtMono: monotonic(),
      baseline: null,
      last: null,
      trailing: null,
    };
    st.visits.push(visit);
    this.visits.push(visit);
    this.enqueue(() => this.baseline(page, visit));
  }

  async baseline(page, visit) {
    const st = this.state(page);
    if (visit.baseline) return;
    try {
      await settle(page);
      if (st.visits.at(-1) !== visit) return; // the page moved on before it could be read
      const snap = await this.snap(page);
      if (st.visits.at(-1) !== visit) return;
      await this.observations.observe(visit, snap);
      visit.baseline = visit.last = snap;
    } catch {
      // the page closed before it could be read
    }
  }

  /** Waits until the page's current visit has its baseline, e.g. after the first goto. */
  async rebaseline(page) {
    await this.queue;
    const visit = this.state(page).visits.at(-1);
    if (visit && !visit.baseline) await this.baseline(page, visit);
  }

  /** One public snapshot, parsed by core. */
  async snap(page) {
    const t = Date.now();
    const tMono = monotonic();
    const yaml = await page.ariaSnapshot({ mode: "ai" });
    const tracePoint = this.trace ? await this.tracePoint(`snapshot_${++this.snapshotSeq}`, page) : null;
    return {
      tracePoint,
      yaml,
      tree: this.parser.parse(yaml),
      t,
      tMono,
      ms: Date.now() - t,
    };
  }

  // --- the gate -----------------------------------------------------------
  onCycle(cycle) {
    const st = this.state(cycle.page);
    cycle.claimed = false;
    cycle.tMono = monotonic();
    cycle.beforeSnap = cycle.before;
    cycle.afterSnap = cycle.replayed.then(async (timing) => {
      cycle.timing = timing;
      const settled = await settle(cycle.page);
      // An input gated meanwhile already holds the state right after this one.
      const next = st.cycles.find((c) => c.tNotified > cycle.tNotified);
      if (next)
        return {
          ...(await next.beforeSnap),
          settle: { stable: false, cutShortByNextInput: true },
        };
      return { ...(await this.snap(cycle.page)), settle: settled };
    });
    cycle.afterSnap.catch(() => {});
    st.cycles.push(cycle);
  }

  claimCycles(entry, kind, count) {
    const st = this.state(entry.page);
    const free = st.cycles
      .filter((c) => c.kind === kind && !c.claimed)
      .slice(0, count);
    for (const cycle of free) cycle.claimed = true;
    entry.cycles.push(...free);
  }

  claimFor(entry) {
    if (!this.gated) return;
    const { name, clickCount } = entry.action;
    if (name === "press") {
      if (entry.cycles.length === 0) this.claimCycles(entry, "key", 1);
      return;
    }
    if (name === "check" || name === "uncheck") {
      if (entry.cycles.length === 0) this.claimCycles(entry, "click", 1);
      return;
    }
    // clickCount 0 is a keyboard or label activation: the gate let it through
    if (name === "click" && entry.action.button === "left" && clickCount >= 1)
      this.claimCycles(entry, "click", clickCount - entry.cycles.length);
  }

  // --- Playwright's recorder ----------------------------------------------
  onRecorderEvent({ kind, page, action, code }) {
    if (kind === "signalAdded") {
      this.entries.at(-1)?.signals.push(action.name);
      return;
    }
    const { ariaSnapshot, ...rest } = action;
    let entry;
    if (kind === "actionUpdated") {
      entry = this.entries.findLast((e) => e.page === page);
      if (!entry) return;
      // the first event snapshot stays: later ones show the action's own effects
      entry.action = rest;
      entry.code = code;
      entry.updates += 1;
    } else {
      entry = {
        index: this.entries.length,
        at: Date.now() - this.startedAt,
        label: this.label,
        tEvent: Date.now(),
        tEventMono: monotonic(),
        page,
        action: rest,
        code,
        eventSnapshot: ariaSnapshot,
        signals: [],
        cycles: [],
        updates: 0,
        version: 0,
      };
      this.entries.push(entry);
    }
    this.claimFor(entry);
    const version = (entry.version += 1);
    this.enqueue(async () => {
      if (entry.version !== version) return; // a later update finalizes it
      await this.finalize(entry);
    });
  }

  async finalize(entry) {
    const { page, action } = entry;
    // openPage, closePage and navigate describe the page, not a human interaction
    if (!page || LIFECYCLE.includes(action.name)) {
      entry.source = "none";
      this.onEntry(this.publicEntry(entry));
      return;
    }
    const st = this.state(page);
    // the visit the input happened in; the page may have left it since
    entry.interactionId ??= `interaction_${++this.interactionSeq}`;
    if (!entry.sessionStarted) {
      this.observations.session.recordActionStarted({
        kind: "action-started", pageId: st.pageId, actionId: entry.interactionId,
        at: entry.cycles[0]?.tMono ?? entry.tEventMono,
      });
      entry.sessionStarted = true;
    }
    const visitId = this.observations.session.actionOwningVisitId(entry.interactionId);
    const visit = (entry.visit ??= st.visits.find((v) => v.visitId === visitId));
    if (visit && !visit.baseline) await this.baseline(page, visit);
    if (!visit?.last) {
      entry.source = "none";
      this.onEntry(this.publicEntry(entry));
      return;
    }
    const base = (entry.base ??= visit.last);
    const urlBefore = (entry.urlBefore ??= visit.currentUrl ?? visit.url);
    let before = null;
    let after;
    let classifier = null;
    let targetRef;
    let locate = { ref: action.ref, exact: true };
    let crossed = false;

    if (entry.cycles.length > 0) {
      entry.source = "gate";
      before = await entry.cycles[0].beforeSnap;
      after = await entry.cycles.at(-1).afterSnap.catch(() => null);
      entry.gate = entry.cycles.map((c) => ({ kind: c.kind, ...c.timing }));
      // The input left the visit: what it led to is the next visit's baseline.
      crossed = st.visits.at(-1) !== visit;
      if (crossed)
        after = { ...before, settle: { stable: true, leftVisit: true } };
      else if (!after)
        after = { ...(await this.snap(page)), settle: { stable: false } };
      const scopeRef = crossed
        ? undefined
        : await this.scopeOf(page, action.selector);
      if (entry.eventSnapshot && scopeRef !== null) {
        // only to find the target in the tree: the before tree is the gate's own
        const event = this.parser.parse(entry.eventSnapshot);
        locate = this.locateIn(page, action, event);
        const located = buildBefore({
          prev: before.tree,
          next: after.tree,
          event,
          scopeRef,
          action,
          locate,
          parser: this.parser,
        });
        targetRef = located.targetRef;
      }
    } else {
      const settled = await settle(page);
      crossed = st.visits.at(-1) !== visit;
      // In a gate mode, an input gated after this action already froze the page.
      const cut = st.cycles.find((c) => c.tNotified > entry.tEvent);
      after = crossed
        ? { ...base, settle: { stable: true, leftVisit: true } }
        : cut
          ? {
              ...(await cut.beforeSnap),
              settle: { stable: false, cutShortByNextInput: true },
            }
          : { ...(await this.snap(page)), settle: settled };
      if (this.mode === "after") entry.source = "after-only";
      else {
        entry.source = "free-before";
        const scopeRef = crossed
          ? undefined
          : await this.scopeOf(page, action.selector);
        if (entry.eventSnapshot && scopeRef !== null) {
          const event = this.parser.parse(entry.eventSnapshot);
          locate = this.locateIn(page, action, event);
          const built = buildBefore({
            prev: base.tree,
            next: after.tree,
            event,
            scopeRef,
            action,
            locate,
            parser: this.parser,
          });
          before = { tree: built.before };
          targetRef = built.targetRef;
          classifier = built.stats;
        }
      }
    }

    before ??= base;
    await this.observations.observe(visit, before, { capturedForActionId: entry.interactionId, relation: "before" });
    if (crossed) after = before;
    await this.observations.observe(visit, after, { capturedForActionId: entry.interactionId, relation: "after" });
    const interaction = await this.observations.change(visit, before, after);
    const unassigned = await this.observations.change(visit, base, before);
    targetRef = after.refs.get(targetRef) ?? before.refs.get(targetRef) ?? targetRef;

    let target = {
      selector: action.selector ?? null,
      ref: null,
      exact: false,
      via: null,
    };
    // a before node matched to an after node carries the after node's ref
    if (targetRef && !interaction.hasNode(targetRef))
      targetRef = interaction
        .getAllRefs()
        .find(
          (ref) => interaction.getBeforeNodeForAfterRef(ref)?.ref === targetRef
        );
    if (targetRef && interaction.hasNode(targetRef))
      target = {
        ...target,
        ref: targetRef,
        exact: locate.exact,
        via: locate.exact
          ? "event snapshot"
          : "event snapshot, nearest ancestor at the moment of the action",
      };
    else if (action.selector && !crossed) {
      const walked = await this.walkToTree(page, action.selector, after.tree);
      if (walked) walked.ref = after.refs.get(walked.ref) ?? walked.ref;
      if (walked) target = { ...target, ...walked, via: "ancestor walk" };
    }

    if (action.name === "press" && action.selector === "body")
      target = { ...target, ref: null, exact: false, via: "no focused element" };

    if (process.env.AYME_DEBUG && before)
      console.error(
        "--- base\n" +
          renderTree(base.tree).split("\n").slice(0, 12).join("\n") +
          "\n--- virtual before\n" +
          renderTree(before.tree).split("\n").slice(0, 12).join("\n")
      );
    if (process.env.AYME_DEBUG)
      console.error(
        `debug #${entry.index} ${action.name}`,
        JSON.stringify({
          actionRef: action.ref ?? null,
          locate,
          targetRef: targetRef ?? null,
          classifier,
          hints: this.hints?.dump?.(page),
        }),
        "\n--- event snapshot\n" +
          (entry.eventSnapshot ?? "").split("\n").slice(0, 14).join("\n")
      );
    visit.last = after;
    const urlNow = page.url();
    if (!crossed) visit.currentUrl = urlNow;

    // --- what the Recording Package says about this interaction -------------
    const cycle = entry.cycles[0];
    // gated: the moment the input is sent on to the page; else the recorder's event
    const startedAt = cycle
      ? cycle.tMono + (cycle.timing?.snapshotMs ?? 0)
      : entry.tEventMono;
    const endedAt = crossed
      ? startedAt + (cycle?.timing?.replayMs ?? 0)
      : Math.max(startedAt, (after.tMono ?? startedAt) + (after.ms ?? 0));
    this.observations.session.recordActionCompleted({ kind: "action-completed", pageId: st.pageId, actionId: entry.interactionId, at: endedAt });
    entry.pkg = {
      visit,
      crossed,
      startedAt,
      endedAt,
      // what changed with no interaction to explain it, seen at the moment of this one
      change: unassigned
        ? {
            timestamp: cycle ? cycle.tMono : startedAt,
            beforeTree: base.stableTree,
            afterTree: before.stableTree,
            changeTree: unassigned,
          }
        : null,
      beforeTree: before.stableTree,
      afterTree: after.stableTree,
      changeTree: interaction,
      target,
    };
    if (this.trace) this.tracePoints.set(entry.interactionId, {
      interactionId: entry.interactionId, pageId: visit.pageId,
      beforeGroup: (before.tracePoint ?? base.tracePoint)?.group,
      afterGroup: crossed ? null : after.tracePoint?.group,
      // Free-before is reconstructed from E; stock tracing has no DOM at E.
      beforeSource: entry.source === "free-before" ? "previous public snapshot" : "gate",
    });

    entry.result = {
      interactionId: entry.interactionId,
      visitId: visit.visitId,
      target,
      changeTree: renderChangeTree(
        interaction,
        target.ref ? target : undefined
      ),
      unassigned: unassigned ? renderChangeTree(unassigned) : null,
      counts: {
        interaction: changeCounts(interaction),
        unassigned: unassigned ? changeCounts(unassigned) : null,
      },
      settle: after.settle,
      classifier,
      navigatedTo: urlNow !== urlBefore ? urlNow : null,
      leftVisit: crossed,
      tree: after.yaml,
    };
    this.onEntry(this.publicEntry(entry));
  }

  /** A serialized no-op marker: stock tracing captures its DOM, without stamps. */
  async tracePoint(name, page) {
    return this.traceTail = (this.traceTail ?? Promise.resolve()).then(async () => {
      const t = Date.now();
      const point = { group: name, stamped: null };
      try {
        await this.context.tracing.group(name);
        try {
          await page.evaluate(() => 0);
        } finally {
          await this.context.tracing.groupEnd();
        }
      } catch (error) {
        point.error = String(error).split("\n")[0];
      }
      this.traceMarkMs.push(Date.now() - t);
      return point;
    });
  }

  /**
   * The event-snapshot node to find in the public tree: the target when the
   * recorder gave it a ref, else its nearest ancestor that has one.
   */
  locateIn(page, action, eventTree) {
    // the recorder can name a ref its own snapshot does not print (a folded node)
    if (action.ref && eventTree.hasNode(action.ref))
      return { ref: action.ref, exact: true };
    return {
      ref: this.hints?.nearestAncestorRef(page, action, eventTree),
      exact: false,
    };
  }

  /**
   * Which part of the public tree the action's frame-local snapshot describes:
   * undefined for the main frame, the iframe node's public ref for a frame,
   * null when that iframe cannot be found any more.
   */
  async scopeOf(page, selector) {
    const cut = selector?.lastIndexOf(FRAME_SEP) ?? -1;
    if (cut < 0) return undefined;
    try {
      const yaml = await page
        .locator(selector.slice(0, cut))
        .first()
        .ariaSnapshot({ mode: "ai", timeout: 1000 });
      return /^- iframe[^\n]*\[ref=([^\]]+)\]/.exec(yaml)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * The target's node in the tree, or its nearest ancestor that is in the
   * tree: marks the element's ancestor chain, asks the public snapshot for
   * each mark from the element upwards, and confirms the ref it names is that
   * very element.
   */
  async walkToTree(page, selector, tree) {
    const element = page.locator(selector).first();
    let depth;
    try {
      depth = await element.evaluate(
        (el, mark) => {
          let i = 0;
          for (
            let n = el;
            n && n.nodeType === 1;
            n = n.parentElement ?? n.getRootNode()?.host
          )
            n.setAttribute(mark, String(i++));
          return i;
        },
        MARK,
        { timeout: 500 }
      );
    } catch {
      return null; // the target is gone, or the selector no longer names one element
    }
    const cut = selector.lastIndexOf(FRAME_SEP);
    const prefix = cut < 0 ? "" : selector.slice(0, cut + FRAME_SEP.length);
    let found = null;
    try {
      for (let i = 0; i < Math.min(depth, 15) && !found; i += 1) {
        const yaml = await page
          .locator(`${prefix}[${MARK}="${i}"]`)
          .ariaSnapshot({ mode: "ai", timeout: 1000 });
        const ref = /^- [^\n]*?\[ref=([^\]]+)\]/.exec(yaml)?.[1];
        if (!ref || !tree.hasNode(ref)) continue;
        const mark = await page
          .locator(`aria-ref=${ref}`)
          .getAttribute(MARK, { timeout: 1000 })
          .catch(() => null);
        if (mark === String(i)) found = { ref, exact: i === 0 };
      }
    } catch {
      // leave the target unresolved
    }
    await element
      .evaluate((el, mark) => {
        for (
          let n = el;
          n && n.nodeType === 1;
          n = n.parentElement ?? n.getRootNode()?.host
        )
          n.removeAttribute(mark);
      }, MARK)
      .catch(() => {});
    return found;
  }

  publicEntry(entry) {
    return {
      index: entry.index,
      at: entry.at,
      label: entry.label,
      action: entry.action,
      code: (entry.code ?? "").trim(),
      updates: entry.updates,
      signals: entry.signals,
      source: entry.source,
      gate: entry.gate ?? null,
      ...(entry.result ?? {}),
    };
  }

  async stop() {
    await this.queue;
    // let late recorder events (clicks arrive ~500 ms late from 1.63) land
    await new Promise((r) => setTimeout(r, 700));
    await this.queue;
    // what changed after the last interaction of each page's current visit
    for (const [page, st] of this.pages) {
      const visit = st.visits.at(-1);
      if (!visit?.last || page.isClosed()) continue;
      try {
        await settle(page);
        const snap = await this.snap(page);
        await this.observations.observe(visit, snap);
        const changeTree = await this.observations.change(visit, visit.last, snap);
        if (hasOwnChanges(changeTree))
          visit.trailing = {
            timestamp: snap.tMono,
            beforeTree: visit.last.stableTree,
            afterTree: snap.stableTree,
            changeTree,
          };
      } catch {
        // the page went away
      }
    }
    const lags = [];
    if (this.gated)
      for (const page of this.context.pages())
        lags.push(...(await readLags(page)));
    for (const st of this.pages.values())
      this.unpairedCycles += st.cycles.filter((c) => !c.claimed).length;
    await this.recorder.stop().catch(() => {});
    let traceError = null;
    if (this.trace)
      try {
        await this.context.tracing.stop({ path: this.trace.path });
      } catch (error) {
        traceError = String(error).split("\n")[0];
      }
    return {
      ...this.snapshotOfRecording(lags),
      traceFile: this.trace && !traceError ? this.trace.path : null,
      traceError,
    };
  }

  /** The recording as it stands, without touching the browser: safe on interrupt. */
  snapshotOfRecording(lags = null) {
    return {
      meta: {
        mode: this.mode,
        playwright: this.version,
        recorderApi: this.recorder?.api ?? null,
        settleRule: `after load, no DOM mutation in any frame for ${QUIET_MS} ms, deadline ${DEADLINE_MS} ms`,
        gateCyclesWithoutRecordedAction: this.gated
          ? this.unpairedCycles
          : null,
        gateLagsMs: this.gated ? lags : null,
        stamp: this.trace ? this.stamp : null,
        traceMarkMs: this.trace ? this.traceMarkMs : null,
      },
      entries: this.entries.map((entry) => this.publicEntry(entry)),
      model: this.packageModel(),
    };
  }

  /**
   * What the Recording Package is rendered from: visits with their baseline
   * tree and timeline entries, in order, as core trees.
   */
  packageModel() {
    const visits = new Map();
    for (const visit of this.visits)
      if (visit.baseline)
        visits.set(visit, {
          visitId: visit.visitId,
          pageId: visit.pageId,
          url: visit.url,
          cause: visit.cause,
          baselineTree: visit.baseline.stableTree,
          timelineEntries: [],
        });
    let item = 0;
    const tracePoints = [];
    for (const entry of this.entries) {
      const pkg = entry.pkg;
      const out = pkg && visits.get(pkg.visit);
      if (!out) continue;
      if (pkg.change && hasOwnChanges(pkg.change.changeTree))
        out.timelineEntries.push({
          kind: "change",
          analysisItemId: `item_${++item}`,
          ...pkg.change,
        });
      const {
        name,
        selector,
        ref: _ref,
        signals: _signals,
        ...values
      } = entry.action;
      const interaction = {
        id: entry.interactionId,
        type: name,
        ...(pkg.target.ref ? { targetRef: pkg.target.ref } : {}),
        ...(selector ? { targetSelector: selector } : {}),
      };
      for (const key of INTERACTION_VALUE_KEYS)
        if (key in values) interaction[key] = values[key];
      out.timelineEntries.push({
        kind: "interaction",
        analysisItemId: `item_${++item}`,
        timestamp: pkg.startedAt,
        interaction,
        beforeTree: pkg.beforeTree,
        afterTree: pkg.afterTree,
        changeTree: pkg.changeTree,
        // not part of the package: how the target was placed
        targetExact: pkg.target.exact,
        leftVisit: pkg.crossed,
      });
      const point = this.tracePoints.get(entry.interactionId);
      if (point)
        tracePoints.push({
          ...point,
          startedAt: pkg.startedAt,
          endedAt: pkg.endedAt,
        });
    }
    for (const visit of this.visits)
      if (visit.trailing && visits.has(visit))
        visits.get(visit).timelineEntries.push({
          kind: "change",
          analysisItemId: `item_${++item}`,
          ...visit.trailing,
        });
    return { mode: "structural", visits: [...visits.values()], tracePoints };
  }
}

// the released recorder copies these off the recorder's action, in this order
const INTERACTION_VALUE_KEYS = [
  "url",
  "value",
  "text",
  "button",
  "modifiers",
  "clickCount",
  "position",
  "key",
  "files",
  "options",
];

export function hasOwnChanges(reconciled) {
  let found = false;
  reconciled.walk((node) => {
    const kind = node.status?.kind;
    if (
      kind === "added" ||
      kind === "removed" ||
      (kind === "updated" && node.status.selfChanged)
    )
      found = true;
  });
  return found;
}

export function describeEntry(entry) {
  const lines = [];
  const a = entry.action;
  const what = [
    a.name,
    a.key,
    a.text !== undefined ? JSON.stringify(a.text) : null,
    a.options ? JSON.stringify(a.options) : null,
    a.clickCount > 1 ? `x${a.clickCount}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  lines.push(`#${entry.index} ${what}  ${a.selector ?? ""}  [${entry.source}]`);
  if (entry.code) lines.push(`   code: ${entry.code.split("\n").join(" ")}`);
  if (entry.signals?.length)
    lines.push(`   signals: ${entry.signals.join(", ")}`);
  if (entry.navigatedTo) lines.push(`   navigated to: ${entry.navigatedTo}`);
  if (entry.target) {
    const t = entry.target;
    lines.push(
      t.ref
        ? `   target: ${t.exact ? "in tree" : "NOT in tree, marked on nearest ancestor"} ref=${t.ref} (via ${t.via})`
        : `   target: not resolved in the tree (selector kept)`
    );
  }
  if (entry.unassigned !== null && entry.unassigned !== undefined) {
    lines.push("   changed before the interaction (unassigned):");
    lines.push(indent(entry.unassigned || "(nothing)"));
  }
  if (entry.changeTree !== undefined) {
    lines.push("   Change Tree:");
    lines.push(indent(entry.changeTree || "(nothing)"));
  }
  return lines.join("\n");
}

const indent = (text) =>
  text
    .split("\n")
    .map((line) => "     " + line)
    .join("\n");

export function writeRecording(file, recording) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(recording, null, 1));
  fs.writeFileSync(
    file.replace(/\.json$/, ".txt"),
    [
      JSON.stringify(recording.meta, null, 1),
      ...recording.entries.map(describeEntry),
    ].join("\n\n") + "\n"
  );
}
