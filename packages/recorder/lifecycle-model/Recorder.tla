------------------------------ MODULE Recorder ------------------------------
\* The lifecycle of the ayme Recorder, as the engine is built. Each rule the
\* recorder must keep is the comment above its check, under "The rules"
\* below. README.md says what the model assumes and leaves out, its known
\* limits and races, and how to run it; the verify-recorder-lifecycle skill
\* says which engine commit it was last compared with.
\*
\* One page, one recorder window, one toolbar, N things the person does.
\* Names in the comments are functions of the engine, under
\* packages/recorder/src/:
\*   L  = session/domain/lifecycle.ts       (the lifecycle, one pure function)
\*   SB = playwright/infrastructure/live/stockBrowser.ts (the Playwright adapter)
\*   G  = playwright/infrastructure/in-page/gate.ts       (the gate in each document)
\*   PR = playwright/infrastructure/pageRules.ts          (the gate's rules)
\*   RS = session/application/recorderSession.ts         (the queue's one worker)
\*   TB = server/infrastructure/toolbarBridge.ts, WC = .../windowChannelRouter.ts
\*   TL = timeline/domain/timeline.ts                  (the timeline)
\*
\* One step of the engine (one "happening" through L step()) is one step here.
\* The browser carrying out a request and telling its answer is one step too:
\* the answer is handled by the engine in the same step (README, "How the
\* model stands for the engine").
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
  N,          \* how many things the person does on the page
  MaxDoc,     \* how many documents the page can show (navigations + 1)
  MaxGen,     \* how many times Clear can be pressed
  MaxRounds,  \* how many times Record or Continue can be pressed
  MaxKeys,    \* how many more keys can be typed into a field after the first
  Surfaces,   \* model the toolbar and the window lagging behind the engine
  TimeLimit,  \* the wrap-up's five-second time limit can pass (L WRAP_UP_LIMIT_MS)
  MaxStops,   \* how many terminal stops (Ctrl+C) the person gives
  Closes,     \* the person may close the page
  FinishTwice,\* the person presses Finish a second time
  Quick,      \* switching the gate or Playwright's mode is done before the
              \* person's next action (a few milliseconds; README, assumptions)
  LateRevisions,\* a revision of typing may reach the engine after the person's
               \* next action (race R5); otherwise it is quick (see Quick)
  LeaveOutB2,  \* not a fix: bug B2 (a known limit) left out, as the guarantee
               \* a fix would have to give, to check every other path of
               \* rules 7 and 12. No typing reaches the page unheld while an
               \* earlier entry of the page is still open
  LateTypingReport,\* the report of typing whose key a page held back may come
                   \* after that page has settled (race R7); otherwise it comes
                   \* first, within the 250 ms the page must be quiet
  SlowFlush,  \* a click report that a later input made Playwright send may
              \* still be on its way at the person's next action (race R8)
  SlowPickEnd,\* the page may still leave clicks to Playwright for a moment
              \* after Playwright and the window left picking (race R9)
  SlowHeldMessage,\* the page's message that it holds a click may reach the
              \* engine after the person's next action, as Stop (race R10)
  StartBlank, \* codegen --start-recording: the page opens blank (the first
              \* document), Record is the first step, and the page goes to its
              \* address once the pages hold inputs back (SB opening)
  ActOnBlank, \* with StartBlank: the person may click the blank page, or pick
              \* an element of it, before it has gone to its address
  ContinueOnBlank,\* with StartBlank: Continue may be pressed while the page is
              \* still blank; not a fix: off, it leaves a path out, to check
              \* every other one
  PageNavigates,\* the page may go elsewhere with no held input making it go:
              \* the browser's Back button, a redirect
  NavAfterReports,\* a page commits a navigation only once the report, or the
              \* revision, of what was typed in the document it leaves is in
              \* (off: race R12, config Race-NavigationBeforeTypingReport)
  ReadHeardLate,\* a read the page took may reach the engine after a navigation
              \* (a read in flight; L keepRead, 5ecea373)
  SameFieldElsewhere,\* after a navigation, typing in a field of the new page
              \* that Playwright reports as a revision of the last fill
              \* (8d1c4656); a field may also take more keys after a
              \* navigation
  AddressChanges,\* the page may change its address within its document, as
              \* history.replaceState or a change of the hash does; Playwright
              \* tells it as a navigation. The page keeps its gate and its
              \* fills as they were
  TypeAfterStopOnNewPage,\* during a wrap-up, with the pages no longer holding,
              \* a key may be typed in a document the recorder has not read
              \* yet; not a fix: off, it leaves that path out (config
              \* Rule7-TypeAfterStopOnNewPage), to check every other one
  SaveStorage,\* --save-storage was given: the recorder saves the storage
              \* state as it ends (L savesStorage); off, it ends as with no
              \* such step at all
  WriteFails, \* the package cannot be written (L saveFailed)
  StartFails, \* a request Record waits for may fail: the trace's start,
              \* switching Playwright's reports on, or the pages' gate (L
              \* cannotStart, after Record, not after Continue)
  ReadsTimeOut,\* a read of the open page that held inputs, the wrap-up or a
              \* Continue wait for may not be answered in its time (L
              \* HELD_READ_LIMIT_MS, READ_LIMIT_MS; RS limit), as on a page
              \* that is never read (#1525). No clock: any such read still
              \* awaited may run out, whichever limit it has
  Buttons     \* what the person clicks with: a subset of {"left", "right",
              \* "middle", "leftOnCheckbox", "middleOnCheckbox"}; Playwright
              \* reports a click on a checkbox as a check, which names no button.
              \* Left only where a path or chart is clearer without right-clicks

Inputs == 1..N
\* The engine's entries. Entry i is input i's: a held click, or the input
\* known from Playwright's report. Entry N+i is the assertion Playwright
\* reports when it picks a click the page had held back, the key the page
\* held back before typing i (an input of its own in the engine), or the fill
\* a revision starts after a pause (L interactionRevised).
Ids == 1..(2 * N)
In(e) == IF e > N THEN e - N ELSE e
\* What an end asks of the storage state (L ending): its save with
\* --save-storage, nothing without it.
Asked == IF SaveStorage THEN "asked" ELSE "none"

VARIABLES
  \* --- the engine (L LifecycleState) ---
  phase,          \* off | recording | wrap | paused | saving | saved | empty |
                  \* failed (a Record that could not start; L ending, then ended)
  boot,           \* recording only: what Record/Continue still waits for:
                  \*   trace | report | gate | none (answered)  (L starting)
  resumed,        \* this stretch began with Continue
  picking,        \* off | waiting | asked | on  (L Picking)
  goal,           \* wrap only: pause | save | clear | quit  (L AfterWrapUp)
  gateOffAsked,   \* wrap only: the pages are asked to hold no more (L gateOffAsked)
  gateOff, finals, switchingOff, traceStarting, discarding,  \* L wrappingUp fields
  stopping, savedTold,                                       \* L saving
  storage,        \* L ending: the recorder's end waits for the storage state
                  \*   to be saved (--save-storage): none (no end yet) |
                  \*   asked (L ending) | saved | failed (a warning); the end
                  \*   is told once it is saved or failed (L ended)
  gen,            \* how many times the recording was thrown away
  pgHold, pgLatest, pgMoved,  \* L PageGate: the engine's note that the page holds what
                     \* follows; the page's latest snapshot (0 = none)
  pgMoved,        \* L PageGate.moved: an input reached the page, or was reported
                  \* on it, since its latest snapshot
  pgReported,     \* L PageGate.reported: Playwright reported on the page since
                  \* Record or Continue
  pgLastFill,     \* L PageGate.lastFill: the fill written last while nothing
                  \* newer was reported on the page (0 = none)
  els,            \* L Input.elsewhere: entries known from their report on a page
                  \* that went to another address since; no revision is theirs
  pic,            \* per entry known from its report: when Playwright's picture
                  \* of it was taken (its first key)
  lst,            \* L Flow.inputs: the engine's entries, oldest first
  ent,            \* per entry: none | click | key | rep | assert
                  \*   (L Input.held: click/press, typing, reported, asserted)
  stage,          \* per entry: none | waiting | takingBefore | passingOn |
                  \*   settling | takingAfter | settled | keyDone | written | out
  rep,            \* per entry: the engine has its report
  repOf,          \* per entry: whose report it has (an input)
  unrep, revised, \* L Input.unreported, L Input.revised
  bsnap, asnap,   \* per entry: its "before" and "after" snapshot (0 = none)
  noAfter,        \* entries whose "after" was not answered in time: kept with
                  \* their "before" only (L withoutItsSnapshot)
  pend,           \* snapshots asked and not yet in, in the order asked (a page
                  \* answers them in that order): each is the set of who waits
                  \* for it, <<e,"b">>, <<e,"a">>, <<0,"final">>, <<0,"resume">>
  \* --- requests the engine handed to the browser, not yet carried out ---
  passReq,        \* per input: "passOn" asked
  gateQ,          \* "holdInputs" requests, in order: TRUE (on) | FALSE (off)
  modeQ,          \* Playwright recorder mode changes, in order (SB inModeOrder):
                  \*   on | off (reportInteractions) | pickOn | pickOff (pick)
  traceQ,         \* trace requests: start | keep | discard
  \* --- the timeline and the package ---
  tl, tlAtPause, dis, kept, revLost,
  \* the timeline at the level of its rows (see "The timeline's rows"): the
  \* snapshots it keeps, the rows the window shows, the package's rows
  keptSn, newT, pkgNew,
  shown,          \* per entry: shown in the window while it can still change
  txt,            \* per entry: how many keys its text has (1 + revisions taken)
  fin,            \* per entry: written for good
  pos,            \* per entry: its place in the window's list (0 = not shown)
  pkg,            \* none | complete | empty (nothing to write: no Interaction)
  saves, pkgHas, pkgDis,
  \* --- the browser and the page ---
  page, doc, navFlying,
  gateOn,         \* the current document's gate holds inputs back (G set)
  holdPg,         \* the current document holds what follows, typing included
  gateStart,      \* how a new document's gate starts (G startGate, latest wins)
  pickPg,         \* the current document leaves inputs to Playwright's picking
  unpick,         \* the open documents are still to be told to stop leaving
                  \* clicks to picking (SB pick(false): Playwright's mode first)
  mode,           \* Playwright's recorder: none | rec | pick
  tracing,        \* off | on | kept
  clock, docOf,   \* snapshots read so far; the document each was read in: the
                  \* one the page was at as the read started (SB takeSnapshot)
  readFly,        \* a read the page took that the engine has not heard yet: its
                  \* id (0 = none), the request it answers, and the round and
                  \* recording it was asked in (ReadHeardLate)
  seen,           \* how many inputs Playwright has seen (report order)
  \* --- what the person did ---
  kind, at, hits, ev, ord, evStamp, made, keys, revFly, revOrd, revMade, revAt,
  touched, heldEver, navs, wrong, overtook,
  \* --- the toolbar and the window ---
  tb, tbAns, tbFresh, ansFresh, win, winBehind,
  \* --- the rest ---
  stops, rounds, finishAgain, asserts

engVars == <<phase, boot, resumed, picking, goal, gateOffAsked, gateOff, finals, switchingOff,
             traceStarting, discarding, stopping, savedTold, storage, gen, pgHold, pgLatest, pgMoved,
             pgReported, pgLastFill, els, pic,
             lst, ent, stage, rep, repOf, unrep, revised, bsnap, asnap, noAfter, pend,
             passReq, gateQ, modeQ, traceQ, tl, tlAtPause, dis, kept, revLost,
             pkg, saves, pkgHas, pkgDis, holdPg,
             keptSn, newT, pkgNew, shown, txt, fin, pos>>
pageVars == <<page, doc, navFlying, gateOn, gateStart, pickPg, unpick, mode,
              tracing, clock, docOf, readFly, seen>>
personVars == <<kind, at, hits, ev, ord, evStamp, made, keys, revFly, revOrd,
                revMade, revAt, touched, heldEver, navs, wrong, overtook>>
pubVars == <<tbFresh, ansFresh, winBehind>>
surfVars == <<tb, tbAns, win>>
miscVars == <<stops, rounds, finishAgain, asserts>>
vars == <<engVars, pageVars, personVars, pubVars, surfVars, miscVars>>

-----------------------------------------------------------------------------
\* The engine as one record, so that one step of L can be written as a chain
\* of pure operators, as the code is.

Eng == [phase |-> phase, boot |-> boot, resumed |-> resumed, picking |-> picking,
        goal |-> goal, gateOffAsked |-> gateOffAsked, gateOff |-> gateOff, finals |-> finals,
        switchingOff |-> switchingOff, traceStarting |-> traceStarting,
        discarding |-> discarding, stopping |-> stopping, savedTold |-> savedTold,
        storage |-> storage,
        gen |-> gen, pgHold |-> pgHold, pgLatest |-> pgLatest, pgMoved |-> pgMoved, lst |-> lst,
        pgReported |-> pgReported, pgLastFill |-> pgLastFill, els |-> els, pic |-> pic,
        ent |-> ent, stage |-> stage, rep |-> rep, repOf |-> repOf,
        unrep |-> unrep, revised |-> revised, bsnap |-> bsnap, asnap |-> asnap,
        noAfter |-> noAfter,
        pend |-> pend, passReq |-> passReq, gateQ |-> gateQ, modeQ |-> modeQ,
        traceQ |-> traceQ, tl |-> tl, tlAtPause |-> tlAtPause, dis |-> dis,
        kept |-> kept, revLost |-> revLost, pkg |-> pkg, saves |-> saves,
        pkgHas |-> pkgHas, pkgDis |-> pkgDis, holdPg |-> holdPg,
        keptSn |-> keptSn, newT |-> newT,
        pkgNew |-> pkgNew, shown |-> shown, txt |-> txt, fin |-> fin, pos |-> pos,
        pages |-> page = "open"]

Commit(t) ==   \* t is computed once (TLC passes arguments unevaluated)
  \E s \in {t} :
    /\ phase' = s.phase /\ boot' = s.boot /\ resumed' = s.resumed
    /\ picking' = s.picking /\ goal' = s.goal /\ gateOff' = s.gateOff
    /\ gateOffAsked' = s.gateOffAsked
    /\ finals' = s.finals /\ switchingOff' = s.switchingOff
    /\ traceStarting' = s.traceStarting /\ discarding' = s.discarding
    /\ stopping' = s.stopping /\ savedTold' = s.savedTold /\ gen' = s.gen
    /\ storage' = s.storage
    /\ pgHold' = s.pgHold /\ pgLatest' = s.pgLatest /\ pgMoved' = s.pgMoved /\ lst' = s.lst
    /\ pgReported' = s.pgReported /\ pgLastFill' = s.pgLastFill /\ els' = s.els /\ pic' = s.pic
    /\ ent' = s.ent /\ stage' = s.stage /\ rep' = s.rep /\ repOf' = s.repOf
    /\ unrep' = s.unrep /\ revised' = s.revised /\ bsnap' = s.bsnap
    /\ asnap' = s.asnap /\ noAfter' = s.noAfter /\ pend' = s.pend /\ passReq' = s.passReq
    /\ gateQ' = s.gateQ /\ modeQ' = s.modeQ /\ traceQ' = s.traceQ
    /\ tl' = s.tl /\ tlAtPause' = s.tlAtPause /\ dis' = s.dis /\ kept' = s.kept
    /\ revLost' = s.revLost /\ pkg' = s.pkg /\ saves' = s.saves
    /\ pkgHas' = s.pkgHas /\ pkgDis' = s.pkgDis /\ holdPg' = s.holdPg
    /\ keptSn' = s.keptSn /\ newT' = s.newT
    /\ pkgNew' = s.pkgNew /\ shown' = s.shown
    /\ txt' = s.txt /\ fin' = s.fin /\ pos' = s.pos

Elems(sq) == {sq[k] : k \in 1..Len(sq)}
InL(s, e) == e \in Elems(s.lst)
Pos(s, e) == CHOOSE k \in 1..Len(s.lst) : s.lst[k] = e
First(s, S) == IF S = {} THEN 0 ELSE CHOOSE e \in S : \A f \in S : Pos(s, e) <= Pos(s, f)
Last(s, S) == IF S = {} THEN 0 ELSE CHOOSE e \in S : \A f \in S : Pos(s, f) <= Pos(s, e)
Drop(s, e, st) == [s EXCEPT !.lst = SelectSeq(@, LAMBDA x : x # e), !.stage[e] = st]
InsertAt(sq, k, e) == SubSeq(sq, 1, k - 1) \o <<e>> \o SubSeq(sq, k, Len(sq))

-----------------------------------------------------------------------------
\* The timeline's rows (TL). A row is a step of its
\* own between two kept snapshots ("step"), what changed before an input known
\* from its report ("before": from its start to Playwright's picture), or an
\* entry ("entry": from its "before", or its picture, to its "after"; b = 0
\* when its "after" is not in its Visit). Rows name snapshots by when they
\* were read; t is a fill's text, as the number of keys it has. A Visit is a
\* document of the page. The package is the rows with the steps after the
\* last entry of each Visit (TL package).
\* An entry's row has f when it ends at a read that shows the focus a held
\* click's press moved: the read taken as that click's "before" (pf, the
\* reads that do). The model has no wording; f stands for those focus rows.
\* When the click is written, that read stands with the focus where the read
\* before it had it, and the entry before is measured to it again (TL
\* pressedAfter, since ec270dbf): its row loses f.
NoTL == [rows |-> <<>>, thr |-> [d \in 1..MaxDoc |-> 0], st |-> [d \in 1..MaxDoc |-> FALSE],
         pf |-> {}]
DocAt(t) == IF t >= 1 /\ t <= Len(docOf) THEN docOf[t] ELSE doc
\* The blank page a recording started on has no Visit (L atRecord,
\* "blankAtRecord"): the timeline keeps no read of it, and drops an
\* Interaction that starts there (TL add "interaction": no Visit holds its
\* "before"). A read a navigation overtook is of the document it was read in,
\* whose Visit keeps it (TL keepRead, #1365).
NoVisit(d) == StartBlank /\ d = 1
Row(k, e, d, a, b, t) == [k |-> k, e |-> e, d |-> d, a |-> a, b |-> b, t |-> t, p |-> 0, f |-> FALSE]
EntryRow(T, e, d, a, b, t) == [Row("entry", e, d, a, b, t) EXCEPT !.f = b \in T.pf]
\* A held click's "before" is read: it shows the focus the press moved.
Press(T, x) ==
  LET R == T.rows IN
  [T EXCEPT !.pf = @ \cup {x},
            !.rows = [k \in DOMAIN R |-> IF R[k].k = "entry" /\ R[k].b = x
                                         THEN [R[k] EXCEPT !.f = TRUE] ELSE R[k]]]
\* TL pressedAfter: the click e is written; the entry before it ends at its
\* "before" x, which now stands with the focus as the read before it had it.
\* With no read of its Visit before x, nothing changes.
Unpress(T, x, e, ks) ==
  IF x \notin T.pf \/ ~\E k \in ks : k < x /\ DocAt(k) = DocAt(x) THEN T
  ELSE LET R == T.rows IN
       [T EXCEPT !.pf = @ \ {x},
                 !.rows = [k \in DOMAIN R |-> IF R[k].k = "entry" /\ R[k].e # e /\ R[k].b = x
                                              THEN [R[k] EXCEPT !.f = FALSE] ELSE R[k]]]
NextKept(ks, d, x) ==
  LET S == {k \in ks : DocAt(k) = d /\ k > x} IN
  IF S = {} THEN 0 ELSE CHOOSE k \in S : \A j \in S : k <= j
\* TL produce, writeStep: a step for each kept snapshot
\* up to upTo.
RECURSIVE Produce(_, _, _, _)
Produce(T, ks, d, upTo) ==
  LET n == NextKept(ks, d, T.thr[d]) IN
  IF n = 0 \/ n > upTo THEN T
  ELSE Produce([T EXCEPT !.rows = Append(@, Row("step", 0, d, T.thr[d], n, 0)),
                         !.thr[d] = n], ks, d, upTo)
\* TL add "interaction", writeInteraction, measure, changedBefore. A Visit starts at its
\* first Interaction's "before".
AddEntry(T, ks, e, isRep, b, a, pc, t) ==
  IF NoVisit(DocAt(b)) THEN T ELSE
  LET d == DocAt(b)
      T1 == IF T.st[d] THEN T ELSE [T EXCEPT !.st[d] = TRUE, !.thr[d] = b]
      T2 == Produce(T1, ks, d, b)
      in == a # 0 /\ DocAt(a) = d
      T3 == IF isRep /\ in
            THEN [T2 EXCEPT !.rows = Append(Append(@, Row("before", e, d, b, pc, 0)),
                                            EntryRow(T2, e, d, pc, a, t))]
            ELSE [T2 EXCEPT !.rows = Append(@, EntryRow(T2, e, d, b, IF in THEN a ELSE 0, t))]
      \* where the entries stood before this one: a revision recomputes from it
      T4 == [T3 EXCEPT !.rows[Len(T3.rows)].p = T2.thr[d]]
  IN IF in /\ a > T4.thr[d] THEN [T4 EXCEPT !.thr[d] = a] ELSE T4
EntryIx(T, e) ==
  LET K == {k \in 1..Len(T.rows) : T.rows[k].k = "entry" /\ T.rows[k].e = e} IN
  IF K = {} THEN 0 ELSE CHOOSE k \in K : TRUE
EntryRowOf(T, e) ==
  IF EntryIx(T, e) = 0 THEN Row("none", 0, 0, 0, 0, 0) ELSE T.rows[EntryIx(T, e)]
\* An entry added under a key is replaced in place (TL replace): its
\* new text and "after", from its first picture as it was; the entries stand
\* at its new "after", or where they stood before it when it left its Visit.
\* A read of the page it went on to keeps what it showed up to its last read
\* of its own page (TL replace).
Revise(T, e, a, t) ==
  LET k == EntryIx(T, e) IN
  IF k = 0 THEN T ELSE
  LET r == T.rows[k]
      d == r.d
      b == IF a # 0 /\ DocAt(a) = d THEN a ELSE r.b
      T1 == [T EXCEPT !.rows[k] = [r EXCEPT !.b = b, !.t = t, !.f = b \in T.pf]]
  IN [T1 EXCEPT !.thr[d] = IF b # 0 /\ b > r.p THEN b ELSE r.p]
\* A "text" addition (TL retext): only the text of the entry under the key.
ReviseText(T, e, t) ==
  LET k == EntryIx(T, e) IN
  IF k = 0 THEN T ELSE [T EXCEPT !.rows[k].t = t]
RECURSIVE EndFrom(_, _, _)
EndFrom(T, ks, d) ==
  IF d > MaxDoc THEN T
  ELSE EndFrom(IF T.st[d] THEN Produce(T, ks, d, 1000) ELSE T, ks, d + 1)
PerDoc(rows, d) == SelectSeq(rows, LAMBDA r : r.d = d)

Active(s) == s.phase \in {"recording", "wrap"}
\* L browserTold: a recording whose trace is thrown away hears nothing more.
During(s) == Active(s) /\ ~s.discarding

\* L Input.passedOnAt is set (withoutPage keeps such an input).
PassedOn(s, e) ==
  CASE s.ent[e] \in {"click", "key"} ->
         s.stage[e] \notin {"waiting", "takingBefore", "passingOn"}
    [] s.ent[e] = "rep" -> s.bsnap[e] # 0
    [] OTHER -> s.stage[e] = "settled"

\* L askSnapshot, askSharedSnapshot. A snapshot of a page that is gone is
\* answered by nothing (SB takeSnapshot returns when the page is not open).
AskSnap(s, r) == IF s.pages THEN Append(s.pend, r) ELSE s.pend
TakeFor(s, e, w) ==
  [s EXCEPT !.stage[e] = IF w = "b" THEN "takingBefore" ELSE "takingAfter",
            !.pend = AskSnap(s, {<<e, w>>})]
AskShared(s, early, late) ==
  [s EXCEPT !.stage[early] = "takingAfter", !.stage[late] = "takingBefore",
            !.pend = AskSnap(s, {<<early, "a">>, <<late, "b">>})]

\* L underWay: the oldest held entry that has no "after". An input known from
\* its report goes its own way, and so does a key that reached its page while
\* its typing settles.
UnderWay(s) ==
  First(s, {e \in Elems(s.lst) : s.ent[e] # "rep" /\ s.stage[e] # "settled"
                                 /\ ~(s.ent[e] = "key" /\ s.stage[e] = "settling")})

\* L anyHeld: a held input that has not reached its page yet.
AnyHeldE(s) ==
  \E e \in Elems(s.lst) : s.ent[e] \in {"click", "key"}
                         /\ s.stage[e] \in {"waiting", "takingBefore", "passingOn"}

\* L giveSnapshot
GiveSnap(s, o, t) ==
  LET e == o[1] IN
  IF o[2] = "a" THEN
     IF s.stage[e] # "takingAfter" THEN s
     ELSE IF s.revised[e]
          THEN [s EXCEPT !.stage[e] = "settling", !.asnap[e] = t, !.revised[e] = FALSE]
          ELSE [s EXCEPT !.stage[e] = "settled", !.asnap[e] = t]
  ELSE
     IF s.stage[e] # "takingBefore" THEN s
     ELSE CASE s.ent[e] = "assert" ->
                 IF s.bsnap[e] # 0 THEN [s EXCEPT !.stage[e] = "settled"]
                 ELSE [s EXCEPT !.stage[e] = "settled", !.bsnap[e] = t, !.asnap[e] = t]
            [] s.ent[e] = "rep" -> [s EXCEPT !.stage[e] = "settling", !.bsnap[e] = t]
            [] OTHER -> [s EXCEPT !.stage[e] = "passingOn", !.bsnap[e] = t,
                                  !.passReq[In(e)] = TRUE,
                                  !.newT = IF s.ent[e] = "click" THEN Press(@, t) ELSE @]

RECURSIVE GiveAll(_, _, _)
GiveAll(s, os, t) ==
  IF os = {} THEN s
  ELSE LET o == CHOOSE x \in os : TRUE IN GiveAll(GiveSnap(s, o, t), os \ {o}, t)

\* L snapshotTaken
\* A read of a document the page has left, as one a navigation overtook
\* (read in another document than the page is at), is still given to whoever
\* asked for it, but it is not the page's latest read (L keepRead, 5ecea373).
\* The timeline keeps it in the Visit of the document it was read in, the one
\* the page left, so that the input that waited for it is kept there with it
\* (TL keepRead, #1365); in the model a document is a Visit, and DocAt says
\* whose a kept read is.
SnapIn(s, r, t) ==
  LET stale == DocAt(t) # doc
      s1 == [s EXCEPT !.pend = Tail(@), !.pgLatest = IF stale THEN @ ELSE t,
                      !.pgMoved = IF stale THEN @ ELSE FALSE,
                      !.keptSn = @ \cup {t}]
      s2 == GiveAll(s1, {o \in r : o[1] # 0}, t)
  IN IF <<0, "final">> \in r THEN [s2 EXCEPT !.finals = "in"] ELSE s2

\* L startNext
StartNext(s) ==
  LET u == UnderWay(s) IN
  IF u = 0 THEN s
  ELSE IF s.stage[u] # "waiting" THEN s
  ELSE IF s.ent[u] = "key" /\ s.pgLatest # 0
       THEN [s EXCEPT !.stage[u] = "passingOn", !.passReq[In(u)] = TRUE]
       ELSE TakeFor(s, u, "b")

\* L shareWithOpen
ShareWithOpen(s, o, e) ==
  LET s1 == [s EXCEPT !.revised[o] = FALSE] IN
  IF s1.stage[o] = "settling" THEN AskShared(s1, o, e) ELSE s1

\* L startReported. <<found a start now, new state>>
\* An assertion ahead whose one read is still being taken, with nothing else
\* ahead but inputs known from their report, is placed at the page's latest
\* read, and this input starts there too (12c8bf83, 0380307f): it does not
\* start after its first key. The assertion still waits for its own read, and
\* settles at it where it was placed (L giveSnapshot, targetRead).
StartRep(s0, e) ==
  LET ahead0 == {f \in Elems(s0.lst) : Pos(s0, f) < Pos(s0, e) /\ s0.stage[f] # "settled"
                                      /\ s0.ent[f] # "key"}
      reading == {f \in ahead0 : s0.ent[f] = "assert" /\ s0.stage[f] = "takingBefore"}
      fold == s0.pgLatest # 0 /\ reading # {} /\ \A f \in ahead0 : s0.ent[f] = "rep" \/ f \in reading
      s == IF ~fold THEN s0
           ELSE [s0 EXCEPT !.bsnap = [f \in DOMAIN s0.bsnap |-> IF f \in reading THEN s0.pgLatest ELSE s0.bsnap[f]],
                           !.asnap = [f \in DOMAIN s0.asnap |-> IF f \in reading THEN s0.pgLatest ELSE s0.asnap[f]]]
      ahead == IF fold THEN ahead0 \ reading ELSE ahead0 IN
  IF \E f \in ahead : s.ent[f] # "rep" THEN <<FALSE, s>>
  ELSE IF ahead # {} THEN <<FALSE, ShareWithOpen(s, Last(s, ahead), e)>>
  ELSE IF s.pgLatest = 0 THEN <<FALSE, TakeFor(s, e, "b")>>
  ELSE <<TRUE, [s EXCEPT !.bsnap[e] = s.pgLatest]>>

\* L endReported
EndRep(s, e) ==
  LET nx == First(s, {f \in Elems(s.lst) : Pos(s, f) > Pos(s, e)
                                            /\ s.ent[f] \in {"click", "assert"}}) IN
  IF nx # 0 /\ s.bsnap[nx] # 0
  THEN [s EXCEPT !.stage[e] = "settled", !.asnap[e] = s.bsnap[nx]]
  ELSE IF nx # 0 /\ s.stage[nx] = "takingBefore"
  THEN [s EXCEPT !.stage[e] = "takingAfter",
                 !.pend = [k \in 1..Len(@) |-> IF <<nx, "b">> \in @[k]
                                               THEN @[k] \cup {<<e, "a">>} ELSE @[k]]]
  ELSE IF nx # 0 \/ s.stage[e] = "settling" \/ UnderWay(s) # 0 THEN s
  ELSE [s EXCEPT !.stage[e] = "settling"]

\* L carryOnReported
CarryOne(s, e) ==
  IF ~InL(s, e) \/ s.ent[e] # "rep" \/ s.stage[e] \notin {"waiting", "settling"} THEN s
  ELSE IF s.bsnap[e] = 0
       THEN LET r == StartRep(s, e) IN IF r[1] THEN EndRep(r[2], e) ELSE r[2]
       ELSE EndRep(s, e)

RECURSIVE CarryFrom(_, _, _)
CarryFrom(s, ids, k) ==
  IF k > Len(ids) THEN s ELSE CarryFrom(CarryOne(s, ids[k]), ids, k + 1)

\* L mayBeRevised, behindUnwritten
MayBeRevised(s, e) ==
  s.ent[e] = "rep"
  /\ ~\E f \in Elems(s.lst) : Pos(s, f) > Pos(s, e) /\ s.ent[f] # "key"
Behind(s, e) == \E f \in Elems(s.lst) : Pos(s, f) < Pos(s, e) /\ s.ent[f] # "key"

\* L writeDown, showOrWrite, behindUnshown. An
\* input known from its report only (a fill, a choice, an upload, a click
\* while the gate is off in a wrap-up) shows in the window once it has its
\* report and its start and every earlier input of its page shows; from then
\* on the window has its text and its latest read. It is written for good,
\* in the same row, once something newer happened on its page, or at the
\* last. Its "changed before" row shows with it: from its start to
\* Playwright's picture at its first key, which a revision keeps. Its wording
\* may change when the next read tells more; the model has no wording, only
\* the reads a row runs between.
Txt(s, e) == IF s.ent[e] = "rep" THEN s.txt[e] ELSE 0
IsRep(s, e) == s.ent[e] = "rep"
BehindUnshown(s, e) ==
  \E f \in Elems(s.lst) : Pos(s, f) < Pos(s, e) /\ s.ent[f] # "key"
                         /\ ~(s.ent[f] = "rep" /\ s.shown[f])
AddLive(T, ks, e, b, pc, a, t) ==
  IF NoVisit(DocAt(b)) THEN T
  ELSE IF a # 0 THEN AddEntry(T, ks, e, TRUE, b, a, pc, t)
  ELSE
  LET d == DocAt(b)
      T1 == IF T.st[d] THEN T ELSE [T EXCEPT !.st[d] = TRUE, !.thr[d] = b]
      T2 == Produce(T1, ks, d, b)
      T3 == [T2 EXCEPT !.rows = Append(Append(@, Row("before", e, d, b, pc, 0)),
                                       Row("entry", e, d, pc, 0, t))]
  IN [T3 EXCEPT !.rows[Len(T3.rows)].p = T2.thr[d]]
LiveSync(s, e) == [s EXCEPT !.newT = Revise(s.newT, e, s.asnap[e], s.txt[e])]
LiveStep(s, e) ==
  IF ~InL(s, e) \/ ~IsRep(s, e) \/ ~s.rep[e] \/ s.bsnap[e] = 0 \/ s.fin[e] THEN s
  ELSE IF s.shown[e] THEN LiveSync(s, e)
  ELSE IF BehindUnshown(s, e) THEN s
  ELSE LET T1 == AddLive(s.newT, s.keptSn, e, s.bsnap[e], s.pic[e], s.asnap[e], s.txt[e])
       IN [s EXCEPT !.newT = T1, !.shown[e] = TRUE, !.pos[e] = EntryIx(T1, e)]
\* Written for good: in the row it shows, or added. A fill written while
\* nothing newer of its page has a report is the page's last fill: a
\* revision that comes later sets its text (L showOrWrite, lastFill).
WriteFinal(s, e) ==
  LET W == IF s.shown[e]
           THEN Revise(s.newT, e, s.asnap[e], Txt(s, e))
           ELSE AddEntry(s.newT, s.keptSn, e, IsRep(s, e), s.bsnap[e], s.asnap[e], s.pic[e], Txt(s, e))
      s1 == Drop(s, e, "written")
      newer == \E f \in Elems(s1.lst) : s1.rep[f]
      \* a held click is written: the entry before it is measured again
      W2 == IF s.ent[e] = "click" THEN Unpress(W, s.bsnap[e], e, s.keptSn) ELSE W
  IN [s1 EXCEPT !.tl = @ \cup {e}, !.newT = W2,
                !.fin[e] = TRUE, !.shown[e] = FALSE,
                !.pos[e] = IF s.shown[e] THEN @ ELSE EntryIx(W, e),
                !.pgLastFill = IF IsRep(s, e) THEN (IF newer THEN 0 ELSE e) ELSE @]
WriteOne(s0, e, last) ==
  LET s == LiveStep(s0, e) IN
  IF ~InL(s, e) \/ s.stage[e] # "settled" THEN s
  ELSE IF s.unrep[e] THEN Drop(s, e, "out")
  ELSE IF ~s.rep[e] \/ s.bsnap[e] = 0 THEN s
  ELSE IF ~last /\ MayBeRevised(s, e) THEN s
  ELSE IF Behind(s, e) THEN s
  ELSE WriteFinal(s, e)

RECURSIVE WriteFrom(_, _, _, _)
WriteFrom(s, ids, k, last) ==
  IF k > Len(ids) THEN s ELSE WriteFrom(WriteOne(s, ids[k], last), ids, k + 1, last)
WriteDown(s, last) == WriteFrom(s, s.lst, 1, last)

\* L letThrough. The page lets what follows through at once.
LetThrough(s) ==
  IF s.pgHold /\ s.pgLatest # 0
     /\ ~\E f \in Elems(s.lst) : s.ent[f] # "rep" /\ s.stage[f] # "settled"
  THEN [s EXCEPT !.pgHold = FALSE, !.holdPg = FALSE]
  ELSE s

\* L pickNow
PickNow(s) ==
  IF s.picking = "waiting" /\ ~AnyHeldE(s)
  THEN [s EXCEPT !.picking = "asked", !.modeQ = Append(@, "pickOn")]
  ELSE s

Save(s) ==   \* L save
  [s EXCEPT !.phase = "saving", !.goal = "none", !.stopping = TRUE,
            !.traceQ = Append(@, "keep"), !.lst = <<>>, !.pend = <<>>,
            !.boot = "none", !.picking = "off"]

WrappedUp(s) ==   \* L wrappedUp
  CASE s.goal = "save" -> Save(s)
    [] s.goal = "pause" ->
         [s EXCEPT !.phase = "paused", !.goal = "none", !.lst = <<>>, !.pend = <<>>,
                   !.tlAtPause = s.tl]
    [] OTHER -> [s EXCEPT !.discarding = TRUE, !.traceQ = Append(@, "discard")]

\* L goOnRecording
GoOnRecording(s) == PickNow(LetThrough(WriteDown(s, FALSE)))

\* L goOnWrappingUp. The pages hold inputs back as while recording until no
\* input is under way; only then are they asked to hold no more (holdNoMore).
\* A key a page held stays under way until its page has settled (L
\* inputPassedOn, pageSettled).
GoOnWrapping(s0, reportsOff) ==
  LET nothingNewer == reportsOff \/ s0.goal \in {"save", "quit"}
      settled == \A f \in Elems(s0.lst) : s0.stage[f] = "settled"
      s == IF ~s0.gateOffAsked /\ settled
           THEN [s0 EXCEPT !.gateOffAsked = TRUE, !.gateQ = Append(@, FALSE)]
           ELSE s0
      s1 == IF s.gateOff /\ s.finals = "no" /\ ~s.traceStarting /\ settled
            THEN IF s.pages
                 THEN [s EXCEPT !.finals = "asked", !.pend = AskSnap(s, {<<0, "final">>})]
                 ELSE [s EXCEPT !.finals = "in"]
            ELSE s
      s2 == WriteDown(s1, s1.finals = "in" /\ nothingNewer)
  IN IF \/ s2.finals # "in"
        \/ \E f \in Elems(s2.lst) : ~(s2.ent[f] = "rep" /\ s2.stage[f] = "settled")
        \/ s2.switchingOff \/ s2.discarding
     THEN s2
     ELSE IF nothingNewer THEN WrappedUp(s2)
     ELSE [s2 EXCEPT !.switchingOff = TRUE, !.modeQ = Append(@, "off")]

\* L proceed
Proceed(s, reportsOff) ==
  LET s1 == StartNext(s)
      s2 == CarryFrom(s1, s1.lst, 1)
      ks == {f \in Elems(s2.lst) : s2.ent[f] = "key" /\ s2.stage[f] = "settled"}
      s3 == [s2 EXCEPT !.lst = SelectSeq(@, LAMBDA x : x \notin ks),
                       !.stage = [f \in Ids |-> IF f \in ks THEN "keyDone" ELSE s2.stage[f]]]
  IN IF s3.phase = "recording" THEN GoOnRecording(s3) ELSE GoOnWrapping(s3, reportsOff)

\* L wrapUp. With nothing under way, the pages are asked at once to
\* hold no more; otherwise once it is done (GoOnWrapping).
WrapUp(s, g) ==
  LET idle == \A f \in Elems(s.lst) : s.stage[f] = "settled" IN
  Proceed([s EXCEPT !.phase = "wrap", !.goal = g, !.gateOff = FALSE, !.finals = "no",
                    !.switchingOff = FALSE, !.discarding = FALSE, !.boot = "none",
                    !.picking = "off", !.gateOffAsked = idle,
                    \* Finish, Clear or an end from outside: the decisions stand
                    \* as they are (L whileWrappingUp takes them only towards a pause)
                    !.kept = IF g = "pause" THEN @ ELSE s.dis,
                    !.modeQ = IF s.picking \in {"asked", "on"} THEN Append(@, "pickOff") ELSE @,
                    !.gateQ = IF idle THEN Append(@, FALSE) ELSE @], FALSE)

\* L record
Record(s) ==
  [s EXCEPT !.phase = "recording", !.boot = "trace", !.resumed = FALSE,
            !.picking = "off", !.traceStarting = TRUE, !.lst = <<>>, !.pend = <<>>,
            !.pgHold = TRUE, !.pgLatest = 0, !.pgReported = FALSE, !.pgLastFill = 0, !.els = {},
            !.traceQ = Append(@, "start")]

\* L resume
Resume(s) ==
  [s EXCEPT !.phase = "recording", !.boot = "report", !.resumed = TRUE,
            !.picking = "off", !.traceStarting = FALSE, !.lst = <<>>, !.pend = <<>>,
            !.pgHold = TRUE, !.pgLatest = 0, !.pgReported = FALSE, !.pgLastFill = 0, !.els = {},
            !.modeQ = Append(@, "on")]

\* L clearPaused
ClearPaused(s) ==
  [s EXCEPT !.phase = "wrap", !.goal = "clear", !.gateOffAsked = TRUE, !.gateOff = TRUE, !.finals = "in",
            !.switchingOff = TRUE, !.traceStarting = FALSE, !.discarding = TRUE,
            !.lst = <<>>, !.pend = <<>>, !.kept = s.dis,
            !.traceQ = Append(@, "discard")]

\* L traceGone
TraceGone(s) ==
  \* a Record that could not start: its trace is gone, the storage state is
  \* asked to be saved (L ending)
  IF s.phase = "failed" /\ s.discarding THEN [s EXCEPT !.discarding = FALSE, !.storage = "asked"]
  ELSE IF ~(s.phase = "wrap" /\ s.discarding) THEN s
  ELSE [s EXCEPT !.phase = IF s.goal = "quit" THEN "empty" ELSE "off",
                 !.storage = IF s.goal = "quit" THEN Asked ELSE @,   \* L ending
                 !.goal = "none", !.discarding = FALSE, !.lst = <<>>, !.pend = <<>>,
                 !.tl = {}, !.dis = {}, !.kept = {}, !.gen = @ + 1,
                 !.keptSn = {}, !.newT = NoTL,
                 !.shown = [f \in Ids |-> FALSE], !.fin = [f \in Ids |-> FALSE],
                 !.pos = [f \in Ids |-> 0]]

\* L writePackage and the worker's "save": the package is
\* written under a temporary name and renamed, then "saved" is told.
\* What the timeline holds of what was written: all of it, but for what
\* starts on a page with no Visit. With nothing, there is no package (TL
\* package: no Interaction).
TLDrops(s, e) == s.bsnap[e] # 0 /\ NoVisit(DocAt(s.bsnap[e]))
TLHas(s) == {e \in s.tl : ~TLDrops(s, e)}
WritePackage(s) ==
  IF ~(s.phase = "saving" /\ s.stopping) THEN s
  ELSE [s EXCEPT !.stopping = FALSE, !.savedTold = TRUE,
                 !.pkg = IF TLHas(s) = {} THEN "empty" ELSE "complete",
                 !.saves = IF TLHas(s) = {} THEN @ ELSE @ + 1,
                 !.pkgHas = TLHas(s), !.pkgDis = s.dis,
                 !.pkgNew = EndFrom(s.newT, s.keptSn, 1).rows]

\* L endFromOutside
EndFromOutside(s) ==
  CASE s.phase = "off" -> [s EXCEPT !.phase = "empty", !.storage = Asked]   \* L ending
    [] s.phase = "recording" -> WrapUp(s, "save")
    [] s.phase = "wrap" ->
         [s EXCEPT !.goal = IF @ = "pause" THEN "save" ELSE IF @ = "clear" THEN "quit" ELSE @,
                   !.kept = IF s.goal = "pause" THEN s.dis ELSE @]
    [] s.phase = "paused" -> Save([s EXCEPT !.kept = s.dis])
    [] OTHER -> s

\* L withoutPage
WithoutPage(s) ==
  IF ~Active(s) THEN [s EXCEPT !.pages = FALSE]
  ELSE LET gone == {f \in Elems(s.lst) : ~PassedOn(s, f)} IN
       [s EXCEPT !.lst = SelectSeq(@, LAMBDA x : x \notin gone),
                 !.stage = [f \in Ids |-> IF f \in gone THEN "cut"
                                          ELSE IF InL(s, f) THEN "settled"
                                          ELSE s.stage[f]],
                 !.pgLatest = 0, !.pgHold = FALSE, !.pages = FALSE,
                 !.finals = IF s.phase = "wrap" /\ s.finals = "asked" THEN "in" ELSE @]

\* L giveUpEarlier
GiveUpEarlier(s, k) ==
  [s EXCEPT !.unrep = [f \in Ids |-> IF InL(s, f) /\ Pos(s, f) < k /\ ~s.rep[f]
                                     THEN TRUE ELSE s.unrep[f]]]

\* L knownFromReport. pc: when Playwright's picture of
\* the input was taken.
KnownFromReport(s, e, i, pc) ==
  LET hw == {f \in Elems(s.lst) : s.ent[f] \in {"click", "key"}
                                  /\ s.stage[f] \in {"waiting", "takingBefore"}}
      k == IF hw = {} THEN Len(s.lst) + 1 ELSE Pos(s, First(s, hw))
      s1 == GiveUpEarlier(s, k)
  IN [s1 EXCEPT !.lst = InsertAt(@, k, e), !.ent[e] = "rep", !.stage[e] = "waiting",
                !.pgMoved = TRUE,
                !.rep[e] = TRUE, !.repOf[e] = i, !.bsnap[e] = 0, !.asnap[e] = 0,
                !.unrep[e] = FALSE, !.revised[e] = FALSE, !.txt[e] = 1,
                !.shown[e] = FALSE, !.fin[e] = FALSE, !.pos[e] = 0, !.pic[e] = pc]

\* L reportOfHeld, for the click report of input i
\* A click's kind, by what it is made with (PR clickHeld, heldButton): a
\* right-click is held by its context menu event, a middle click by its
\* auxclick. Playwright reports a left or a middle click on a checkbox as a
\* check, which names no button.
ClickKind(b) == CASE b = "left" -> "click" [] b = "right" -> "rclick"
                  [] b = "middle" -> "mclick" [] b = "leftOnCheckbox" -> "lbox"
                  [] OTHER -> "mbox"
ClickKinds == {"click", "rclick", "mclick", "lbox", "mbox"}
HeldButton(j) == CASE kind[j] = "rclick" -> "right" [] kind[j] \in {"mclick", "mbox"} -> "middle"
                   [] OTHER -> "left"
ReportIsCheck(j) == kind[j] \in {"lbox", "mbox"}
\* L reportsClickOf: a click's report is a held click's of its button; a
\* check's, a left or a middle click's, never a right click's.
ReportsClickOf(f, i) ==
  IF ReportIsCheck(i) THEN HeldButton(f) # "right" ELSE HeldButton(f) = HeldButton(i)

\* A click's report is a held click's only when it can be (L reportOfHeld,
\* reportsClickOf). A middle click is saved with a check's report as the middle
\* click it was (L asHeld): the model has no report text.
ReportOfHeld(s, i) ==
  LET t == First(s, {f \in Elems(s.lst) : s.ent[f] = "click" /\ ~s.rep[f]
                                         /\ ReportsClickOf(In(f), i)}) IN
  IF t = 0 THEN
     IF s.phase = "wrap" /\ s.pages THEN KnownFromReport(s, i, i, evStamp[i]) ELSE s
  ELSE IF s.stage[t] \in {"waiting", "takingBefore"} THEN s
  ELSE GiveUpEarlier([s EXCEPT !.rep[t] = TRUE, !.repOf[t] = i], Pos(s, t))

\* L asserted
Asserted(s, e, i) ==
  LET early == UnderWay(s)
      s1 == [s EXCEPT !.lst = Append(@, e), !.ent[e] = "assert", !.stage[e] = "waiting",
                      !.rep[e] = TRUE, !.repOf[e] = i, !.bsnap[e] = 0, !.asnap[e] = 0,
                      !.unrep[e] = FALSE, !.revised[e] = FALSE]
  IN IF early # 0 /\ s.stage[early] = "settling" THEN AskShared(s1, early, e) ELSE s1

\* L inputHeld; while no recording is under way, L aside
\* passes it on at once.
OnInputHeld(s, e, k) ==
  IF ~During(s) THEN [s EXCEPT !.passReq[In(e)] = (s.phase \notin {"saved", "empty", "failed"})]
  ELSE LET early == UnderWay(s)
           s1 == [s EXCEPT !.lst = Append(@, e), !.ent[e] = k, !.stage[e] = "waiting",
                           !.pgHold = TRUE, !.bsnap[e] = 0, !.asnap[e] = 0,
                           !.rep[e] = FALSE, !.unrep[e] = FALSE]
       IN Proceed(IF early # 0 /\ s.stage[early] = "settling"
                  THEN AskShared(s1, early, e) ELSE s1, FALSE)

\* L inputPassedOn. An input that starts at a lost read (a "before" no
\* read keeps) makes that read the page's latest; then the page has moved.
OnPassedOn(s0, e) ==
  IF ~During(s0) THEN s0
  ELSE IF ~InL(s0, e) \/ s0.stage[e] # "passingOn" THEN Proceed(s0, FALSE)
  ELSE
  LET lost == s0.bsnap[e] # 0 /\ s0.bsnap[e] \notin s0.keptSn
      s == [s0 EXCEPT !.pgLatest = IF lost THEN s0.bsnap[e] ELSE @, !.pgMoved = TRUE] IN
  IF s.ent[e] = "key"
       THEN Proceed([s EXCEPT !.stage[e] = IF s.phase = "wrap" THEN "settling" ELSE "settled"], FALSE)
  ELSE LET later == First(s, {f \in Elems(s.lst) : s.stage[f] = "waiting"}) IN
       Proceed(IF later # 0 THEN AskShared(s, e, later)
               ELSE [s EXCEPT !.stage[e] = "settling"], FALSE)

\* L heard "inputGone"
OnGone(s, e) ==
  IF ~During(s) THEN s
  ELSE Proceed(IF InL(s, e) /\ ~PassedOn(s, e) THEN Drop(s, e, "out") ELSE s, FALSE)

\* L pageSettled
OnSettled(s, e) ==
  IF ~During(s) THEN s
  ELSE Proceed(IF ~InL(s, e) \/ s.stage[e] # "settling" THEN s
               ELSE IF s.ent[e] = "key" THEN [s EXCEPT !.stage[e] = "settled"]
               ELSE TakeFor(s, e, "a"), FALSE)

\* A snapshot nobody waits for any more is ignored.
OnSnapshot(s, r, t) ==
  IF ~During(s) THEN [s EXCEPT !.pend = Tail(@)] ELSE Proceed(SnapIn(s, r, t), FALSE)

\* L withoutItsSnapshot, for one who waited for a read that was not answered
\* in time. An "after" is given up: the entry keeps its "before" only. A held
\* input is passed on all the same; a click starts from the page's latest
\* read while nothing moved the page since (L PageGate.moved), or else from a
\* read the timeline is told was lost, which holds its place at lost (a stamp
\* no read keeps). Neither is marked as showing the focus its press moved
\* (TL pressedAfter, skipped for beforeEarlier; Press is not applied). A
\* held key needs no "before" once the page has a read; without one, the
\* lost read is where its typing starts (OnPassedOn).
WithoutSnap(s, o, lost) ==
  LET e == o[1] IN
  IF e = 0 THEN s
  ELSE IF o[2] = "a"
       THEN IF s.stage[e] # "takingAfter" THEN s
            ELSE [s EXCEPT !.stage[e] = "settled", !.noAfter = @ \cup {e}]
  ELSE IF s.stage[e] # "takingBefore" THEN s
  ELSE LET b == IF s.ent[e] = "key"
                THEN (IF s.pgLatest # 0 THEN 0 ELSE lost)
                ELSE IF s.pgLatest # 0 /\ ~s.pgMoved THEN s.pgLatest ELSE lost
           \* what came before, with a read under way for its "after", ends
           \* where this starts; that read's answer is no one's
           open == {f \in Elems(s.lst) : f # e /\ s.stage[f] = "takingAfter"}
           s1 == IF b = 0 THEN s
                 ELSE [s EXCEPT !.stage = [f \in Ids |-> IF f \in open THEN "settled" ELSE @[f]],
                                !.asnap = [f \in Ids |-> IF f \in open THEN b ELSE @[f]],
                                !.pend = SelectSeq(@, LAMBDA r : ~\E o2 \in r : o2[1] \in open)]
       IN [s1 EXCEPT !.stage[e] = "passingOn", !.passReq[In(e)] = TRUE,
                     !.bsnap[e] = IF b = 0 THEN @ ELSE b]

RECURSIVE WithoutAll(_, _, _)
WithoutAll(s, os, lost) ==
  IF os = {} THEN s
  ELSE LET o == CHOOSE x \in os : TRUE IN WithoutAll(WithoutSnap(s, o, lost), os \ {o}, lost)

\* L unanswered: the k-th read asked is not answered in its time. Its late
\* answer is no one's (L snapshotTaken: nobody waits for it); a Continue's
\* read is given up, and the page's next read is where recording resumes;
\* the wrap-up waits for its last read no more.
OnReadFailed(s, k, lost) ==
  LET r == s.pend[k]
      s1 == [s EXCEPT !.pend = SubSeq(@, 1, k - 1) \o SubSeq(@, k + 1, Len(@))]
  IN IF ~During(s) THEN s1
     ELSE LET s2 == WithoutAll(s1, r, lost)
          IN Proceed(IF <<0, "final">> \in r THEN [s2 EXCEPT !.finals = "in"] ELSE s2, FALSE)

\* L traceStarted
OnTraceStarted(s) ==
  IF ~During(s) THEN s
  ELSE Proceed(IF ~s.traceStarting THEN s
               ELSE [s EXCEPT !.traceStarting = FALSE,
                              !.modeQ = IF s.phase = "recording" THEN Append(@, "on") ELSE @,
                              !.boot = IF s.phase = "recording" THEN "report" ELSE @], FALSE)

\* L during, reporting
OnReporting(s, on) ==
  IF ~During(s) THEN s
  ELSE IF ~on /\ s.phase = "wrap" /\ s.switchingOff
       THEN Proceed([s EXCEPT !.switchingOff = FALSE], TRUE)
  ELSE Proceed(IF s.phase = "recording" /\ s.boot # "none" /\ on
               THEN [s EXCEPT !.gateQ = Append(@, TRUE), !.boot = "gate"] ELSE s, FALSE)

\* L inputsHeld
OnInputsHeld(s, on) ==
  IF ~During(s) THEN s
  ELSE IF s.phase = "wrap" THEN Proceed(IF on THEN s ELSE [s EXCEPT !.gateOff = TRUE], FALSE)
  ELSE IF s.boot = "none" \/ ~on THEN Proceed(s, FALSE)
  ELSE Proceed([s EXCEPT !.boot = "none",
                         !.pend = IF s.resumed /\ s.pages
                                  THEN Append(@, {<<0, "resume">>}) ELSE @], FALSE)

\* L pickingChanged. No proceed follows. Playwright's mode change
\* reaches the engine in the step that made it (see README).
OnPicking(s, on) ==
  IF s.phase # "recording" THEN s
  ELSE IF on THEN [s EXCEPT !.picking = "on"]
  ELSE IF s.picking = "off" THEN s
  ELSE [s EXCEPT !.picking = "off", !.modeQ = Append(@, "pickOff")]

\* L interactionRevised: Playwright revises the
\* report it gave last on the page. An input known from its report that is
\* not written yet takes the new text (its picture stays), and a complete one
\* settles again. With none, the page's last fill takes the text alone; with
\* no report on the page since Record or Continue, the revision is of a fill
\* from before, and starts a fill of its own (bug B6, fixed). Else it is lost.
OnRevised(s0, i) ==
  IF ~During(s0) THEN [s0 EXCEPT !.revLost[i] = TRUE]
  ELSE LET s == [s0 EXCEPT !.pgMoved = TRUE]
           o == Last(s, {f \in Elems(s.lst) : s.ent[f] = "rep" /\ f \notin s.els}) IN
       IF o = 0 THEN
         IF s.pgLastFill # 0
         THEN IF kind[In(s.pgLastFill)] = "type"
              THEN LET e == s.pgLastFill IN
                   \* (stage "textSet": written, and a later revision set its text)
                   Proceed([s EXCEPT !.revLost[i] = (In(e) # i), !.txt[e] = @ + 1,
                                     !.stage[e] = "textSet",
                                     !.newT = ReviseText(@, e, s.txt[e] + 1)], FALSE)
              ELSE Proceed([s EXCEPT !.revLost[i] = TRUE], FALSE)
         ELSE IF ~s.pgReported /\ s.pages
         THEN Proceed(KnownFromReport([s EXCEPT !.pgReported = TRUE], N + i, i, revAt[i]), FALSE)
         ELSE Proceed([s EXCEPT !.revLost[i] = TRUE], FALSE)
       ELSE IF kind[In(o)] # "type" THEN Proceed([s EXCEPT !.revLost[i] = TRUE], FALSE)
       ELSE LET s1 == [s EXCEPT !.revLost[i] = (In(o) # i), !.txt[o] = @ + 1] IN
            Proceed(IF s1.stage[o] = "takingAfter" THEN [s1 EXCEPT !.revised[o] = TRUE]
                    ELSE IF s1.stage[o] = "settled" THEN [s1 EXCEPT !.stage[o] = "settling"]
                    ELSE s1, FALSE)

\* L interactionRevised for typing i that Playwright reports as a revision of
\* the fill before it, typed in another document (SameFieldElsewhere): the
\* open input known from its report takes it, else the page's last fill;
\* with neither, and nothing reported on the page, it is a fill of its own
\* (L knownFromReport). After a navigation, the page has neither (8d1c4656).
OnRevisedAsTyping(s, i) ==
  IF ~During(s) THEN s
  ELSE LET o == Last(s, {f \in Elems(s.lst) : s.ent[f] = "rep" /\ f \notin s.els}) IN
       IF o = 0 THEN
         IF s.pgLastFill # 0 /\ kind[In(s.pgLastFill)] = "type"
         THEN LET e == s.pgLastFill IN
              Proceed([s EXCEPT !.txt[e] = @ + 1, !.stage[e] = "textSet",
                                !.newT = ReviseText(@, e, s.txt[e] + 1)], FALSE)
         ELSE IF ~s.pgReported /\ s.pages
         THEN Proceed(KnownFromReport([s EXCEPT !.pgReported = TRUE, !.pgLastFill = 0], i, i,
                                      evStamp[i]), FALSE)
         ELSE s
       ELSE IF kind[In(o)] # "type" THEN s
       ELSE LET s1 == [s EXCEPT !.txt[o] = @ + 1] IN
            Proceed(IF s1.stage[o] = "takingAfter" THEN [s1 EXCEPT !.revised[o] = TRUE]
                    ELSE IF s1.stage[o] = "settled" THEN [s1 EXCEPT !.stage[o] = "settling"]
                    ELSE s1, FALSE)

RECURSIVE KeepAll(_, _)
KeepAll(s, S) ==
  IF S = {} THEN s.newT
  ELSE LET e == CHOOSE x \in S : TRUE IN
       KeepAll(LiveSync(s, e), S \ {e})
LiveKeep(s, S) == KeepAll(s, S)

\* L giveUp: the wrap-up's time limit passed.
GiveUp(s) ==
  LET kept0 == {f \in Elems(s.lst) : s.rep[f]}
      s1 == WriteDown([s EXCEPT !.lst = SelectSeq(@, LAMBDA x : x \in kept0)], TRUE)
      rel == {f \in Elems(s.lst) : s.ent[f] \in {"click", "key"}
                                   /\ s.stage[f] \in {"waiting", "takingBefore"}}
      \* The pages are asked to hold no more, then the held inputs are sent on
      \*; the browser carries the two out side by side.
      s2 == [s1 EXCEPT !.passReq = [i \in Inputs |-> s1.passReq[i] \/ \E f \in rel : In(f) = i],
                       !.gateOffAsked = TRUE,
                       !.gateQ = IF s.gateOffAsked THEN @ ELSE Append(@, FALSE),
                       !.modeQ = IF s.goal \in {"pause", "clear"} /\ ~s.switchingOff
                                 THEN Append(@, "off") ELSE @,
                       !.stage = [f \in Ids |-> IF InL(s, f) /\ s1.stage[f] # "written"
                                                THEN "out" ELSE s1.stage[f]],
                       \* A fill that showed and is not complete stays as it
                       \* showed: its last text and its last read, or none.
                       !.newT = LiveKeep(s1, {f \in Ids : s1.shown[f]}),
                       !.fin = [f \in Ids |-> s1.fin[f] \/ s1.shown[f]],
                       !.shown = [f \in Ids |-> FALSE],
                       !.lst = <<>>, !.pend = <<>>]
  IN WrappedUp(s2)

-----------------------------------------------------------------------------
\* What shows outside the engine (L shown, L offered; RS publishes it in the
\* same step as the change).

View ==
  CASE phase = "off" -> "off"
    [] phase = "recording" /\ boot # "none" -> IF resumed THEN "bootPaused" ELSE "bootOff"
    [] phase = "recording" /\ picking = "on" -> "picking"
    [] phase = "recording" /\ picking # "off" -> "assertPressed"
    [] phase = "recording" -> "recording"
    [] phase = "wrap" -> IF goal = "pause" THEN "wrapPause"
                         ELSE IF goal = "save" THEN "wrapSave" ELSE "wrapClear"
    \* L shown: the recorder that ends shows "saving" until the storage state
    \* is saved (L ending)
    [] storage = "asked" -> "saving"
    [] phase = "failed" /\ storage = "none" /\ SaveStorage -> "saving"
    [] OTHER -> phase
Views == {"off", "bootOff", "bootPaused", "picking", "assertPressed", "recording",
          "wrapPause", "wrapSave", "wrapClear", "paused", "saving", "saved", "empty",
          "failed"}
ShownRec == {"recording", "assertPressed", "picking"}

Offered(v) ==
  CASE v = "off" -> {"record"}
    [] v \in {"bootOff", "bootPaused"} -> {"finish", "stop", "clear", "discard"}
    [] v = "recording" -> {"finish", "stop", "clear", "assert", "discard"}
    [] v \in {"assertPressed", "picking"} -> {"finish", "stop", "clear", "leave", "discard"}
    [] v = "wrapPause" -> {"discard"}
    [] v = "paused" -> {"continue", "clear", "finish", "discard"}
    [] OTHER -> {}
\* The one button that records, stops or continues (recorder-window controls.ts).
Primary(v) ==
  CASE v \in {"off", "bootOff"} -> "record"
    [] v \in {"bootPaused", "paused"} -> "continue"
    [] OTHER -> "stop"
ShowsBtn(v, c) ==
  /\ v \in Views
  /\ c \in Offered(v)
  /\ c \in {"record", "stop", "continue"} => Primary(v) = c
\* The person presses c on the window, or on the toolbar (primary and assert).
Pressable(c) ==
  IF ~Surfaces THEN ShowsBtn(View, c)
  ELSE \/ ShowsBtn(win, c)
       \/ page = "open" /\ c \in {"record", "stop", "continue", "assert", "leave"}
          /\ ShowsBtn(tb, c)

\* Every change of what shows gets a new revision (RS publish).
Publish ==
  IF Surfaces /\ View' # View
  THEN tbFresh' = FALSE /\ ansFresh' = FALSE /\ winBehind' = TRUE
  ELSE UNCHANGED pubVars

\* A document that goes away takes its toolbar with it: a new one starts with
\* no state and asks for it.
PageGone ==
  IF Surfaces
  THEN tbFresh' = FALSE /\ ansFresh' = FALSE /\ winBehind' = (winBehind \/ View' # View)
  ELSE UNCHANGED pubVars

-----------------------------------------------------------------------------
\* With Quick, the person acts only once the gate and Playwright's mode are
\* switched as asked, Playwright's report of an assertion or of typing is in
\* (SB reads a picked element first, withPickedRef), a click report another
\* input flushed is in, and a wrap-up's last snapshot is read. A click's own
\* report can take half a second, and switching Playwright off waits for it:
\* neither is quick then.
\* A click report Playwright holds back (half a second, to see whether a double
\* click follows) is sent at once when a later input reaches it (Playwright
\* 1.64 RecorderSignalProcessor.addAction flushes the pending click): it is
\* quick from then on.
Flushed(k) ==
  ev[k] = "flying" /\ kind[k] = "click"
  /\ \/ \E j \in Inputs : ord[j] > ord[k] /\ ev[j] \in {"flying", "in", "lost"}
     \/ \E j \in Inputs : revOrd[j] > ord[k]
\* With StartBlank, the recorder is handed out once Record is answered: Record
\* is the first step (startRecorder), and nobody acts before it.
RecordFirst == StartBlank /\ rounds = 0
PersonMayAct ==
  IF RecordFirst THEN FALSE
  ELSE IF ~Quick THEN TRUE
  ELSE /\ gateQ = <<>>
       \* switching Playwright off waits for a click report it still holds;
       \* with none, it is quick (SB everyReportDelivered)
       /\ IF modeQ = <<>> THEN TRUE
          ELSE Head(modeQ) = "off" /\ \E k \in Inputs : ev[k] = "flying"
       \* Playwright holds back only a left click's report: an assertion's,
       \* typing's, a right-click's and a middle click's come at once
       /\ \A k \in Inputs : ~(ev[k] = "flying" /\ (at[k] = "picked" \/ kind[k] # "click"))
       /\ (LateRevisions \/ \A k \in Inputs : ~revFly[k])
       /\ (SlowFlush \/ \A k \in Inputs : ~Flushed(k))
       \* the page stops leaving clicks to picking right after Playwright does
       /\ (SlowPickEnd \/ ~unpick)
       \* the page's message that it holds a click is heard first
       /\ (SlowHeldMessage \/ \A k \in Inputs : at[k] # "holding")
       \* the wrap-up's last snapshot, asked once nothing is under way and the
       \* pages hold no more, is read before the person's next action ("Paused"
       \* shows about 15 ms after Stop on a quiet page)
       /\ ~(phase = "wrap" /\ finals = "asked")

Alive == phase \notin {"saved", "empty", "failed"}
\* No read the page took is waiting to be heard.
NoRead == [t |-> 0, r |-> {}, round |-> 0, gen |-> 0]
IsNext(i) == at[i] = "notyet" /\ \A j \in Inputs : j < i => at[j] # "notyet"
HeldHere(j) == at[j] \in {"held", "holding"} /\ made[j].doc = doc
\* The page is still the blank one it opened as: nothing to type into, and
\* nothing that leads elsewhere.
BlankHere == StartBlank /\ doc = 1
\* A click on the blank page, or picking an element of it (ActOnBlank).
MayClickHere == ActOnBlank \/ ~BlankHere
\* The page still goes to its address once the pages hold inputs back.
Opening == BlankHere /\ page = "open" /\ ~navFlying
WaitingPg == Cardinality({j \in Inputs : HeldHere(j)})
NavOptions == IF doc < MaxDoc /\ ~navFlying THEN BOOLEAN ELSE {FALSE}
MadeNow == [phase |-> phase, view |-> View, gen |-> gen, doc |-> doc, round |-> rounds]
\* A report of typing, or its revision, reaches the engine before the answer
\* to a snapshot read after it (assumption, README).
FastFlying == \E k \in Inputs : (ev[k] = "flying" /\ kind[k] = "type") \/ revFly[k]
AssertId(i) == IF heldEver[i] THEN N + i ELSE i
\* The entry of what a page held back of input i.
HeldId(i) == IF kind[i] = "type" THEN N + i ELSE i

Init ==
  /\ phase = "off" /\ boot = "none" /\ resumed = FALSE /\ picking = "off"
  /\ goal = "none" /\ gateOffAsked = FALSE /\ gateOff = FALSE /\ finals = "no" /\ switchingOff = FALSE
  /\ traceStarting = FALSE /\ discarding = FALSE /\ stopping = FALSE
  /\ savedTold = FALSE /\ storage = "none" /\ gen = 0 /\ pgHold = FALSE /\ pgLatest = 0 /\ pgMoved = FALSE /\ lst = <<>>
  /\ ent = [e \in Ids |-> "none"] /\ stage = [e \in Ids |-> "none"]
  /\ rep = [e \in Ids |-> FALSE] /\ repOf = [e \in Ids |-> 0]
  /\ unrep = [e \in Ids |-> FALSE] /\ revised = [e \in Ids |-> FALSE]
  /\ bsnap = [e \in Ids |-> 0] /\ asnap = [e \in Ids |-> 0] /\ noAfter = {} /\ pend = <<>>
  /\ passReq = [i \in Inputs |-> FALSE] /\ gateQ = <<>> /\ modeQ = <<>> /\ traceQ = <<>>
  /\ tl = {} /\ tlAtPause = {} /\ dis = {} /\ kept = {}
  /\ revLost = [i \in Inputs |-> FALSE]
  /\ pkg = "none" /\ saves = 0 /\ pkgHas = {} /\ pkgDis = {}
  /\ keptSn = {} /\ newT = NoTL /\ pkgNew = <<>>
  /\ pgReported = FALSE /\ pgLastFill = 0 /\ els = {} /\ pic = [e \in Ids |-> 0]
  /\ shown = [e \in Ids |-> FALSE] /\ txt = [e \in Ids |-> 0]
  /\ fin = [e \in Ids |-> FALSE] /\ pos = [e \in Ids |-> 0]
  /\ page = "open" /\ doc = 1 /\ navFlying = FALSE /\ gateOn = FALSE /\ holdPg = FALSE
  /\ gateStart = FALSE /\ pickPg = FALSE /\ unpick = FALSE /\ mode = "none"
  /\ tracing = "off" /\ clock = 1 /\ docOf = <<1>> /\ readFly = NoRead /\ seen = 1
  /\ kind = [i \in Inputs |-> "none"] /\ at = [i \in Inputs |-> "notyet"]
  /\ hits = [i \in Inputs |-> 0] /\ ev = [i \in Inputs |-> "none"]
  /\ ord = [i \in Inputs |-> 0] /\ evStamp = [i \in Inputs |-> 0]
  /\ made = [i \in Inputs |-> [phase |-> "none", view |-> "none", gen |-> 0, doc |-> 0, round |-> 0]]
  /\ keys = [i \in Inputs |-> 0] /\ revFly = [i \in Inputs |-> FALSE]
  /\ revOrd = [i \in Inputs |-> 0] /\ revMade = [i \in Inputs |-> [view |-> "none", round |-> 0, doc |-> 0]]
  /\ revAt = [i \in Inputs |-> 0]
  /\ touched = [i \in Inputs |-> FALSE] /\ heldEver = [i \in Inputs |-> FALSE]
  /\ navs = [i \in Inputs |-> FALSE] /\ wrong = [i \in Inputs |-> FALSE]
  /\ overtook = FALSE
  /\ tb = "off" /\ tbAns = "none" /\ tbFresh = TRUE /\ ansFresh = TRUE
  /\ win = "off" /\ winBehind = FALSE
  /\ stops = 0 /\ rounds = 0 /\ finishAgain = FALSE /\ asserts = 0

-----------------------------------------------------------------------------
\* Commands (L commandIn). A command that does not apply is answered
\* "ignored" and changes nothing, so it is not a step here.

YouPressRecord ==
  /\ (PersonMayAct \/ RecordFirst) /\ Pressable("record") /\ phase = "off" /\ page = "open" /\ rounds < MaxRounds
  /\ Commit(Record(Eng)) /\ rounds' = rounds + 1
  /\ UNCHANGED <<pageVars, personVars, surfVars, stops, finishAgain, asserts>>
  /\ Publish

YouPressContinue ==
  /\ PersonMayAct /\ Pressable("continue") /\ phase = "paused" /\ rounds < MaxRounds
  /\ (ContinueOnBlank \/ ~BlankHere)
  /\ Commit(Resume(Eng)) /\ rounds' = rounds + 1
  /\ UNCHANGED <<pageVars, personVars, surfVars, stops, finishAgain, asserts>>
  /\ Publish

YouPressStop ==
  /\ PersonMayAct /\ Pressable("stop") /\ phase = "recording"
  /\ Commit(WrapUp(Eng, "pause"))
  /\ UNCHANGED <<pageVars, personVars, surfVars, miscVars>>
  /\ Publish

YouPressFinish ==
  /\ PersonMayAct /\ Pressable("finish") /\ phase \in {"recording", "paused"}
  /\ Commit(IF phase = "recording" THEN WrapUp(Eng, "save")
            ELSE Save([Eng EXCEPT !.kept = dis]))
  /\ UNCHANGED <<pageVars, personVars, surfVars, miscVars>>
  /\ Publish

\* A second press while the first is handled: not applied.
YouPressFinishAgain ==
  /\ FinishTwice /\ ~finishAgain /\ ((phase = "wrap" /\ goal = "save") \/ phase = "saving")
  /\ finishAgain' = TRUE
  /\ UNCHANGED <<engVars, pageVars, personVars, surfVars, stops, rounds, asserts>>
  /\ Publish

YouPressClear ==
  /\ PersonMayAct /\ Pressable("clear") /\ phase \in {"recording", "paused"} /\ gen < MaxGen
  /\ Commit(IF phase = "recording" THEN WrapUp(Eng, "clear") ELSE ClearPaused(Eng))
  /\ UNCHANGED <<pageVars, personVars, surfVars, miscVars>>
  /\ Publish

\* L assertVisibility
YouPressAssert ==
  /\ PersonMayAct /\ Pressable("assert") /\ phase = "recording" /\ boot = "none" /\ picking = "off"
  /\ page = "open" /\ asserts < N
  /\ asserts' = asserts + 1
  /\ Commit(IF AnyHeldE(Eng) THEN [Eng EXCEPT !.picking = "waiting"]
            ELSE [Eng EXCEPT !.picking = "asked", !.modeQ = Append(@, "pickOn")])
  /\ UNCHANGED <<pageVars, personVars, surfVars, stops, rounds, finishAgain>>
  /\ Publish

\* L leaveAssertVisibility
YouLeaveAssert ==
  /\ PersonMayAct /\ Pressable("leave") /\ phase = "recording" /\ picking # "off"
  /\ Commit([Eng EXCEPT !.picking = "off",
                        !.modeQ = IF picking = "waiting" THEN @ ELSE Append(@, "pickOff")])
  /\ UNCHANGED <<pageVars, personVars, surfVars, miscVars>>
  /\ Publish

\* L review: a decision is taken until Finish or Clear is pressed, while
\* recording, wrapping up towards a pause, or paused.
Reviewable == phase \in {"recording", "paused"} \/ (phase = "wrap" /\ goal = "pause")

\* What the window lists: the entries written, a fill that shows while it
\* can still change, and one a wrap-up that gave up kept as it showed (TL
\* decide finds each by its id).
Listed == tl \cup {f \in Ids : shown[f] \/ fin[f]}

YouDiscard(e) ==
  /\ PersonMayAct /\ Reviewable /\ Pressable("discard") /\ e \in Listed \ dis
  /\ dis' = dis \cup {e}
  /\ UNCHANGED <<phase, boot, resumed, picking, goal, gateOffAsked, gateOff, finals, switchingOff,
                 traceStarting, discarding, stopping, savedTold, storage, gen, pgHold, pgLatest, pgMoved,
                 lst, ent, stage, rep, repOf, unrep, revised, bsnap, asnap, noAfter, pend,
                 passReq, gateQ, modeQ, traceQ, tl, tlAtPause, kept, revLost,
                 pkg, saves, pkgHas, pkgDis, holdPg, keptSn, newT, pkgNew,
                 pgReported, pgLastFill, els, pic,
                 shown, txt, fin, pos,
                 pageVars, personVars, surfVars, miscVars>>
  /\ Publish

YouRestore(e) ==
  /\ PersonMayAct /\ Reviewable /\ Pressable("discard") /\ e \in dis
  /\ dis' = dis \ {e}
  /\ UNCHANGED <<phase, boot, resumed, picking, goal, gateOffAsked, gateOff, finals, switchingOff,
                 traceStarting, discarding, stopping, savedTold, storage, gen, pgHold, pgLatest, pgMoved,
                 lst, ent, stage, rep, repOf, unrep, revised, bsnap, asnap, noAfter, pend,
                 passReq, gateQ, modeQ, traceQ, tl, tlAtPause, kept, revLost,
                 pkg, saves, pkgHas, pkgDis, holdPg, keptSn, newT, pkgNew,
                 pgReported, pgLastFill, els, pic,
                 shown, txt, fin, pos,
                 pageVars, personVars, surfVars, miscVars>>
  /\ Publish

-----------------------------------------------------------------------------
\* What the person does on the page. The gate listens on window, before
\* the page and before Playwright's recorder (G gateIn). PR mouseRoute,
\* keyRoute and keyHeld decide.

\* While the document's gate leaves inputs to picking, Playwright's picker
\* takes the click and reports an assertion; it goes back to recording.
\* (PR mouseRoute: while picking, the gate leaves only the left button's
\* click to Playwright, and stops leaving clicks to it after that click.)
ClickPicked(i) ==
  /\ PersonMayAct /\ Alive /\ page = "open" /\ IsNext(i) /\ pickPg /\ mode = "pick" /\ MayClickHere
  /\ "left" \in Buttons
  /\ kind' = [kind EXCEPT ![i] = "click"]
  /\ made' = [made EXCEPT ![i] = MadeNow]
  /\ evStamp' = [evStamp EXCEPT ![i] = clock]
  /\ at' = [at EXCEPT ![i] = "picked"]
  /\ ev' = [ev EXCEPT ![i] = "flying"]
  /\ ord' = [ord EXCEPT ![i] = seen] /\ seen' = seen + 1
  /\ touched' = [touched EXCEPT ![i] = TRUE]
  /\ mode' = "rec" /\ pickPg' = FALSE
  /\ Commit(OnPicking(Eng, FALSE))   \* Playwright tells it left picking
  /\ UNCHANGED << page, doc, navFlying, gateOn, gateStart, unpick, tracing, clock, docOf, readFly,
                 hits, keys, revFly, revOrd, revMade, revAt, heldEver, navs, wrong, overtook,
                 surfVars, miscVars>>
  /\ Publish

\* Playwright and the window have left picking, but the page has not been
\* told yet (SB pick(false) switches Playwright's mode first, then the
\* documents' gates): the gate leaves the click alone and stops leaving clicks
\* to picking, and the click reaches the page untouched. Playwright, recording
\* again, reports it. Race R9.
ClickAfterPicking(i) ==
  /\ PersonMayAct /\ Alive /\ page = "open" /\ IsNext(i) /\ pickPg /\ mode # "pick" /\ MayClickHere
  /\ "left" \in Buttons
  /\ kind' = [kind EXCEPT ![i] = "click"]
  /\ made' = [made EXCEPT ![i] = MadeNow]
  /\ evStamp' = [evStamp EXCEPT ![i] = clock]
  /\ at' = [at EXCEPT ![i] = "page"]
  /\ hits' = [hits EXCEPT ![i] = 1]
  /\ ev' = [ev EXCEPT ![i] = IF mode = "none" THEN "none" ELSE "flying"]
  /\ ord' = [ord EXCEPT ![i] = seen] /\ seen' = seen + 1
  /\ overtook' = (overtook \/ \E j \in Inputs : HeldHere(j))
  /\ pickPg' = FALSE
  /\ UNCHANGED <<engVars, page, doc, navFlying, gateOn, gateStart, unpick, mode, tracing,
                 clock, docOf, readFly, keys, revFly, revOrd, revMade, revAt, touched, heldEver,
                 navs, wrong, surfVars, miscVars>>
  /\ Publish

\* The open documents are told to stop leaving clicks to picking.
GatesUnpick ==
  /\ Alive /\ unpick
  /\ pickPg' = FALSE /\ unpick' = FALSE
  /\ UNCHANGED <<engVars, page, doc, navFlying, gateOn, gateStart, mode, tracing, clock,
                 docOf, readFly, seen, personVars, surfVars, miscVars>>
  /\ Publish

\* The gate holds the click back and tells the engine (G hold). A right-click
\* is held by its context menu event and a middle click by its auxclick (PR
\* clickHeld), and each is sent on with its button (SB passOn); the lifecycle
\* takes it as a click of that button.
ClickHeld(i) ==
  /\ PersonMayAct /\ Alive /\ page = "open" /\ IsNext(i) /\ ~pickPg /\ (gateOn \/ holdPg) /\ MayClickHere
  /\ \E b \in Buttons :
       /\ kind' = [kind EXCEPT ![i] = ClickKind(b)]
       \* (only a left click leads elsewhere in the model)
       /\ \E n \in IF b = "left" /\ ~BlankHere THEN NavOptions ELSE {FALSE} : navs' = [navs EXCEPT ![i] = n]
  /\ made' = [made EXCEPT ![i] = MadeNow]
  /\ evStamp' = [evStamp EXCEPT ![i] = clock]
  /\ touched' = [touched EXCEPT ![i] = TRUE]
  /\ heldEver' = [heldEver EXCEPT ![i] = TRUE]
  \* The engine hears it in the same step, or, with SlowHeldMessage, later
  \* (HeldMessageArrives): the page holds it meanwhile. The page's messages
  \* keep their order.
  /\ \/ /\ \A k \in Inputs : at[k] # "holding"
        /\ at' = [at EXCEPT ![i] = "held"]
        /\ Commit(OnInputHeld([Eng EXCEPT !.holdPg = TRUE], i, "click"))
     \/ /\ SlowHeldMessage
        /\ at' = [at EXCEPT ![i] = "holding"]
        /\ Commit([Eng EXCEPT !.holdPg = TRUE])
  /\ UNCHANGED <<page, doc, navFlying, gateOn, gateStart, pickPg, unpick, mode,
                 tracing, clock, docOf, readFly, seen, hits, ev, ord, keys, revFly, revOrd,
                 revMade, revAt, wrong, overtook, surfVars, miscVars>>
  /\ Publish

\* The page's message that it holds a click reaches the engine (race R10:
\* after the person's next action).
HeldMessageArrives(i) ==
  /\ Alive /\ at[i] = "holding" /\ \A k \in Inputs : k < i => at[k] # "holding"
  /\ at' = [at EXCEPT ![i] = "held"]
  /\ Commit(OnInputHeld(Eng, i, "click"))
  /\ UNCHANGED <<page, doc, navFlying, gateOn, gateStart, pickPg, unpick, mode,
                 tracing, clock, docOf, readFly, seen, kind, hits, ev, ord, evStamp, made, keys,
                 revFly, revOrd, revMade, revAt, touched, heldEver, navs, wrong, overtook,
                 surfVars, miscVars>>
  /\ Publish

\* Nothing holds it: it reaches the page as it is (Playwright picks it if it
\* is in its picking mode).
ClickReaches(i) ==
  /\ PersonMayAct /\ Alive /\ page = "open" /\ IsNext(i) /\ ~pickPg /\ ~gateOn /\ ~holdPg /\ MayClickHere
  /\ \E b \in Buttons : kind' = [kind EXCEPT ![i] = ClickKind(b)]
  /\ made' = [made EXCEPT ![i] = MadeNow]
  /\ evStamp' = [evStamp EXCEPT ![i] = clock]
  /\ LET picked == mode = "pick" /\ kind'[i] = "click" IN
     /\ at' = [at EXCEPT ![i] = IF picked THEN "picked" ELSE "page"]
     /\ hits' = [hits EXCEPT ![i] = IF picked THEN 0 ELSE 1]
     /\ ev' = [ev EXCEPT ![i] = IF mode = "none" THEN "none" ELSE "flying"]
     /\ mode' = IF picked THEN "rec" ELSE mode
     /\ Commit(IF picked THEN OnPicking(Eng, FALSE) ELSE Eng)
  /\ ord' = [ord EXCEPT ![i] = seen] /\ seen' = seen + 1
  /\ overtook' = (overtook \/ \E j \in Inputs : HeldHere(j))
  \* (only a left click leads elsewhere in the model)
  /\ \E n \in IF kind'[i] = "click" /\ ~BlankHere THEN NavOptions ELSE {FALSE} : navFlying' = (navFlying \/ n)
  /\ UNCHANGED << page, doc, gateOn, gateStart, pickPg, unpick, tracing, clock, docOf, readFly,
                 keys, revFly, revOrd, revMade, revAt, touched, heldEver, navs, wrong,
                 surfVars, miscVars>>
  /\ Publish

\* Typing is held only while the document holds what follows (PR keyHeld).
\* Typing while Playwright picks is not modelled.
\* LeaveOutB2: typing into another field reaches the page only once every
\* entry of the page is complete and every earlier typing is reported.
TypingOpen ==
  \/ \E e \in Elems(lst) : stage[e] # "settled"
  \/ \E j \in Inputs : kind[j] = "type" /\ (at[j] = "held" \/ ev[j] = "flying")
TypeHeld(i) ==
  /\ PersonMayAct /\ Alive /\ page = "open" /\ IsNext(i) /\ ~pickPg /\ mode # "pick"
  /\ holdPg /\ ~BlankHere
  \* (a key's message after a click's still on its way is not modelled)
  /\ \A k \in Inputs : at[k] # "holding"
  /\ LeaveOutB2 => ~TypingOpen
  /\ kind' = [kind EXCEPT ![i] = "type"]
  /\ made' = [made EXCEPT ![i] = MadeNow]
  /\ evStamp' = [evStamp EXCEPT ![i] = clock]
  /\ at' = [at EXCEPT ![i] = "held"]
  /\ touched' = [touched EXCEPT ![i] = TRUE]
  /\ heldEver' = [heldEver EXCEPT ![i] = TRUE]
  /\ Commit(OnInputHeld([Eng EXCEPT !.holdPg = TRUE], N + i, "key"))
  /\ UNCHANGED <<page, doc, navFlying, gateOn, gateStart, pickPg, unpick, mode,
                 tracing, clock, docOf, readFly, seen, hits, ev, ord, keys, revFly, revOrd,
                 revMade, revAt, navs, wrong, overtook, surfVars, miscVars>>
  /\ Publish

TypeReaches(i) ==
  /\ PersonMayAct /\ Alive /\ page = "open" /\ IsNext(i) /\ ~pickPg /\ mode # "pick"
  /\ ~holdPg /\ ~BlankHere
  /\ (TypeAfterStopOnNewPage \/ ~(phase = "wrap" /\ pgLatest = 0))
  /\ LeaveOutB2 => ~TypingOpen
  /\ kind' = [kind EXCEPT ![i] = "type"]
  /\ made' = [made EXCEPT ![i] = MadeNow]
  /\ evStamp' = [evStamp EXCEPT ![i] = clock]
  /\ at' = [at EXCEPT ![i] = "page"]
  /\ hits' = [hits EXCEPT ![i] = 1]
  /\ ev' = [ev EXCEPT ![i] = IF mode = "rec" THEN "flying" ELSE "none"]
  /\ ord' = [ord EXCEPT ![i] = seen] /\ seen' = seen + 1
  /\ overtook' = (overtook \/ \E j \in Inputs : HeldHere(j))
  /\ UNCHANGED <<engVars, page, doc, navFlying, gateOn, gateStart, pickPg, unpick, mode,
                 tracing, clock, docOf, readFly, keys, revFly, revOrd, revMade, revAt, touched, heldEver,
                 navs, wrong, surfVars, miscVars>>
  /\ Publish

\* One more key into the same field: Playwright revises the report it gave
\* (SB actionUpdated). Only while nothing holds keys back; a key held and
\* sent again is not modelled.
TypeMore(i) ==
  /\ PersonMayAct /\ Alive /\ page = "open" /\ kind[i] = "type" /\ at[i] = "page"
  /\ \A j \in Inputs : j > i => kind[j] = "none"
  /\ keys[i] < MaxKeys /\ (doc = made[i].doc \/ SameFieldElsewhere) /\ ~holdPg /\ ~pickPg /\ mode = "rec"
  /\ ev[i] \in {"flying", "in"} /\ ~revFly[i]
  /\ keys' = [keys EXCEPT ![i] = @ + 1]
  /\ revFly' = [revFly EXCEPT ![i] = TRUE]
  /\ revOrd' = [revOrd EXCEPT ![i] = seen] /\ seen' = seen + 1
  /\ revMade' = [revMade EXCEPT ![i] = [view |-> View, round |-> rounds, doc |-> doc]]
  /\ revAt' = [revAt EXCEPT ![i] = clock]
  /\ UNCHANGED <<engVars, page, doc, navFlying, gateOn, gateStart, pickPg, unpick, mode,
                 tracing, clock, docOf, readFly, kind, at, hits, ev, ord, evStamp, made,
                 touched, heldEver, navs, wrong, overtook, surfVars, miscVars>>
  /\ Publish

-----------------------------------------------------------------------------
\* The browser carries out what the engine asked, and the engine hears the
\* answer (SB carryOut, L browserTold).

\* SB passOnHeld, G open: a held input goes to no other document.
PassGone(i) ==
  /\ Alive /\ passReq[i] /\ (page = "closed" \/ made[i].doc # doc)
  /\ at' = [at EXCEPT ![i] = "gone"]
  /\ Commit(OnGone([Eng EXCEPT !.passReq[i] = FALSE], HeldId(i)))
  /\ UNCHANGED <<pageVars, kind, hits, ev, ord, evStamp, made, keys, revFly, revOrd,
                 revMade, revAt, touched, heldEver, navs, wrong, overtook, surfVars, miscVars>>
  /\ Publish

\* It reaches the page; the gate closes again when it has arrived (G arrived).
\* In Playwright's picking mode the picker takes it instead.
PassOn(i) ==
  /\ Alive /\ page = "open" /\ passReq[i] /\ made[i].doc = doc
  /\ LET picked == mode = "pick"
         stillHeld == WaitingPg - 1
         pg == IF ~gateOn /\ stillHeld = 0 THEN FALSE ELSE holdPg
     IN /\ at' = [at EXCEPT ![i] = IF picked THEN "picked" ELSE "page"]
        /\ hits' = [hits EXCEPT ![i] = IF picked THEN @ ELSE @ + 1]
        /\ ev' = [ev EXCEPT ![i] = IF mode = "none" THEN "none" ELSE "flying"]
        /\ ord' = [ord EXCEPT ![i] = seen] /\ seen' = seen + 1
        /\ evStamp' = [evStamp EXCEPT ![i] = clock]   \* when it reached the page
        /\ overtook' = (overtook \/ \E j \in Inputs : j < i /\ j # i /\ HeldHere(j))
        /\ navFlying' = (navFlying \/ (navs[i] /\ ~picked))
        /\ mode' = IF picked THEN "rec" ELSE mode
        /\ pickPg' = IF picked THEN FALSE ELSE pickPg
        /\ LET s == OnPassedOn([Eng EXCEPT !.passReq[i] = FALSE, !.holdPg = pg], HeldId(i))
           IN Commit(IF picked THEN OnPicking(s, FALSE) ELSE s)
  /\ UNCHANGED <<page, doc, gateOn, gateStart, unpick, tracing, clock, docOf, readFly,
                 kind, made, keys, revFly, revOrd, revMade, revAt, touched, heldEver, navs, wrong,
                 surfVars, miscVars>>
  /\ Publish

\* SB takeSnapshot: the page is read, marked in the trace, and told.
\* The page is read, and the engine hears it in the same step; with
\* ReadHeardLate, the engine may hear it later (ReadHeard), after a
\* navigation.
SnapshotTaken ==
  /\ Alive /\ page = "open" /\ ~FastFlying /\ pend # <<>> /\ readFly.t = 0
  /\ \/ /\ Commit(OnSnapshot(Eng, Head(pend), clock + 1))
        /\ UNCHANGED readFly
     \/ /\ ReadHeardLate
        /\ readFly' = [t |-> clock + 1, r |-> Head(pend), round |-> rounds, gen |-> gen]
        /\ UNCHANGED engVars
  /\ clock' = clock + 1 /\ docOf' = Append(docOf, doc)
  /\ UNCHANGED <<page, doc, navFlying, gateOn, gateStart, pickPg, unpick, mode,
                 tracing, seen, personVars, surfVars, miscVars>>
  /\ Publish

\* The engine hears a read the page took earlier. One whose request was
\* dropped meanwhile, as at Stop, Clear, Record or Continue, belongs to nothing
\* and changes nothing (L snapshotTaken: nobody waits for it).
ReadHeard ==
  /\ Alive /\ readFly.t # 0 /\ ~FastFlying
  /\ IF pend # <<>> /\ Head(pend) = readFly.r /\ rounds = readFly.round /\ gen = readFly.gen
     THEN Commit(OnSnapshot(Eng, Head(pend), readFly.t))
     ELSE UNCHANGED engVars
  /\ readFly' = NoRead
  /\ UNCHANGED <<page, doc, navFlying, gateOn, gateStart, pickPg, unpick, mode,
                 tracing, clock, docOf, seen, personVars, surfVars, miscVars>>
  /\ Publish

\* A snapshot asked before the page closed cannot be taken: "requestFailed"
\* (L unanswered). Nobody waits for it any more (L withoutPage).
SnapshotFails ==
  /\ Alive /\ page = "closed" /\ pend # <<>> /\ readFly.t = 0
  /\ Commit(IF During(Eng) THEN Proceed([Eng EXCEPT !.pend = Tail(@)], FALSE)
            ELSE [Eng EXCEPT !.pend = Tail(@)])
  /\ UNCHANGED <<pageVars, personVars, surfVars, miscVars>>
  /\ Publish

\* RS: the time a read was given passes before the page answers it, as on a
\* page that is never read (#1525). Only a read that held inputs, the
\* wrap-up or a Continue wait for: a read an assertion or an input known
\* from its report waits for is left out (README). A read in flight may run
\* out too: its answer then belongs to nothing (ReadHeard). The clock moves,
\* as the lost read's stamp, in the document the page is at.
ReadTimesOut ==
  /\ ReadsTimeOut /\ Alive /\ page = "open" /\ ~FastFlying
  /\ \E k \in 1..Len(pend) :
       /\ \A o \in pend[k] : IF o[1] = 0 THEN TRUE ELSE ent[o[1]] \in {"click", "key"}
       /\ Commit(OnReadFailed(Eng, k, clock + 1))
  /\ clock' = clock + 1 /\ docOf' = Append(docOf, doc)
  /\ UNCHANGED <<page, doc, navFlying, gateOn, gateStart, pickPg, unpick, mode,
                 tracing, readFly, seen, personVars, surfVars, miscVars>>
  /\ Publish

\* SB settle: the page is a Settled Page, or the deadline passed. Told also
\* for a page that is gone.
PageSettles(e) ==
  /\ Alive /\ During(Eng) /\ InL(Eng, e) /\ stage[e] = "settling"
  \* a held key's typing report comes within the quiet the page needs
  /\ (ent[e] = "key" /\ ~LateTypingReport) => ev[In(e)] # "flying"
  /\ Commit(OnSettled(Eng, e))
  /\ UNCHANGED <<pageVars, personVars, surfVars, miscVars>>
  /\ Publish

\* Reports reach the engine in the order Playwright saw the inputs.
InOrder(o) ==
  /\ \A k \in Inputs : ev[k] = "flying" => ord[k] >= o
  /\ \A k \in Inputs : revFly[k] => revOrd[k] >= o

ReportArrives(i) ==
  /\ Alive /\ ev[i] = "flying" /\ InOrder(ord[i])
  /\ ev' = [ev EXCEPT ![i] = "in"]
  /\ Commit(IF ~During(Eng) THEN Eng
            ELSE LET s == [Eng EXCEPT !.pgReported = TRUE, !.pgLastFill = 0] IN
                 Proceed((CASE at[i] = "picked" -> Asserted(s, AssertId(i), i)
                            [] kind[i] \in ClickKinds -> ReportOfHeld(s, i)
                            [] OTHER -> KnownFromReport(s, i, i, evStamp[i])), FALSE))
  /\ UNCHANGED <<pageVars, kind, at, hits, ord, evStamp, made, keys, revFly, revOrd,
                 revMade, revAt, touched, heldEver, navs, wrong, overtook, surfVars, miscVars>>
  /\ Publish

\* Playwright reports typing i, in a field of the new page with the selector
\* of a field typed in before the page went elsewhere, as a revision of that
\* fill (SameFieldElsewhere).
ReportArrivesAsRevision(i) ==
  /\ SameFieldElsewhere /\ Alive /\ ev[i] = "flying" /\ InOrder(ord[i]) /\ kind[i] = "type"
  /\ \E j \in Inputs : j < i /\ kind[j] = "type" /\ made[j].doc # made[i].doc
  /\ ev' = [ev EXCEPT ![i] = "in"]
  /\ Commit(OnRevisedAsTyping(Eng, i))
  /\ UNCHANGED <<pageVars, kind, at, hits, ord, evStamp, made, keys, revFly, revOrd,
                 revMade, revAt, touched, heldEver, navs, wrong, overtook, surfVars, miscVars>>
  /\ Publish

RevisionArrives(i) ==
  /\ Alive /\ revFly[i] /\ ev[i] = "in" /\ InOrder(revOrd[i])
  /\ revFly' = [revFly EXCEPT ![i] = FALSE]
  /\ Commit(OnRevised(Eng, i))
  /\ UNCHANGED <<pageVars, kind, at, hits, ev, ord, evStamp, made, keys, revOrd,
                 revMade, revAt, touched, heldEver, navs, wrong, overtook, surfVars, miscVars>>
  /\ Publish

\* SB holdInputs: one more start for new documents (latest wins), then every
\* document is switched, then "inputsHeld" is told.
GateSwitchLands ==
  /\ Alive /\ gateQ # <<>>
  /\ LET want == Head(gateQ)
         pg == IF page # "open" THEN holdPg
               ELSE IF want THEN TRUE
               ELSE IF WaitingPg = 0 THEN FALSE ELSE holdPg
     IN /\ gateStart' = IF page = "open" THEN want ELSE gateStart
        /\ gateOn' = IF page = "open" THEN want ELSE gateOn
        /\ Commit(OnInputsHeld([Eng EXCEPT !.gateQ = Tail(@), !.holdPg = pg], want))
        \* SB holdInputs: once the pages hold inputs back, the page opened
        \* blank goes to its address (SB opening)
        /\ navFlying' = (navFlying \/ (want /\ Opening))
  /\ UNCHANGED <<page, doc, pickPg, unpick, mode, tracing, clock, docOf, readFly,
                 seen, personVars, surfVars, miscVars>>
  /\ Publish

\* SB reportInteractions and pick, one after the other (SB inModeOrder).
\* Switching off first has every report a document sent delivered (SB
\* everyReportDelivered).
ModeLands ==
  /\ Alive /\ modeQ # <<>>
  /\ LET m == Head(modeQ) IN
     CASE m = "on" ->
            /\ mode' = "rec"
            /\ Commit(OnReporting([Eng EXCEPT !.modeQ = Tail(@)], TRUE))
            /\ UNCHANGED <<pickPg, unpick>>
       \* Answered once every report the pages sent, and every report still
       \* being read, has been told (SB reportInteractions, everyReportDelivered).
       [] m = "off" ->
            /\ \A k \in Inputs : ev[k] # "flying" /\ ~revFly[k]
            /\ mode' = "none"
            /\ Commit(OnReporting([Eng EXCEPT !.modeQ = Tail(@)], FALSE))
            /\ UNCHANGED <<pickPg, unpick>>
       [] m = "pickOn" ->
            /\ pickPg' = (page = "open") /\ unpick' = FALSE
            /\ mode' = "pick"
            /\ Commit(OnPicking([Eng EXCEPT !.modeQ = Tail(@)], TRUE))
       \* SB pick(false): Playwright's mode first, and the engine hears it; the
       \* open documents' gates are told after (GatesUnpick).
       [] OTHER ->
            /\ unpick' = (unpick \/ pickPg)
            /\ mode' = IF mode = "pick" THEN "rec" ELSE mode
            /\ Commit(IF mode = "pick" THEN OnPicking([Eng EXCEPT !.modeQ = Tail(@)], FALSE)
                      ELSE [Eng EXCEPT !.modeQ = Tail(@)])
            /\ UNCHANGED <<pickPg>>
  /\ UNCHANGED <<page, doc, navFlying, gateOn, gateStart, tracing, clock, docOf, readFly, seen,
                 personVars, surfVars, miscVars>>
  /\ Publish

\* SB startTrace, stopTrace
TraceLands ==
  /\ (Alive \/ (phase = "failed" /\ discarding)) /\ traceQ # <<>>
  /\ LET t == Head(traceQ)
         s == [Eng EXCEPT !.traceQ = Tail(@)]
     IN /\ tracing' = (CASE t = "start" -> "on" [] t = "keep" -> "kept" [] OTHER -> "off")
        /\ Commit(CASE t = "start" -> OnTraceStarted(s)
                     [] t = "keep" -> WritePackage(s)
                     [] OTHER -> TraceGone(s))
  /\ UNCHANGED <<page, doc, navFlying, gateOn, gateStart, pickPg, unpick, mode, clock,
                 docOf, readFly, seen, personVars, surfVars, miscVars>>
  /\ Publish

\* L saved: the package is written, or there was nothing to write. The
\* outcome is decided, and the storage state is asked to be saved (L ending).
SavedArrives ==
  /\ savedTold /\ phase = "saving"
  /\ phase' = IF pkg = "complete" THEN "saved" ELSE "empty"
  /\ savedTold' = FALSE
  /\ storage' = Asked
  /\ UNCHANGED <<boot, resumed, picking, goal, gateOffAsked, gateOff, finals, switchingOff,
                 traceStarting, discarding, stopping, gen, pgHold, pgLatest, pgMoved, lst, ent,
                 stage, rep, repOf, unrep, revised, bsnap, asnap, noAfter, pend, passReq, gateQ,
                 modeQ, traceQ, tl, tlAtPause, dis, kept, revLost, pkg, saves, pkgHas,
                 pkgDis, holdPg, keptSn, newT, pkgNew, shown, txt, fin, pos,
                 pgReported, pgLastFill, els, pic,
                 pageVars, personVars, surfVars, miscVars>>
  /\ Publish

\* L cannotStart, after Record: the recorder ends "failed". A trace that was
\* started is thrown away first, and the storage state is saved once it is
\* gone (L traceGone); with none started, it is saved at once (L ending).
\* Inputs the engine holds are dropped with the recording (nothing of it was
\* recorded: Record was not answered).
CannotStart(s) ==
  LET out == [s EXCEPT !.phase = "failed", !.boot = "none", !.picking = "off",
                       !.lst = <<>>, !.pend = <<>>]
  IN IF s.traceStarting \/ ~SaveStorage
     THEN [out EXCEPT !.storage = Asked]
     ELSE [out EXCEPT !.discarding = TRUE, !.traceQ = Append(@, "discard")]

\* L saveFailed (WriteFails): the package could not be written, as when a
\* file is in the recordings folder's place. The recorder ends "failed",
\* with no package, and the storage state is saved first, with the trace
\* already stopped (L ending).
PackageWriteFails ==
  /\ WriteFails /\ savedTold /\ phase = "saving"
  /\ phase' = "failed" /\ savedTold' = FALSE /\ storage' = Asked
  /\ pkg' = "none" /\ pkgHas' = {} /\ pkgDis' = {} /\ pkgNew' = <<>>
  /\ UNCHANGED <<boot, resumed, picking, goal, gateOffAsked, gateOff, finals, switchingOff,
                 traceStarting, discarding, stopping, gen, pgHold, pgLatest, pgMoved, lst, ent,
                 stage, rep, repOf, unrep, revised, bsnap, asnap, noAfter, pend, passReq, gateQ,
                 modeQ, traceQ, tl, tlAtPause, dis, kept, revLost, saves,
                 holdPg, keptSn, newT, shown, txt, fin, pos,
                 pgReported, pgLastFill, els, pic,
                 pageVars, personVars, surfVars, miscVars>>
  /\ Publish

\* L failed for startTrace, reportInteractions or holdInputs while Record
\* waits for it (StartFails): the browser cannot carry out the request Record
\* waits for now, and nothing else comes of it.
StartRequestFails ==
  /\ StartFails /\ phase = "recording" /\ boot # "none" /\ ~resumed
  /\ CASE boot = "trace" -> traceQ # <<>> /\ Head(traceQ) = "start"
       [] boot = "report" -> modeQ # <<>> /\ Head(modeQ) = "on"
       [] OTHER -> gateQ # <<>> /\ Head(gateQ) = TRUE
  /\ Commit(CannotStart(CASE boot = "trace" -> [Eng EXCEPT !.traceQ = Tail(@)]
                          [] boot = "report" -> [Eng EXCEPT !.modeQ = Tail(@)]
                          [] OTHER -> [Eng EXCEPT !.gateQ = Tail(@)]))
  /\ UNCHANGED <<pageVars, personVars, surfVars, miscVars>>
  /\ Publish

\* SB saveStorage, then L storageSaved, or L storageNotSaved: once the
\* outcome is decided, the package written and the trace over, the recorded
\* context's storage state is written to the --save-storage file (Playwright's
\* context.storageState; with no file, nothing is written). Playwright opens a
\* page of its own for an origin no page is open at, which it tells no
\* listener of and runs none of the context's scripts in. A save that fails,
\* or takes longer than its time (L STORAGE_SAVE_LIMIT_MS), is a warning. The
\* recorder's end is then told (L ended): the outcome is the one decided.
StorageLands ==
  /\ storage = "asked"
  /\ storage' \in {"saved", "failed"}
  /\ UNCHANGED <<phase, boot, resumed, picking, goal, gateOffAsked, gateOff, finals, switchingOff,
                 traceStarting, discarding, stopping, savedTold, gen, pgHold, pgLatest, pgMoved, lst, ent,
                 stage, rep, repOf, unrep, revised, bsnap, asnap, noAfter, pend, passReq, gateQ,
                 modeQ, traceQ, tl, tlAtPause, dis, kept, revLost, pkg, saves, pkgHas,
                 pkgDis, holdPg, keptSn, newT, pkgNew, shown, txt, fin, pos,
                 pgReported, pgLastFill, els, pic,
                 pageVars, personVars, surfVars, miscVars>>
  /\ Publish

\* The wrap-up's time limit passed (only when TimeLimit).
TimeLimitPasses ==
  /\ TimeLimit /\ phase = "wrap" /\ ~discarding
  /\ Commit(GiveUp(Eng))
  /\ UNCHANGED <<pageVars, personVars, surfVars, miscVars>>
  /\ Publish

-----------------------------------------------------------------------------
\* The page

\* L pageNavigated, while recording or wrapping up, when the page goes to
\* another document (leftDocument, elsewhere; b2af1120): the page forgets its
\* latest read, its last fill and that Playwright reported on it, and its
\* inputs known from their report take no more revisions.
LeftDocument(s) ==
  [s EXCEPT !.pgLatest = 0, !.pgLastFill = 0, !.pgReported = FALSE,
            !.els = @ \cup {f \in Elems(s.lst) : s.ent[f] = "rep"}]

\* The new document's gate starts as the latest start says (G startGate);
\* it leaves the picking click to Playwright as the latest picking start says
\* (drawing.ts startPicking, pickWithGate; one start per change of
\* Playwright's mode, so the latest says whether it picks now).
NavCommits ==
  /\ Alive /\ page = "open" /\ navFlying
  \* (a report of typing, or its revision, typed in this document is in first)
  /\ NavAfterReports =>
       ~\E k \in Inputs : (kind[k] = "type" /\ ev[k] = "flying" /\ made[k].doc = doc)
                         \/ (revFly[k] /\ revMade[k].doc = doc)
  /\ doc' = doc + 1 /\ navFlying' = FALSE
  /\ gateOn' = gateStart /\ pickPg' = (mode = "pick") /\ unpick' = FALSE
  \* While paused, the timeline is told the page went elsewhere (L
  \* pageNavigated, "elsewhere"): it adds no entry, and the next Visit starts
  \* with the new document, as here.
  \* While recording or wrapping up, a page that goes to another document
  \* forgets its latest read (L pageNavigated, leftDocument; c5305756,
  \* b2af1120): a key typed in the new document first waits for a read of it.
  \* It also forgets its last fill and that Playwright reported on it, and
  \* the inputs known from their report there take no more revisions (L
  \* pageNavigated, leftDocument, elsewhere; 8d1c4656).
  /\ Commit(IF Active(Eng)
            THEN Proceed(LeftDocument([Eng EXCEPT !.holdPg = gateStart]), FALSE)
            ELSE [Eng EXCEPT !.holdPg = gateStart])
  \* a read taken of the document the page left, not heard yet, stays a read
  \* of that document (SB takeSnapshot tags it with the address it started at)
  /\ tb' = IF Surfaces THEN "loading" ELSE tb
  /\ tbAns' = "none"
  /\ PageGone
  /\ UNCHANGED <<page, gateStart, mode, tracing, clock, docOf, readFly, seen,
                 personVars, win, miscVars>>

\* The page changes its address within its document (AddressChanges), as
\* history.replaceState or a change of the query or the hash does.
\* Playwright tells it as a navigation; the engine sees the same document
\* (L pageNavigated, sameDocument; b2af1120): its gate keeps its latest read,
\* its last fill and its reports, and its fills go on. The document, its gate
\* and its Visit stay; only the page's address changes, which the model has
\* not.
AddressChangesInDocument ==
  /\ AddressChanges /\ Alive /\ page = "open" /\ ~BlankHere
  /\ Commit(IF Active(Eng) THEN Proceed(Eng, FALSE) ELSE Eng)
  /\ UNCHANGED <<pageVars, personVars, surfVars, miscVars>>
  /\ Publish

\* The person closes the last page. A report Playwright already has may
\* still reach the engine; one still in the page (as a click Playwright holds
\* to see whether a double click follows) is lost. Reports leave the page in
\* order, so what is lost is the latest ones.
PageCloses ==
  /\ PersonMayAct /\ Closes /\ Alive /\ page = "open"
  /\ page' = "closed" /\ navFlying' = FALSE /\ gateOn' = FALSE /\ pickPg' = FALSE /\ unpick' = FALSE
  /\ at' = [j \in Inputs |-> IF at[j] \in {"held", "holding"} THEN "gone" ELSE at[j]]
  /\ \E cut \in 0..seen :
       /\ ev' = [k \in Inputs |-> IF ev[k] = "flying" /\ ord[k] >= cut THEN "lost" ELSE ev[k]]
       /\ revFly' = [k \in Inputs |-> revFly[k] /\ revOrd[k] < cut]
  /\ Commit(EndFromOutside([WithoutPage(Eng) EXCEPT !.holdPg = FALSE]))
  /\ tb' = IF Surfaces THEN "gone" ELSE tb
  /\ tbAns' = "none"
  /\ PageGone
  /\ UNCHANGED <<doc, gateStart, mode, tracing, clock, docOf, readFly, seen,
                 kind, hits, ord, evStamp, made, keys, revOrd, revMade, revAt, touched, heldEver,
                 navs, wrong, overtook, win, miscVars>>

\* Ctrl+C in the terminal (cli codegen.ts: process.on, every stop ends).
TerminalStop ==
  /\ PersonMayAct /\ Alive /\ stops < MaxStops
  /\ stops' = stops + 1
  /\ Commit(EndFromOutside(Eng))
  /\ UNCHANGED <<pageVars, personVars, surfVars, rounds, finishAgain, asserts>>
  /\ Publish

-----------------------------------------------------------------------------
\* The toolbar and the window (only when Surfaces)

\* TB update: the toolbar always asks for the first update above its
\* revision; the bridge answers with the newest.
BridgeAnswers ==
  /\ Surfaces /\ page = "open" /\ tb # "gone" /\ tbAns = "none" /\ ~tbFresh
  /\ tbAns' = View /\ ansFresh' = TRUE
  /\ UNCHANGED <<engVars, pageVars, personVars, tbFresh, winBehind, tb, win, miscVars>>

AnswerLands ==
  /\ Surfaces /\ page = "open" /\ tbAns # "none"
  /\ tb' = tbAns /\ tbFresh' = ansFresh /\ tbAns' = "none"
  /\ UNCHANGED <<engVars, pageVars, personVars, ansFresh, winBehind, win, miscVars>>

\* WC updates: the newest update, the full state first.
WindowCatchesUp ==
  /\ Surfaces /\ winBehind
  /\ win' = View /\ winBehind' = FALSE
  /\ UNCHANGED <<engVars, pageVars, personVars, tbFresh, ansFresh, tb, tbAns, miscVars>>

YouReloadWindow ==
  /\ Surfaces /\ Alive /\ win # "loading"
  /\ win' = "loading" /\ winBehind' = TRUE
  /\ UNCHANGED <<engVars, pageVars, personVars, tbFresh, ansFresh, tb, tbAns, miscVars>>

\* The recorder has ended, its end told once the storage state is saved or
\* the save failed (L ended). Nothing more happens on its side.
Ended == ~Alive /\ (~SaveStorage \/ storage \in {"saved", "failed"}) /\ UNCHANGED vars

-----------------------------------------------------------------------------
EngineNext ==
  \/ YouPressRecord \/ YouPressStop \/ YouPressContinue \/ YouPressFinish
  \/ YouPressFinishAgain \/ YouPressClear \/ YouPressAssert \/ YouLeaveAssert
  \/ \E e \in Ids : YouDiscard(e) \/ YouRestore(e)
  \/ \E i \in Inputs : ClickPicked(i) \/ ClickHeld(i) \/ ClickReaches(i) \/ ClickAfterPicking(i)
  \/ \E i \in Inputs : TypeHeld(i) \/ TypeReaches(i) \/ TypeMore(i)
  \/ GatesUnpick \/ \E i \in Inputs : HeldMessageArrives(i)
  \/ \E i \in Inputs : PassGone(i) \/ PassOn(i)
  \/ SnapshotTaken \/ SnapshotFails \/ ReadTimesOut
  \/ \E e \in Ids : PageSettles(e)
  \/ \E i \in Inputs : ReportArrives(i) \/ RevisionArrives(i) \/ ReportArrivesAsRevision(i)
  \/ GateSwitchLands \/ ModeLands \/ TraceLands \/ SavedArrives \/ StorageLands
  \/ StartRequestFails \/ PackageWriteFails \/ TimeLimitPasses \/ TerminalStop

SurfaceNext == BridgeAnswers \/ AnswerLands \/ WindowCatchesUp \/ YouReloadWindow

\* The page goes elsewhere with no held input making it go, as by the browser's
\* Back button or a redirect (PageNavigates).
PageGoesElsewhere ==
  /\ PageNavigates /\ Alive /\ page = "open" /\ ~navFlying /\ doc < MaxDoc /\ ~BlankHere
  /\ navFlying' = TRUE
  /\ UNCHANGED <<engVars, page, doc, gateOn, gateStart, pickPg, unpick, mode, tracing, clock,
                 docOf, readFly, seen, personVars, surfVars, miscVars>>
  /\ Publish

Next == EngineNext \/ NavCommits \/ PageCloses \/ PageGoesElsewhere \/ AddressChangesInDocument
        \/ ReadHeard \/ SurfaceNext \/ Ended

\* Steps that need nobody to press anything, the time limit left out.
OnItsOwn ==
  \/ \E i \in Inputs : PassGone(i) \/ PassOn(i)
  \/ SnapshotTaken \/ SnapshotFails
  \/ \E e \in Ids : PageSettles(e)
  \/ \E i \in Inputs : ReportArrives(i) \/ RevisionArrives(i)
  \/ GateSwitchLands \/ ModeLands \/ TraceLands \/ SavedArrives \/ StorageLands \/ GatesUnpick
  \/ \E i \in Inputs : HeldMessageArrives(i)

-----------------------------------------------------------------------------
\* The rules (spec #1267, "Rules the recorder must keep"; old numbers kept)
\* R01 to R10 are spec rules 1 to 10; X1 is rule 11; X2 and X8 are rule 12;
\* X3 and X5 are rule 13a, and R03b is 13b. S1 to S4 are the storage save's
\* (--save-storage). F1 to F7 are the rules of typed text in the window. N1
\* to N6 are narrower versions of rule 12, each for its own shortest path.
\* P1 to P31 are probes: each must break, which shows the model reaches that
\* situation. L1 and L2 are progress, checked with fairness (Progress.cfg).
\* Also checked: X4, X6, X7, X10, X11, X12a and D1, and the variants R03a to
\* R03c, R04v, R06_DecisionsChangeOnlyByAPress, X3v, F1v, F3_FinalKeepsItsChanges,
\* F4n, F7s and N1b; each is explained beside its check.

EntOf(i) == {i, N + i}
Recorded(i) == \E e \in EntOf(i) : e \in TLHas(Eng) \/ e \in pkgHas \/ InL(Eng, e)
Bef(e) == IF ent[e] = "rep" THEN evStamp[In(e)] ELSE bsnap[e]
BefDoc(e) == IF ent[e] = "rep" THEN made[In(e)].doc ELSE DocAt(bsnap[e])
Shown(i) == made[i].view \in ShownRec

\* 1. A click the recorder holds back reaches the page exactly once, unless
\*    the document it was held in is gone; then it is dropped. A click made
\*    while Assert visibility was pressed is meant for picking.
R01_HeldClickReachesThePageOnce ==
  /\ \A i \in Inputs : hits[i] <= 1
  /\ \A i \in Inputs : ~(heldEver[i] /\ at[i] = "picked"
                         /\ made[i].view \notin {"assertPressed", "picking"})
  /\ \A i \in Inputs : ~wrong[i]
  /\ ~Alive => \A i \in Inputs : HeldHere(i) /\ page = "open" => passReq[i]

\* 2. Every recorded Interaction gets one "before" and one "after"; one whose
\*    page closed, or whose "after" was not answered in time, keeps its
\*    "before" only (L withoutItsSnapshot).
R02_OneBeforeOneAfter ==
  \A e \in tl \cup pkgHas : bsnap[e] # 0 /\ (asnap[e] # 0 \/ page = "closed" \/ e \in noAfter)

\* 3. While stopped, nothing is added to the timeline and input reaches the
\*    page untouched. Tracing keeps running.
\* Input reaches the page untouched. Gives way once the five-second time
\* limit passes (README, Known limits).
R03a_StoppedClicksAreUntouched ==
  \A i \in Inputs : made[i].phase \in {"paused", "off"} => ~touched[i]
\* Nothing is added; this is also rule 13b: nothing done while not recording
\* appears.
R03b_StoppedAddsNothing ==
  /\ phase = "paused" => tl = tlAtPause
  /\ \A e \in tl : made[In(e)].phase \notin {"paused", "off"}
\* Tracing keeps running.
R03c_TracingRunsThroughPause ==
  phase = "paused" => tracing = "on"

\* 4. Finish saves everything recorded up to that moment, including an
\*    Interaction that has not settled yet. Closing the page right after an
\*    input can lose it (Recorder guide, Limits): its report never comes,
\*    or its entry is cut short ("cut", L withoutPage). Gives way once the
\*    five-second time limit passes, and for input on the blank page a
\*    --start-recording recording opens on (README, Known limits).
R04_FinishSavesEverything ==
  pkg # "none" =>
    \A i \in Inputs :
      (/\ Shown(i) /\ made[i].gen = gen /\ at[i] \in {"page", "picked"} /\ ev[i] # "lost"
       /\ \A e \in EntOf(i) : stage[e] # "cut")
        => \E e \in EntOf(i) : e \in pkgHas

\* 5. Clear leaves no entry and no discard decision behind.
R05_ClearLeavesNothing ==
  /\ \A e \in tl : made[In(e)].gen = gen
  /\ dis \subseteq Listed
  /\ phase = "off" => (tl = {} /\ dis = {} /\ tracing # "on")

\* 6. Discard and restore apply until Finish or Clear is pressed; a decision
\*    stays on its entry while the entry changes and survives Stop and
\*    Continue; the package holds the decisions as they stood at Finish.
\*    `kept` is the decisions at Finish, Clear or an end from outside.
R06_ReviewUntilFinishOrClear ==
  /\ ~Reviewable => dis = kept
  /\ pkg # "none" => pkgDis = kept

\*    Its property: the decisions change only by a press while they are
\*    taken, one entry at a time, or go with a cleared timeline. So Stop,
\*    Continue, a revision of a fill and a save leave them as they are.
R06_DecisionsChangeOnlyByAPress ==
  [][dis' # dis =>
       \/ /\ Reviewable
          /\ \E e \in Ids : dis' = dis \cup {e} \/ dis' = dis \ {e}
       \/ dis' = {} /\ tl' = {}]_vars

\* 7. An assertion never carries changes: whatever changed since the last
\*    snapshot counts as changed before it.
R07_AssertionCarriesNoChanges ==
  \A e \in tl : ent[e] = "assert" =>
    /\ bsnap[e] = asnap[e]
    /\ \A f \in tl : (In(f) < In(e) /\ asnap[f] # 0 /\ DocAt(asnap[f]) = DocAt(bsnap[e]))
                       => asnap[f] <= bsnap[e]

\* 8. The window, the toolbar and the engine end up showing the same state,
\*    also after the window reloads.
Quiet == ~winBehind /\ (page = "open" => (tbAns = "none" /\ tbFresh))
R08_SurfacesAgree ==
  (Surfaces /\ Quiet) => (win = View /\ (page = "open" => tb = View))

\* 9. An outside end leaves a complete package or a clear "empty".
R09_NeverHalfWritten ==
  /\ phase = "saved" => (pkg = "complete" /\ pkgHas # {})
  /\ phase = "empty" => pkg # "complete"

\* 10. Pressing Finish twice saves once.
R10_SavesOnce == saves <= 1

\* --save-storage (#1356). The storage state is saved once the recording is
\* over and its trace is stopped, thrown away, or given up on: the outcome is
\* decided, the package written or found empty, and no trace runs or is
\* asked for, so nothing the save does is recorded or traced. The model has
\* no trace stop that runs out of time: on that path no trace is kept.
S1_StorageSavedOnceTheTraceIsOver ==
  storage # "none" => (~Alive /\ tracing # "on" /\ traceQ = <<>> /\ ~savedTold)
\* The save leaves the recording as it is, whether it works or fails: no
\* Visit, entry, decision or package changes, and the outcome stays.
S2_StorageSaveAddsNothing ==
  [][storage = "asked" /\ storage' # "asked"
     => UNCHANGED <<phase, tl, dis, kept, keptSn, newT, pkg, saves, pkgHas, pkgDis, pkgNew,
                    shown, fin, pos>>]_vars
\* Every end saves the storage state, however the recorder ends, with
\* nothing recorded too and after a Record that could not start: no end is
\* told without it (L ending). Only a failed start's trace that is still
\* being thrown away comes first.
S3_EveryEndSavesTheStorage ==
  (SaveStorage /\ ~Alive) => (storage # "none" \/ (phase = "failed" /\ discarding))
\* Without --save-storage nothing of the storage state happens: the recorder
\* ends as it does with no such step (L savesStorage).
S4_NoStorageWithoutTheFlag == ~SaveStorage => storage = "none"

\* 11. Input reaches the page in the order the person gave it. Gives way once
\*     the five-second time limit passes (README, Known limits).
X1_NothingOvertakesAHeldClick == ~overtook

\* 12. Each "after" is no later than the next "before". Breaks on B2, typing
\*     in a field the page moved the focus to by itself (README, Known
\*     limits).
X2_SnapshotsInTimeOrder ==
  \A e \in tl : \A f \in tl :
    (In(e) < In(f) /\ asnap[e] # 0 /\ DocAt(asnap[e]) = BefDoc(f)) => asnap[e] <= Bef(f)

\* 12, for an input known from its report only: the snapshot it starts from
\* (L startReported: its page's latest) is read no later than the input.
\* Breaks on B2 (README, Known limits).
X8_StartsNoLaterThanTheInput ==
  \A e \in tl : ent[e] = "rep" => bsnap[e] <= evStamp[In(e)]

\* 12 around an assertion, where B2 (typing after typing) is not in play: an
\* assertion's read is in time order with the entries next to it, and an
\* input known from its report right after an assertion starts no later than
\* the input (config Rule7-AssertThenType, 12c8bf83). Entries N + i, as typing
\* more into a field after Continue, are left out: their input's stamp is the
\* field's first key, before the pause.
X12a_AssertionReadsInTimeOrder ==
  /\ \A e, f \in tl \cap Inputs :
       (In(e) < In(f) /\ (ent[e] = "assert" \/ ent[f] = "assert")
        /\ asnap[e] # 0 /\ DocAt(asnap[e]) = BefDoc(f)) => asnap[e] <= Bef(f)
  /\ \A e \in tl \cap Inputs :
       (ent[e] = "rep" /\ \E a \in tl : ent[a] = "assert" /\ In(a) < In(e)
                                     /\ ~\E f \in tl : In(a) < In(f) /\ In(f) < In(e))
         => bsnap[e] <= evStamp[In(e)]

\* 13a. Nothing done while recording is thrown away. Gives way once the
\*      five-second time limit passes, and for input on the blank page a
\*      --start-recording recording opens on (README, Known limits).
X3_NothingYouDidIsDropped ==
  \A i \in Inputs : (ev[i] = "in" /\ Shown(i) /\ made[i].gen = gen /\ page = "open")
                      => Recorded(i)
\* 13a and 4 for what is done on a page with a Visit: a click on the blank
\* page a recording started on, or an element picked there, is not recorded,
\* as the blank page has nothing to record (known limit; config
\* Limit-BlankPageInput).
X3v_NothingDroppedOffTheBlankPage ==
  \A i \in Inputs : (ev[i] = "in" /\ Shown(i) /\ made[i].gen = gen /\ page = "open"
                     /\ ~NoVisit(made[i].doc))
                      => Recorded(i)
R04v_FinishSavesAllOffTheBlankPage ==
  pkg # "none" =>
    \A i \in Inputs :
      (/\ Shown(i) /\ made[i].gen = gen /\ at[i] \in {"page", "picked"} /\ ev[i] # "lost"
       /\ \A e \in EntOf(i) : stage[e] # "cut"
       /\ ~NoVisit(made[i].doc))
        => \E e \in EntOf(i) : e \in pkgHas

\* Wrapping up and saving never wait for something that cannot come: some
\* step that needs nobody can still happen. MayGoOn is ENABLED OnItsOwn
\* written out from the guards of those steps (TLC evaluates ENABLED of them
\* far too slowly); L2 checks the same with fairness. Breaks when the page
\* closes right after a click (README, Known limits).
MayGoOn ==
  Alive /\
  \/ \E i \in Inputs : passReq[i] \/ ev[i] = "flying" \/ revFly[i]
  \/ pend # <<>> \/ gateQ # <<>> \/ modeQ # <<>> \/ traceQ # <<>> \/ unpick
  \/ \E i \in Inputs : at[i] = "holding"
  \/ savedTold /\ phase = "saving"
  \/ During(Eng) /\ \E e \in Elems(lst) : stage[e] = "settling"
X4_WrapUpNeverGetsStuck ==
  phase \in {"wrap", "saving"} => MayGoOn

\* "Paused" on screen is the moment recording ends: what is done after Stop
\* and before that is still recorded (spec, "What makes them hold"). Gives
\* way once the five-second time limit passes (README, Known limits).
X5_StopWindowIsRecorded ==
  \A i \in Inputs : (ev[i] = "in" /\ made[i].view = "wrapPause" /\ made[i].gen = gen
                     /\ page = "open") => Recorded(i)

\* Typing is written with every key typed while recording.
X6_TypingWrittenWhole ==
  \A i \in Inputs : ~(revLost[i] /\ revMade[i].view \in ShownRec /\ made[i].gen = gen)

\* Each entry carries its own input's report.
X7_EntryHasItsOwnReport == \A e \in tl \cup pkgHas : repOf[e] = In(e)

\* Today's typing, as the plan to show it while typed starts from: while
\* recording, typing is written only once something newer happened on its
\* page (checked with one round of recording: a later round sees entries a
\* wrap-up wrote at the last).
D1_TypingWaitsForSomethingNewer ==
  phase = "recording" =>
    \A e \in tl : (ent[e] = "rep" /\ kind[In(e)] = "type")
                   => \E j \in Inputs : j > In(e) /\ kind[j] # "none"

-----------------------------------------------------------------------------
\* Typed text in the window while it is typed (built). The window
\* shows the timeline's rows (newT). A fill is an entry of typing known from
\* its report only; a choice and an upload act the same, with no more keys.
IsFillEntry(e) == ent[e] = "rep" /\ kind[In(e)] = "type"

\* A fill starts from a read of the document it was typed in, so it lands in
\* that document's Visit, never in the Visit of a document the page left
\* (c5305756; config Path-NavigationThenType).
\* A fill of its own from a revision (entry N + i, after Continue or after a
\* navigation) was typed where its revision was.
TypedDoc(e) == IF e \in Inputs THEN made[e].doc ELSE revMade[In(e)].doc
X10_FillStartsInItsDocument ==
  \A e \in tl \cup Elems(lst) :
    (IsFillEntry(e) /\ bsnap[e] # 0) => DocAt(bsnap[e]) = TypedDoc(e)

\* A read the page took of a document it has since left is never the page's
\* latest read while recording or wrapping up (L keepRead, 5ecea373; config
\* Path-ReadAcrossNavigation). The Visit of the document it was read in keeps
\* it; X3 checks that what starts from it is kept (TL keepRead, #1365;
\* config Input-ReadAcrossNavigation).
X11_LatestReadIsOfThisDocument ==
  ((phase = "recording" \/ (phase = "wrap" /\ goal # "clear")) /\ page = "open" /\ pgLatest # 0)
    => DocAt(pgLatest) = doc
WRows == newT.rows
\* The next row of the same Visit after row k, or 0.
NextInDoc(k) ==
  LET K == {j \in (k + 1)..Len(WRows) : WRows[j].d = WRows[k].d} IN
  IF K = {} THEN 0 ELSE CHOOSE j \in K : \A m \in K : j <= m
\* When the last key a row's text has was typed (a key stamped k was typed
\* after snapshot k was read).
LastKeyAt(r) == IF r.t > 1 THEN revAt[In(r.e)] ELSE pic[r.e]

\* 1. A fill shows as soon as its first text is known, once the recorder knows
\*    the page as it was before: it may wait for one read of the page, and it
\*    never shows before an earlier entry of its page. Its text is every key
\*    the engine has taken, and the rows under it are its latest read.
TextFollows ==
  \A e \in Ids : shown[e] => EntryRowOf(newT, e).t = txt[e]
F1_ShowsOnceItHasItsPlace ==
  /\ page = "open" => \A e \in Elems(lst) :
       (IsFillEntry(e) /\ rep[e] /\ bsnap[e] # 0 /\ ~BehindUnshown(Eng, e)) => shown[e]
  /\ TextFollows
  \* (a read of a page it went on to keeps its last read of its own page)
  /\ \A e \in Ids : shown[e] =>
       LET r == EntryRowOf(newT, e) IN
       IF asnap[e] # 0 /\ DocAt(asnap[e]) = r.d THEN r.b = asnap[e]
       ELSE r.b = 0 \/ (DocAt(r.b) = r.d /\ r.b < asnap[e])
\* 1 for what is done on a page with a Visit: an input made on the blank page
\* a recording started on is not recorded (known limit, X3v). A fill typed
\* once the page is at its address is checked, whatever read it starts from.
MadeOnBlank(e) == NoVisit(made[In(e)].doc)
F1v_ShowsOffTheBlankPage ==
  /\ page = "open" => \A e \in Elems(lst) :
       (~MadeOnBlank(e) /\ IsFillEntry(e) /\ rep[e] /\ bsnap[e] # 0 /\ ~BehindUnshown(Eng, e))
         => shown[e]
  /\ \A e \in Ids : (shown[e] /\ ~MadeOnBlank(e)) => EntryRowOf(newT, e).t = txt[e]
  /\ \A e \in Ids : (shown[e] /\ ~MadeOnBlank(e)) =>
       LET r == EntryRowOf(newT, e) IN
       IF asnap[e] # 0 /\ DocAt(asnap[e]) = r.d THEN r.b = asnap[e]
       ELSE r.b = 0 \/ (DocAt(r.b) = r.d /\ r.b < asnap[e])

\* 2. Once shown, it stays where it is in the list, and shows once; the
\*    entries of a page stay in the order of what you did.
F2_StaysInPlace ==
  /\ \A e \in Ids : pos[e] # 0 =>
       pos[e] <= Len(WRows) /\ WRows[pos[e]].k = "entry" /\ WRows[pos[e]].e = e
  /\ \A k, m \in 1..Len(WRows) :
       (k # m /\ WRows[k].k = "entry" /\ WRows[m].k = "entry") => WRows[k].e # WRows[m].e
  /\ \A k, m \in 1..Len(WRows) :
       (k < m /\ WRows[k].k = "entry" /\ WRows[m].k = "entry" /\ WRows[k].d = WRows[m].d)
         => In(WRows[k].e) <= In(WRows[m].e)

\* 3. The person's next action makes it final: a complete fill shown while
\*    something newer is known on its page is written for good in the same
\*    step. After that the reads its rows run between do not change, and its
\*    rows change only in two ways (F3_FinalKeepsItsChanges, a property): a
\*    key Playwright reports only after the next action still sets its text,
\*    while the page stays at its document, and the focus a click's press
\*    moved can still go from its rows to that click's, once the click is
\*    written (TL pressedAfter).
F3_NextActionMakesItFinal ==
  \A e \in Elems(lst) :
    (shown[e] /\ \E f \in Elems(lst) : Pos(Eng, f) > Pos(Eng, e) /\ ent[f] # "key")
      => stage[e] # "settled"
NoText(r) == [r EXCEPT !.t = 0, !.f = FALSE]
\* The held click that starts at read x is written in this step.
ClickWrittenAt(x) == \E c \in Ids : ent[c] = "click" /\ bsnap[c] = x /\ c \notin tl /\ c \in tl'
F3_FinalKeepsItsChanges ==
  [][\A e \in Ids : (fin[e] /\ fin'[e] /\ gen' = gen) =>
        LET r == EntryRowOf(newT, e)
            r2 == EntryRowOf(newT', e)
        IN /\ NoText(r2) = NoText(r)
           \* its text, by a revision that comes late
           /\ r2.t >= r.t
           \* the focus the next click's press moved, which goes to that click
           \* when it is written
           /\ r2.f = r.f \/ (r.f /\ ~r2.f /\ ClickWrittenAt(r.b))]_vars

\* 4. Stop and Finish keep its last text: every key typed while recording
\*    and while the page stayed at its document. A key typed once the page
\*    went to another document is a fill of its own there (F4n). Breaks
\*    when the page closes while a revision is on its way (README, Races).
F4_StopAndFinishKeepLastText ==
  (phase = "paused" \/ pkg # "none") =>
    \A i \in Inputs :
      (/\ kind[i] = "type" /\ Shown(i) /\ made[i].gen = gen /\ EntryIx(newT, i) # 0
       \* the keys typed in the stretch the fill was made in, while the page
       \* stayed at its document (after Continue, or once the page went to
       \* another document, more keys make a fill of their own; 8d1c4656)
       /\ (keys[i] = 0 \/ (revMade[i].view \in ShownRec /\ revMade[i].round = made[i].round
                           /\ revMade[i].doc = made[i].doc)))
        => EntryRowOf(newT, i).t = 1 + keys[i]

\* 4, the other way: a key typed once the page went to another document is
\* never the text of the fill before (8d1c4656; config
\* Path-TypingAfterNavigation, where a field takes one more key at most).
F4n_KeyElsewhereIsNotTheFillsText ==
  \A i \in Inputs :
    (kind[i] = "type" /\ keys[i] = 1 /\ revMade[i].doc # made[i].doc /\ EntryIx(newT, i) # 0)
      => EntryRowOf(newT, i).t = 1

\* 5. Clear removes it for good. No late report brings it back.
F5_ClearRemovesForGood ==
  /\ phase = "off" => WRows = <<>>
  /\ \A k \in 1..Len(WRows) : WRows[k].e # 0 => made[In(WRows[k].e)].gen = gen

\* 6. What the window shows at the end is what is saved: the package is the
\*    window's rows, Visit by Visit, and then what changed after the last
\*    entry of each Visit.
F6_WindowIsWhatIsSaved ==
  pkg # "none" => \A d \in 1..MaxDoc :
    LET w == PerDoc(WRows, d)
        p == PerDoc(pkgNew, d)
    IN Len(w) <= Len(p) /\ SubSeq(p, 1, Len(w)) = w

\* 7. What a fill changed is measured from the page before its first key
\*    until whichever comes first: the page going quiet after its last key,
\*    or the person's next action. Rows under a live fill are replaced, never
\*    appended; what changes after the page went quiet and before the next
\*    action is a row of its own. Except, as a known limit (bug B2): typing
\*    into another field before the page went quiet, with no held input
\*    between (the page moved the focus by itself), ends the earlier fill only
\*    when the recorder learns of it, and that later fill starts there.
\*    While a fill is live its text may be ahead of its rows: they end at a
\*    read after its first key, and at a read after its last key once final.
\*    When its typing makes the page navigate, or the page closes, before it
\*    is read again, its changes go up to the last read of its own page (TL
\*    replace; configs Rule7-Navigation, Rules-Ends, Rules-StartRecording).
SharedStart(e) ==
  \E f \in Ids : In(f) < In(e) /\ IsFillEntry(f) /\ asnap[f] # 0 /\ asnap[f] = bsnap[e]
StartsAt(j, x) == \E f \in {j, N + j} : IsFillEntry(f) /\ bsnap[f] = x
LastReadOf(d) == LET K == {k \in keptSn : DocAt(k) = d} IN
                 IF K = {} THEN 0 ELSE CHOOSE k \in K : \A j \in K : j <= k
\* its latest read is of the page it went on to, or the page closed: it ends
\* at the last read of its own page
WentElsewhere(r) == /\ (asnap[r.e] # 0 /\ DocAt(asnap[r.e]) # r.d) \/ page = "closed"
                    /\ r.b = LastReadOf(r.d)
F7_MeasuredFromFirstKey ==
  \A k \in 1..Len(WRows) :
    LET r == WRows[k] IN
    (r.k = "entry" /\ IsFillEntry(r.e)) =>
      \* from its first key: its picture, and a start no later than that key
      /\ (k > 1 /\ WRows[k - 1].k = "before" /\ WRows[k - 1].e = r.e)
           => (r.a = pic[r.e] /\ (WRows[k - 1].a <= pic[r.e] \/ SharedStart(r.e)))
      \* to after its last key, once final (a key whose revision came after
      \* the next action sets only the text); while live, after its first
      /\ (r.b # 0 /\ fin[r.e]) => (r.b > (IF stage[r.e] = "textSet" THEN pic[r.e] ELSE LastKeyAt(r))
                                  \/ WentElsewhere(r))
      /\ (r.b # 0 /\ ~fin[r.e]) => r.b > pic[r.e]
      \* and not past the next action that reached the page
      /\ r.b # 0 => \A j \in Inputs : (j > In(r.e) /\ at[j] = "page" /\ made[j].doc = r.d)
                                       => (r.b <= evStamp[j] \/ StartsAt(j, r.b))
      \* the next row of its Visit starts where it ends: nothing appended inside
      /\ (r.b # 0 /\ NextInDoc(k) # 0) => r.b <= WRows[NextInDoc(k)].a

\* 7 without the exception for B2: with LeaveOutB2 it shows that B2 is the
\* only path the exception covers.
F7s_MeasuredStrictly ==
  \A k \in 1..Len(WRows) :
    LET r == WRows[k] IN
    (r.k = "entry" /\ IsFillEntry(r.e)) =>
      /\ (k > 1 /\ WRows[k - 1].k = "before" /\ WRows[k - 1].e = r.e)
           => (r.a = pic[r.e] /\ WRows[k - 1].a <= pic[r.e])
      /\ (r.b # 0 /\ fin[r.e]) => (r.b > (IF stage[r.e] = "textSet" THEN pic[r.e] ELSE LastKeyAt(r))
                                  \/ WentElsewhere(r))
      /\ (r.b # 0 /\ ~fin[r.e]) => r.b > pic[r.e]
      /\ r.b # 0 => \A j \in Inputs : (j > In(r.e) /\ at[j] = "page" /\ made[j].doc = r.d)
                                       => r.b <= evStamp[j]
      /\ (r.b # 0 /\ NextInDoc(k) # 0) => r.b <= WRows[NextInDoc(k)].a

\* Probes of the window: each must BREAK, which gives a path to the situation.
LiveRow(e) == shown[e] /\ ~fin[e]
TextAhead(e) == LiveRow(e) /\ keys[e] > 0 /\ EntryRowOf(newT, e).t > 1
                /\ EntryRowOf(newT, e).b # 0 /\ EntryRowOf(newT, e).b <= revAt[e]
P15_NeverTextAheadOfRows == ~\E e \in Inputs : TextAhead(e)
P16_NeverStopsWithTextAhead ==
  ~(phase = "wrap" /\ goal = "pause" /\ \E e \in Inputs : TextAhead(e) /\ made[e].view \in ShownRec)
P17_NeverFinishesWithTextAhead ==
  ~(phase = "wrap" /\ goal = "save" /\ \E e \in Inputs : TextAhead(e) /\ made[e].view \in ShownRec)
P18_NeverClearsALiveFill == ~(phase = "wrap" /\ goal = "clear" /\ \E e \in Inputs : LiveRow(e))
P19_NeverNavigatesUnderALiveFill == ~\E e \in Inputs : LiveRow(e) /\ doc > made[e].doc
P20_NeverShowsTextOnly == ~\E e \in Inputs : LiveRow(e) /\ asnap[e] = 0
P21_NeverWaitsToShow ==
  ~(page = "open" /\ \E e \in Elems(lst) : IsFillEntry(e) /\ rep[e] /\ ~shown[e])
P22_NeverStartsAFillFromARevision == ~\E i \in Inputs : IsFillEntry(N + i)
P23_NeverSetsAFinalFillsText == ~\E e \in Ids : stage[e] = "textSet"
\* --save-storage: the save is reached with nothing recorded, with a package,
\* and fails (a warning).
P26_NeverSavesStorageWithNothingRecorded == ~(storage = "saved" /\ phase = "empty")
P27_NeverSavesStorageWithAPackage == ~(storage = "saved" /\ phase = "saved")
P28_NeverWarnsOfTheStorage == storage # "failed"
\* --save-storage after a Record that could not start (StartFails): the save
\* is reached when the trace never started, and once a started one is gone.
\* No package was saved on either path (saves = 0): a package that could not
\* be written (P31) is no failed start.
P29_NeverSavesStorageAfterTheTraceFailedToStart ==
  ~(phase = "failed" /\ storage = "saved" /\ traceStarting)
P31_NeverSavesStorageAfterAFailedWrite ==
  ~(phase = "failed" /\ storage = "saved" /\ saves = 1)
P30_NeverSavesStorageAfterAFailedStartsTraceIsGone ==
  ~(phase = "failed" /\ storage = "saved" /\ ~traceStarting /\ saves = 0)

-----------------------------------------------------------------------------
\* Narrower versions of rule 12, each to get its own shortest path.
WrapView == {"wrapPause", "wrapSave", "wrapClear"}
\* After Stop, an input given while one made before Stop still settles (bug
\* B1 as first found).
N1_AfterStopInTimeOrder ==
  \A e \in tl : \A f \in tl :
    (In(e) < In(f) /\ Shown(In(e)) /\ made[In(f)].view \in WrapView /\ asnap[e] # 0
     /\ DocAt(asnap[e]) = BefDoc(f)) => asnap[e] <= Bef(f)
\* After Stop, two inputs both given after Stop.
N1b_AfterStopBothInTimeOrder ==
  \A e \in tl : \A f \in tl :
    (In(e) < In(f) /\ made[In(e)].view \in WrapView /\ made[In(f)].view \in WrapView
     /\ asnap[e] # 0 /\ DocAt(asnap[e]) = BefDoc(f)) => asnap[e] <= Bef(f)
\* After Stop, an input known from its report starts at a later snapshot.
N2_AfterStopStartsInTime ==
  \A e \in tl : (ent[e] = "rep" /\ made[In(e)].view \in WrapView) => bsnap[e] <= evStamp[In(e)]
\* While recording: typing, then typing in another field.
N3_TypingThenTypingInTimeOrder ==
  \A e \in tl : \A f \in tl :
    (In(e) < In(f) /\ Shown(In(e)) /\ Shown(In(f)) /\ kind[In(e)] = "type"
     /\ kind[In(f)] = "type" /\ asnap[e] # 0 /\ DocAt(asnap[e]) = BefDoc(f))
       => asnap[e] <= Bef(f)
\* While recording: an input known from its report starts at a later snapshot.
N4_RecordingStartsInTime ==
  \A e \in tl : (ent[e] = "rep" /\ Shown(In(e))) => bsnap[e] <= evStamp[In(e)]
\* While recording, any two inputs but two typings in a row.
N5_RecordingInTimeOrder ==
  \A e \in tl : \A f \in tl :
    (In(e) < In(f) /\ Shown(In(e)) /\ Shown(In(f)) /\ asnap[e] # 0
     /\ ~(kind[In(e)] = "type" /\ kind[In(f)] = "type")
     /\ DocAt(asnap[e]) = BefDoc(f)) => asnap[e] <= Bef(f)
N6_RecordingStartsInTime ==
  \A e \in tl : (ent[e] = "rep" /\ Shown(In(e)) /\ ~\E f \in tl : f # e /\ ent[f] = "rep"
                   /\ kind[In(f)] = "type" /\ kind[In(e)] = "type")
                  => bsnap[e] <= evStamp[In(e)]

-----------------------------------------------------------------------------
\* Probes: each must BREAK, which shows the model can reach that situation.
P1_NeverSavesTwoEntries == ~(pkg = "complete" /\ Cardinality(pkgHas) = 2)
P2_NeverSavesADiscard == ~(pkg = "complete" /\ pkgDis # {})
\* A decision taken while recording, with no Stop before it.
\* A fill discarded while it is typed, and typed on.
P25_NeverTypesOnInADiscardedFill == ~(\E e \in Ids : e \in dis /\ shown[e] /\ txt[e] > 1)
P24_NeverDiscardsWhileRecording == ~(phase = "recording" /\ boot = "none" /\ dis # {})
P3_NeverRecordsAnAssertionAfterAClick ==
  ~(\E e \in tl : \E f \in tl : In(f) < In(e) /\ ent[e] = "assert" /\ ent[f] = "click")
P4_NeverRecordsANavigation ==
  ~(\E e \in tl : asnap[e] # 0 /\ DocAt(asnap[e]) # DocAt(bsnap[e]))
P5_NeverCutsASettleShort ==
  ~(\E e \in tl : \E f \in tl : In(e) < In(f) /\ ent[e] = "click" /\ asnap[e] # 0
                                 /\ asnap[e] = bsnap[f])
P6_NeverClearsThenRecordsAgain == ~(gen = 1 /\ tl # {})
P7_NeverHoldsAClickDuringWrapUp == ~(phase = "wrap" /\ \E i \in Inputs : at[i] = "held")
P8_NeverEndsEmptyAfterRecording == ~(phase = "empty" /\ rounds > 0 /\ gen = 0)
P9_NeverSavesWithPageClosed == ~(pkg = "complete" /\ page = "closed")
P10_NeverHoldsTyping == ~(\E e \in Ids : ent[e] = "key" /\ InL(Eng, e))
P11_NeverWritesRevisedTyping == ~(\E i \in Inputs : keys[i] > 0 /\ i \in tl)
P12_NeverWritesTypingWhileRecording ==
  ~(phase = "recording" /\ \E e \in tl : ent[e] = "rep" /\ kind[In(e)] = "type")
P13_NeverEndsTypingAtAClick ==
  ~(\E e \in tl : \E f \in tl : ent[e] = "rep" /\ ent[f] = "click" /\ asnap[e] # 0
                                 /\ asnap[e] = bsnap[f])
P14_NeverPausesWithTypingWritten ==
  ~(phase = "paused" /\ \E e \in tl : ent[e] = "rep" /\ kind[In(e)] = "type")

-----------------------------------------------------------------------------
\* Progress, checked with fairness: steps that need nobody keep happening.
\* One condition for all of them together (TLC evaluates each fairness
\* condition on every step, and one per step is far too slow here). In these
\* bounded runs the person stops acting after a while, so the steps that need
\* nobody keep happening until none can; L2 then says the wrap-up has ended.
Fair == WF_vars(OnItsOwn) /\ WF_vars(TimeLimitPasses)
LiveSpec == Init /\ [][Next]_vars /\ Fair

\* A held click is always passed on, or its document goes away.
L1_HeldClickIsPassedOn ==
  \A i \in Inputs : (at[i] = "held") ~> (at[i] # "held" \/ page = "closed" \/ ~Alive)
\* Wrapping up and saving always come to an end.
L2_WrapUpEnds ==
  (phase \in {"wrap", "saving"}) ~> (phase \notin {"wrap", "saving"})

-----------------------------------------------------------------------------
\* Smaller step sets, only for drawing the two charts.

\* The lifecycle: the commands and what the engine does on its own; no click
\* or typing that reaches the page. Drawn with N = 0, so without Assert
\* visibility, to stay within the chart's 500 states.
LifeNext ==
  \/ YouPressRecord \/ YouPressStop \/ YouPressContinue \/ YouPressFinish
  \/ YouPressClear \/ YouPressAssert \/ YouLeaveAssert
  \/ \E i \in Inputs : ClickPicked(i)
  \/ SnapshotTaken \/ SnapshotFails
  \/ \E i \in Inputs : ReportArrives(i) \/ PassGone(i)
  \/ GateSwitchLands \/ ModeLands \/ TraceLands \/ SavedArrives \/ StorageLands \/ GatesUnpick
  \/ TerminalStop \/ PageCloses
  \/ Ended

\* One click through the gate, from a recording whose page holds inputs back.
\* Init with the recording started and answered.
StartedRecording ==
  /\ phase = "recording" /\ boot = "none" /\ resumed = FALSE /\ picking = "off"
  /\ goal = "none" /\ gateOffAsked = FALSE /\ gateOff = FALSE /\ finals = "no" /\ switchingOff = FALSE
  /\ traceStarting = FALSE /\ discarding = FALSE /\ stopping = FALSE
  /\ savedTold = FALSE /\ storage = "none" /\ gen = 0 /\ pgHold = TRUE /\ pgLatest = 0 /\ pgMoved = FALSE /\ lst = <<>>
  /\ ent = [e \in Ids |-> "none"] /\ stage = [e \in Ids |-> "none"]
  /\ rep = [e \in Ids |-> FALSE] /\ repOf = [e \in Ids |-> 0]
  /\ unrep = [e \in Ids |-> FALSE] /\ revised = [e \in Ids |-> FALSE]
  /\ bsnap = [e \in Ids |-> 0] /\ asnap = [e \in Ids |-> 0] /\ pend = <<>>
  /\ passReq = [i \in Inputs |-> FALSE] /\ gateQ = <<>> /\ modeQ = <<>> /\ traceQ = <<>>
  /\ tl = {} /\ tlAtPause = {} /\ dis = {} /\ kept = {}
  /\ revLost = [i \in Inputs |-> FALSE]
  /\ pkg = "none" /\ saves = 0 /\ pkgHas = {} /\ pkgDis = {}
  /\ keptSn = {} /\ newT = NoTL /\ pkgNew = <<>>
  /\ pgReported = FALSE /\ pgLastFill = 0 /\ els = {} /\ pic = [e \in Ids |-> 0]
  /\ shown = [e \in Ids |-> FALSE] /\ txt = [e \in Ids |-> 0]
  /\ fin = [e \in Ids |-> FALSE] /\ pos = [e \in Ids |-> 0]
  /\ page = "open" /\ doc = 1 /\ navFlying = FALSE /\ gateOn = TRUE /\ holdPg = TRUE
  /\ gateStart = TRUE /\ pickPg = FALSE /\ unpick = FALSE /\ mode = "rec"
  /\ tracing = "on" /\ clock = 1 /\ docOf = <<1>> /\ readFly = NoRead /\ seen = 1
  /\ kind = [i \in Inputs |-> "none"] /\ at = [i \in Inputs |-> "notyet"]
  /\ hits = [i \in Inputs |-> 0] /\ ev = [i \in Inputs |-> "none"]
  /\ ord = [i \in Inputs |-> 0] /\ evStamp = [i \in Inputs |-> 0]
  /\ made = [i \in Inputs |-> [phase |-> "none", view |-> "none", gen |-> 0, doc |-> 0, round |-> 0]]
  /\ keys = [i \in Inputs |-> 0] /\ revFly = [i \in Inputs |-> FALSE]
  /\ revOrd = [i \in Inputs |-> 0] /\ revMade = [i \in Inputs |-> [view |-> "none", round |-> 0, doc |-> 0]]
  /\ revAt = [i \in Inputs |-> 0]
  /\ touched = [i \in Inputs |-> FALSE] /\ heldEver = [i \in Inputs |-> FALSE]
  /\ navs = [i \in Inputs |-> FALSE] /\ wrong = [i \in Inputs |-> FALSE]
  /\ overtook = FALSE
  /\ tb = "off" /\ tbAns = "none" /\ tbFresh = TRUE /\ ansFresh = TRUE
  /\ win = "off" /\ winBehind = FALSE
  /\ stops = 0 /\ rounds = 1 /\ finishAgain = FALSE /\ asserts = 0

PageClosesWhileHeld == (\E i \in Inputs : at[i] = "held") /\ PageCloses

GateNext ==
  \/ \E i \in Inputs : ClickHeld(i) \/ PassOn(i)
  \/ SnapshotTaken
  \/ \E e \in Ids : PageSettles(e)
  \/ \E i \in Inputs : ReportArrives(i)
  \/ NavCommits \/ PageClosesWhileHeld

\* A fill's life, from its first key to final: input 1 is typing, input 2 the
\* person's next action (a click). Drawn from StartedRecording.
FTypeHeld == ~fin[1] /\ TypeHeld(1)
FTypeReaches == ~fin[1] /\ TypeReaches(1)
FTypeMore == ~fin[1] /\ TypeMore(1)
FClick == ~fin[1] /\ ClickHeld(2)
FPassOn == ~fin[1] /\ \E i \in Inputs : PassOn(i)
FReport == ~fin[1] /\ \E i \in Inputs : ReportArrives(i)
FRevision == ~fin[1] /\ \E i \in Inputs : RevisionArrives(i)
FSnapshot == ~fin[1] /\ SnapshotTaken
FSettles == ~fin[1] /\ \E e \in Ids : PageSettles(e)
FStop == ~fin[1] /\ YouPressStop
FGate == ~fin[1] /\ GateSwitchLands
FMode == ~fin[1] /\ ModeLands
FillNext ==
  \/ FTypeHeld \/ FTypeReaches \/ FTypeMore \/ FClick \/ FPassOn \/ FReport
  \/ FRevision \/ FSnapshot \/ FSettles \/ FStop \/ FGate \/ FMode

=============================================================================
