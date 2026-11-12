------------------------------ MODULE Recorder ------------------------------
\* The lifecycle of the browser-flow recorder, before it is built.
\* One page, one recorder window, one toolbar, N things the person does.
\* Every switch below that is FALSE gives the "simplest design"; TRUE adds
\* one proposed design piece. Simple.cfg has all FALSE, Proposed.cfg all TRUE.
EXTENDS Naturals, FiniteSets

CONSTANTS
  N,                \* how many things the person does on the page
  MaxDoc,           \* how many documents the page can show (navigations + 1)
  MaxGen,           \* how many times Clear can be pressed
  WaitGate,         \* wrap-up waits until the page confirms the gate is off
  WaitHeld,         \* wrap-up waits until every held click has been passed on
  WaitReports,      \* wrap-up waits until Playwright's reports are in
  RecorderOff,      \* Playwright's own recorder is off (and out of picking) when not recording
  GateStartsRight,  \* a freshly loaded document starts with the gate matching the recorder
  NewerCloses,      \* a typing report or an assertion closes the previous interaction
  KeepOrder,        \* while a click is held, whatever comes next waits behind it
  AssertWaits,      \* Assert visibility takes effect only when no click is held
  IgnoreSecondStop, \* a second terminal stop does not kill the recorder mid-way
  Revisions,        \* the toolbar ignores a state older than one it already has
  Surfaces          \* model the toolbar and the window lagging behind the engine

VARIABLES
  \* the engine
  phase,      \* off | recording | wrap | paused | saving | saved | empty | dead
  goal,       \* while wrapping up: pause | save | clear | quit
  gen,        \* how many times the recording was cleared
  tracing,    \* off | on | kept
  mode,       \* Playwright's recorder: none | rec | pick
  stops,      \* terminal stops received
  \* the package on disk
  pkg, saves, pkgHas, pkgDis, finishAgain,
  \* the timeline
  tl, tlAtPause, dis, kept,
  \* what the person did on the page, one slot per thing
  kind,       \* none | click | type
  at,         \* notyet | held | snapped | page | picked | gone
  hits,       \* how many times the page received it
  ev,         \* Playwright's report: none | flying | in | lost
  evStamp,    \* when the report's own snapshot was taken
  bef, aft,   \* when "before" and "after" were taken (0 = not yet)
  left,       \* the interaction left the page (navigation, closed page)
  made,       \* what the recorder was doing when the person did it
  touched,    \* something swallowed it (the gate or Playwright's picker)
  heldEver, navs, wrong, overtook, clock,
  \* the page
  page, doc, navFlying, gateOn, gateMsg, gateEver,
  \* the toolbar and the window
  tb, tbPush, tbReply, tbAsk, win, winBehind, told

gEngine == <<phase, goal, gen, tracing, mode, stops>>
gPkg    == <<pkg, saves, pkgHas, pkgDis, finishAgain>>
gLine   == <<tl, tlAtPause, dis, kept>>
gIn     == <<kind, at, hits, ev, evStamp, bef, aft, left, made, touched,
             heldEver, navs, wrong, overtook, clock>>
gPage   == <<page, doc, navFlying, gateOn, gateMsg, gateEver>>
gTb     == <<tb, tbPush, tbReply, tbAsk>>
gWin    == <<win, winBehind, told>>
vars    == <<gEngine, gPkg, gLine, gIn, gPage, gTb, gWin>>

Inputs == 1..N

Alive      == phase \notin {"saved", "empty", "dead"}
Pending(i) == at[i] \in {"held", "snapped"}
AnyPending == \E i \in Inputs : Pending(i)
IsNext(i)  == at[i] = "notyet" /\ \A j \in Inputs : j < i => at[j] # "notyet"

\* A report for something the gate did not hold (typing, an assertion, a
\* click made while the gate was off). Assumed to reach the engine before
\* the reply to any snapshot taken later.
UngatedFlying ==
  \E k \in Inputs : ev[k] = "flying" /\ (~heldEver[k] \/ at[k] = "picked")

\* The interaction reached the page and the engine still owes it an "after".
Waiting(j) ==
  /\ at[j] = "page" /\ aft[j] = 0 /\ ~left[j]
  /\ heldEver[j] \/ j \in tl

View == IF phase = "recording" /\ mode = "pick" THEN "picking" ELSE phase
Shows(S) == ~Surfaces \/ tb \in S \/ win \in S
\* The engine announces each change of state before it makes the next one.
Told == ~Surfaces \/ told = View

SendGate(want) ==
  IF page # "open" \/ gateOn = want THEN "none"
  ELSE IF want THEN "on" ELSE "off"

-----------------------------------------------------------------------------
Init ==
  /\ phase = "off" /\ goal = "none" /\ gen = 0 /\ tracing = "off"
  /\ mode = (IF RecorderOff THEN "none" ELSE "rec") /\ stops = 0
  /\ pkg = "none" /\ saves = 0 /\ pkgHas = {} /\ pkgDis = {} /\ finishAgain = FALSE
  /\ tl = {} /\ tlAtPause = {} /\ dis = {} /\ kept = {}
  /\ kind = [i \in Inputs |-> "none"]
  /\ at = [i \in Inputs |-> "notyet"]
  /\ hits = [i \in Inputs |-> 0]
  /\ ev = [i \in Inputs |-> "none"]
  /\ evStamp = [i \in Inputs |-> 0]
  /\ bef = [i \in Inputs |-> 0]
  /\ aft = [i \in Inputs |-> 0]
  /\ left = [i \in Inputs |-> FALSE]
  /\ made = [i \in Inputs |-> [phase |-> "none", gen |-> 0, doc |-> 0]]
  /\ touched = [i \in Inputs |-> FALSE]
  /\ heldEver = [i \in Inputs |-> FALSE]
  /\ navs = [i \in Inputs |-> FALSE]
  /\ wrong = [i \in Inputs |-> FALSE]
  /\ overtook = FALSE /\ clock = 1
  /\ page = "open" /\ doc = 1 /\ navFlying = FALSE
  /\ gateOn = FALSE /\ gateMsg = "none" /\ gateEver = FALSE
  /\ tb = "off" /\ tbPush = "none" /\ tbReply = "none" /\ tbAsk = FALSE
  /\ win = "off" /\ winBehind = FALSE /\ told = "off"

-----------------------------------------------------------------------------
\* Commands

\* Stop, Finish, Clear and an end from outside all start a wrap-up.
BeginWrap(g) ==
  /\ phase' = "wrap"
  /\ goal' = g
  /\ mode' = (IF RecorderOff /\ mode = "pick" THEN "rec" ELSE mode)
  /\ kept' = dis
  /\ tlAtPause' = {}

YouPressRecord ==
  /\ phase = "off" /\ page = "open" /\ Shows({"off"}) /\ Told
  /\ phase' = "recording" /\ tracing' = "on" /\ mode' = "rec"
  /\ gateMsg' = SendGate(TRUE) /\ gateEver' = TRUE
  /\ UNCHANGED <<goal, gen, stops, gPkg, gLine, gIn, page, doc, navFlying, gateOn, gTb, gWin>>

YouPressStop ==
  /\ phase = "recording" /\ Shows({"recording", "picking"}) /\ Told
  /\ BeginWrap("pause")
  /\ gateMsg' = SendGate(FALSE)
  /\ UNCHANGED <<gen, tracing, stops, gPkg, tl, dis, gIn, page, doc, navFlying,
                 gateOn, gateEver, gTb, gWin>>

YouPressContinue ==
  /\ phase = "paused" /\ page = "open" /\ Shows({"paused"}) /\ Told
  /\ phase' = "recording"
  /\ mode' = (IF RecorderOff THEN "rec" ELSE mode)
  /\ kept' = dis /\ tlAtPause' = {}
  /\ gateMsg' = SendGate(TRUE)
  /\ UNCHANGED <<goal, gen, tracing, stops, gPkg, tl, dis, gIn, page, doc,
                 navFlying, gateOn, gateEver, gTb, gWin>>

YouPressFinish ==
  /\ phase \in {"recording", "paused"} /\ Shows({"recording", "picking", "paused"}) /\ Told
  /\ BeginWrap("save")
  /\ gateMsg' = SendGate(FALSE)
  /\ UNCHANGED <<gen, tracing, stops, gPkg, tl, dis, gIn, page, doc, navFlying,
                 gateOn, gateEver, gTb, gWin>>

\* The second press arrives while the first is being handled. It is ignored.
YouPressFinishAgain ==
  /\ ~finishAgain
  /\ (phase = "wrap" /\ goal = "save") \/ phase = "saving"
  /\ finishAgain' = TRUE
  /\ UNCHANGED <<gEngine, pkg, saves, pkgHas, pkgDis, gLine, gIn, gPage, gTb, gWin>>

YouPressClear ==
  /\ phase \in {"recording", "paused"} /\ gen < MaxGen
  /\ Shows({"recording", "picking", "paused"}) /\ Told
  /\ BeginWrap("clear")
  /\ gateMsg' = SendGate(FALSE)
  /\ UNCHANGED <<gen, tracing, stops, gPkg, tl, dis, gIn, page, doc, navFlying,
                 gateOn, gateEver, gTb, gWin>>

YouPressAssert ==
  /\ phase = "recording" /\ mode = "rec" /\ page = "open" /\ Shows({"recording"}) /\ Told
  /\ AssertWaits => ~AnyPending
  /\ mode' = "pick"
  /\ UNCHANGED <<phase, goal, gen, tracing, stops, gPkg, gLine, gIn, gPage, gTb, gWin>>

YouDiscard(i) ==
  /\ phase = "paused" /\ (~Surfaces \/ win = "paused")
  /\ i \in tl \ dis
  /\ dis' = dis \cup {i}
  /\ UNCHANGED <<gEngine, gPkg, tl, tlAtPause, kept, gIn, gPage, gTb, gWin>>

YouRestore(i) ==
  /\ phase = "paused" /\ (~Surfaces \/ win = "paused")
  /\ i \in dis
  /\ dis' = dis \ {i}
  /\ UNCHANGED <<gEngine, gPkg, tl, tlAtPause, kept, gIn, gPage, gTb, gWin>>

-----------------------------------------------------------------------------
\* What the person does on the page

NavOptions == IF doc < MaxDoc /\ ~navFlying THEN BOOLEAN ELSE {FALSE}

YouClick(i) ==
  /\ page = "open" /\ IsNext(i)
  /\ mode = "pick" => Told
  /\ kind' = [kind EXCEPT ![i] = "click"]
  /\ made' = [made EXCEPT ![i] = [phase |-> phase, gen |-> gen, doc |-> doc]]
  /\ IF mode = "pick"
     THEN \* Playwright's picker swallows it and reports an assertion
          /\ at' = [at EXCEPT ![i] = "picked"]
          /\ ev' = [ev EXCEPT ![i] = "flying"]
          /\ evStamp' = [evStamp EXCEPT ![i] = clock]
          /\ touched' = [touched EXCEPT ![i] = TRUE]
          /\ mode' = "rec"
          /\ UNCHANGED <<hits, heldEver, navs, navFlying, overtook>>
     ELSE IF gateOn \/ (KeepOrder /\ AnyPending)
     THEN \* the gate swallows it and tells the engine
          /\ at' = [at EXCEPT ![i] = "held"]
          /\ touched' = [touched EXCEPT ![i] = TRUE]
          /\ heldEver' = [heldEver EXCEPT ![i] = TRUE]
          /\ \E n \in NavOptions : navs' = [navs EXCEPT ![i] = n]
          /\ UNCHANGED <<hits, ev, evStamp, mode, navFlying, overtook>>
     ELSE \* nothing holds it: it reaches the page as usual
          /\ at' = [at EXCEPT ![i] = "page"]
          /\ hits' = [hits EXCEPT ![i] = 1]
          /\ ev' = [ev EXCEPT ![i] = IF mode = "none" THEN "none" ELSE "flying"]
          /\ evStamp' = [evStamp EXCEPT ![i] = clock]
          /\ overtook' = (overtook \/ AnyPending)
          /\ \E n \in NavOptions : navFlying' = (navFlying \/ n)
          /\ UNCHANGED <<touched, heldEver, navs, mode>>
  /\ UNCHANGED <<phase, goal, gen, tracing, stops, gPkg, gLine, bef, aft, left,
                 wrong, clock, page, doc, gateOn, gateMsg, gateEver, gTb, gWin>>

\* Typing, choosing in a native select, uploading a file: never held.
YouType(i) ==
  /\ page = "open" /\ IsNext(i)
  /\ KeepOrder => ~AnyPending
  /\ kind' = [kind EXCEPT ![i] = "type"]
  /\ made' = [made EXCEPT ![i] = [phase |-> phase, gen |-> gen, doc |-> doc]]
  /\ at' = [at EXCEPT ![i] = "page"]
  /\ hits' = [hits EXCEPT ![i] = 1]
  /\ ev' = [ev EXCEPT ![i] = IF mode = "none" THEN "none" ELSE "flying"]
  /\ evStamp' = [evStamp EXCEPT ![i] = clock]
  /\ overtook' = (overtook \/ AnyPending)
  /\ UNCHANGED <<gEngine, gPkg, gLine, bef, aft, left, touched, heldEver, navs,
                 wrong, clock, gPage, gTb, gWin>>

-----------------------------------------------------------------------------
\* The gate, as the engine runs it

TakeBefore(i) ==
  /\ Alive /\ page = "open" /\ at[i] = "held"
  /\ \A j \in Inputs : j < i => ~Pending(j)
  /\ ~UngatedFlying
  /\ clock' = clock + 1
  /\ bef' = [bef EXCEPT ![i] = clock + 1]
  \* a new "before" is also the "after" of whatever was still settling
  /\ aft' = [j \in Inputs |-> IF j < i /\ Waiting(j) THEN clock + 1 ELSE aft[j]]
  /\ at' = [at EXCEPT ![i] = "snapped"]
  /\ UNCHANGED <<gEngine, gPkg, gLine, kind, hits, ev, evStamp, left, made,
                 touched, heldEver, navs, wrong, overtook, gPage, gTb, gWin>>

Resend(i) ==
  /\ Alive /\ page = "open" /\ at[i] = "snapped"
  /\ mode = "pick" => Told
  /\ IF mode = "pick"
     THEN \* Playwright's picker swallows the re-sent click
          /\ at' = [at EXCEPT ![i] = "picked"]
          /\ ev' = [ev EXCEPT ![i] = "flying"]
          /\ evStamp' = [evStamp EXCEPT ![i] = clock]
          /\ mode' = "rec"
          /\ UNCHANGED <<hits, left, wrong, navFlying>>
     ELSE /\ at' = [at EXCEPT ![i] = "page"]
          /\ hits' = [hits EXCEPT ![i] = @ + 1]
          /\ ev' = [ev EXCEPT ![i] = IF mode = "none" THEN "none" ELSE "flying"]
          /\ IF made[i].doc = doc
             THEN /\ navFlying' = (navFlying \/ navs[i])
                  /\ UNCHANGED <<left, wrong>>
             ELSE \* the page it was made on is gone: it lands on the new one
                  /\ left' = [left EXCEPT ![i] = TRUE]
                  /\ wrong' = [wrong EXCEPT ![i] = TRUE]
                  /\ UNCHANGED navFlying
          /\ UNCHANGED <<mode, evStamp>>
  /\ UNCHANGED <<phase, goal, gen, tracing, stops, gPkg, gLine, kind, bef, aft,
                 made, touched, heldEver, navs, overtook, clock, page, doc,
                 gateOn, gateMsg, gateEver, gTb, gWin>>

\* The page has been quiet for 150 ms, or 2 s have passed.
TakeAfter(i) ==
  /\ Alive /\ page = "open" /\ Waiting(i) /\ bef[i] # 0
  /\ ~UngatedFlying
  /\ clock' = clock + 1
  /\ aft' = [aft EXCEPT ![i] = clock + 1]
  /\ UNCHANGED <<gEngine, gPkg, gLine, kind, at, hits, ev, evStamp, bef, left,
                 made, touched, heldEver, navs, wrong, overtook, gPage, gTb, gWin>>

\* Playwright's report reaches the engine, some time after the input.
ReportArrives(i) ==
  /\ Alive /\ ev[i] = "flying"
  /\ \A j \in Inputs : j < i => ev[j] # "flying"
  /\ ev' = [ev EXCEPT ![i] = "in"]
  /\ IF phase \in {"recording", "wrap"}
     THEN /\ tl' = tl \cup {i}
          /\ IF heldEver[i] /\ at[i] # "picked"
             THEN UNCHANGED <<bef, aft>>   \* the gate already took its "before"
             ELSE /\ bef' = [bef EXCEPT ![i] = evStamp[i]]
                  /\ aft' = [j \in Inputs |->
                              IF j = i /\ at[i] = "picked" THEN evStamp[i]
                              ELSE IF NewerCloses /\ j < i /\ Waiting(j) THEN evStamp[i]
                              ELSE aft[j]]
     ELSE UNCHANGED <<tl, bef, aft>>       \* not recording: thrown away
  /\ UNCHANGED <<gEngine, gPkg, tlAtPause, dis, kept, kind, at, hits, evStamp,
                 left, made, touched, heldEver, navs, wrong, overtook, clock,
                 gPage, gTb, gWin>>

-----------------------------------------------------------------------------
\* The page

GateMsgLands ==
  /\ page = "open" /\ gateMsg # "none"
  /\ gateOn' = (gateMsg = "on")
  /\ gateMsg' = "none"
  /\ UNCHANGED <<gEngine, gPkg, gLine, gIn, page, doc, navFlying, gateEver, gTb, gWin>>

NavCommits ==
  /\ page = "open" /\ navFlying
  /\ doc' = doc + 1 /\ navFlying' = FALSE
  /\ gateOn' = (IF ~Alive THEN FALSE
                ELSE IF GateStartsRight THEN phase = "recording"
                ELSE gateEver)
  /\ gateMsg' = "none"
  /\ left' = [j \in Inputs |-> left[j] \/ (at[j] = "page" /\ aft[j] = 0)]
  /\ tb' = (IF Surfaces THEN "loading" ELSE tb)
  /\ tbAsk' = Surfaces /\ tbPush' = "none" /\ tbReply' = "none"
  /\ UNCHANGED <<gEngine, gPkg, gLine, kind, at, hits, ev, evStamp, bef, aft,
                 made, touched, heldEver, navs, wrong, overtook, clock, page,
                 gateEver, gWin>>

\* How the engine reacts to an end from outside.
EndAsked ==
  CASE phase = "off" ->
         /\ phase' = "empty" /\ mode' = "none"
         /\ UNCHANGED <<goal, kept, tlAtPause>>
    [] phase \in {"recording", "paused"} -> BeginWrap("save")
    [] phase = "wrap" ->
         /\ goal' = (IF goal \in {"clear", "quit"} THEN "quit" ELSE "save")
         /\ UNCHANGED <<phase, mode, kept, tlAtPause>>
    [] OTHER -> UNCHANGED <<phase, goal, mode, kept, tlAtPause>>

\* The person closes the last page, or the browser disappears.
PageCloses ==
  /\ Alive /\ page = "open" /\ Told
  /\ page' = "closed" /\ navFlying' = FALSE /\ gateOn' = FALSE /\ gateMsg' = "none"
  /\ at' = [j \in Inputs |-> IF Pending(j) THEN "gone" ELSE at[j]]
  /\ left' = [j \in Inputs |-> left[j] \/ (at[j] = "page" /\ aft[j] = 0)]
  /\ ev' = [j \in Inputs |-> IF ev[j] = "flying" THEN "lost" ELSE ev[j]]
  /\ EndAsked
  /\ tb' = (IF Surfaces THEN "gone" ELSE tb)
  /\ tbAsk' = FALSE /\ tbPush' = "none" /\ tbReply' = "none"
  /\ UNCHANGED <<gen, tracing, stops, gPkg, tl, dis, kind, hits, evStamp, bef,
                 aft, made, touched, heldEver, navs, wrong, overtook, clock,
                 doc, gateEver, gWin>>

\* Ctrl+C in the terminal.
TerminalStop ==
  /\ Alive /\ stops = 0 /\ Told
  /\ stops' = 1
  /\ EndAsked
  /\ gateMsg' = (IF phase \in {"recording", "paused"} THEN SendGate(FALSE)
                 ELSE IF phase = "off" THEN "none" ELSE gateMsg)
  /\ UNCHANGED <<gen, tracing, gPkg, tl, dis, gIn, page, doc, navFlying, gateOn,
                 gateEver, gTb, gWin>>

\* Ctrl+C a second time, while the recorder is still closing down.
TerminalStopAgain ==
  /\ Alive /\ stops = 1 /\ ~IgnoreSecondStop
  /\ stops' = 2
  /\ phase' = "dead" /\ mode' = "none" /\ gateMsg' = "none"
  /\ UNCHANGED <<goal, gen, tracing, gPkg, gLine, gIn, page, doc, navFlying,
                 gateOn, gateEver, gTb, gWin>>

-----------------------------------------------------------------------------
\* Wrapping up and saving

WrapUpDone ==
  /\ phase = "wrap" /\ Told
  /\ WaitGate => (page = "closed" \/ (gateMsg = "none" /\ ~gateOn))
  /\ WaitHeld => ~AnyPending
  /\ WaitReports => \A i \in Inputs : ev[i] # "flying"
  /\ LET snap == page = "open" /\ goal \in {"pause", "save"}
                 /\ \E j \in Inputs : Waiting(j)
     IN /\ clock' = (IF snap THEN clock + 1 ELSE clock)
        /\ aft' = [j \in Inputs |-> IF snap /\ Waiting(j) THEN clock + 1 ELSE aft[j]]
  /\ goal' = "none"
  /\ CASE goal = "pause" ->
            /\ phase' = "paused" /\ tlAtPause' = tl
            /\ mode' = (IF RecorderOff THEN "none" ELSE mode)
            /\ UNCHANGED <<tl, dis, kept, gen, tracing, gateMsg>>
       [] goal = "save" ->
            /\ phase' = "saving"
            /\ mode' = (IF RecorderOff THEN "none" ELSE mode)
            /\ UNCHANGED <<tl, tlAtPause, dis, kept, gen, tracing, gateMsg>>
       [] goal = "clear" ->
            /\ phase' = "off" /\ tl' = {} /\ dis' = {} /\ kept' = {}
            /\ gen' = gen + 1 /\ tracing' = "off"
            /\ mode' = (IF RecorderOff THEN "none" ELSE mode)
            /\ UNCHANGED <<tlAtPause, gateMsg>>
       [] OTHER -> \* quit: cleared, then ended from outside
            /\ phase' = "empty" /\ tl' = {} /\ dis' = {} /\ kept' = {}
            /\ gen' = gen + 1 /\ tracing' = "off"
            /\ mode' = "none" /\ gateMsg' = "none"
            /\ UNCHANGED tlAtPause
  /\ UNCHANGED <<stops, gPkg, kind, at, hits, ev, evStamp, bef, left, made,
                 touched, heldEver, navs, wrong, overtook, page, doc, navFlying,
                 gateOn, gateEver, gTb, gWin>>

StartWriting ==
  /\ phase = "saving" /\ pkg = "none"
  /\ pkg' = "writing" /\ saves' = saves + 1
  /\ pkgHas' = tl /\ pkgDis' = dis /\ tracing' = "kept"
  /\ UNCHANGED <<phase, goal, gen, mode, stops, finishAgain, gLine, gIn, gPage, gTb, gWin>>

SaveDone ==
  /\ phase = "saving" /\ pkg = "writing" /\ Told
  /\ pkg' = "complete" /\ phase' = "saved"
  /\ mode' = "none" /\ gateMsg' = "none"
  /\ UNCHANGED <<goal, gen, tracing, stops, saves, pkgHas, pkgDis, finishAgain,
                 gLine, gIn, page, doc, navFlying, gateOn, gateEver, gTb, gWin>>

-----------------------------------------------------------------------------
\* The toolbar and the window (only when Surfaces)

EngineTells ==
  /\ Surfaces /\ phase # "dead" /\ told # View
  /\ told' = View /\ winBehind' = TRUE
  /\ tbPush' = (IF page = "open" THEN View ELSE "none")
  /\ UNCHANGED <<gEngine, gPkg, gLine, gIn, gPage, tb, tbReply, tbAsk, win>>

PushLands ==
  /\ Surfaces /\ page = "open" /\ tbPush # "none"
  /\ tb' = tbPush /\ tbPush' = "none"
  /\ UNCHANGED <<gEngine, gPkg, gLine, gIn, gPage, tbReply, tbAsk, gWin>>

\* A freshly loaded document asks for the state once.
EngineReplies ==
  /\ Surfaces /\ Alive /\ tbAsk
  /\ tbAsk' = FALSE /\ tbReply' = View
  /\ UNCHANGED <<gEngine, gPkg, gLine, gIn, gPage, tb, tbPush, gWin>>

ReplyLands ==
  /\ Surfaces /\ page = "open" /\ tbReply # "none"
  /\ tb' = (IF Revisions /\ tbReply # View THEN tb ELSE tbReply)
  /\ tbReply' = "none"
  /\ UNCHANGED <<gEngine, gPkg, gLine, gIn, gPage, tbPush, tbAsk, gWin>>

\* The window has one ordered stream that starts with the full state.
WindowCatchesUp ==
  /\ Surfaces /\ winBehind
  /\ win' = told /\ winBehind' = FALSE
  /\ UNCHANGED <<gEngine, gPkg, gLine, gIn, gPage, gTb, told>>

YouReloadWindow ==
  /\ Surfaces /\ Alive /\ win # "loading"
  /\ win' = "loading" /\ winBehind' = TRUE
  /\ UNCHANGED <<gEngine, gPkg, gLine, gIn, gPage, gTb, told>>

\* The recorder has ended. Nothing more happens on its side.
Ended == ~Alive /\ UNCHANGED vars

-----------------------------------------------------------------------------
Next ==
  \/ YouPressRecord \/ YouPressStop \/ YouPressContinue \/ YouPressFinish
  \/ YouPressFinishAgain \/ YouPressClear \/ YouPressAssert
  \/ \E i \in Inputs : YouDiscard(i)
  \/ \E i \in Inputs : YouRestore(i)
  \/ \E i \in Inputs : YouClick(i)
  \/ \E i \in Inputs : YouType(i)
  \/ \E i \in Inputs : TakeBefore(i)
  \/ \E i \in Inputs : Resend(i)
  \/ \E i \in Inputs : TakeAfter(i)
  \/ \E i \in Inputs : ReportArrives(i)
  \/ GateMsgLands \/ NavCommits \/ PageCloses \/ TerminalStop \/ TerminalStopAgain
  \/ WrapUpDone \/ StartWriting \/ SaveDone
  \/ EngineTells \/ PushLands \/ EngineReplies \/ ReplyLands
  \/ WindowCatchesUp \/ YouReloadWindow
  \/ Ended

\* Steps that need nobody to press anything.
OnItsOwn ==
  \/ \E i \in Inputs : TakeBefore(i)
  \/ \E i \in Inputs : Resend(i)
  \/ \E i \in Inputs : ReportArrives(i)
  \/ GateMsgLands \/ WrapUpDone \/ StartWriting \/ SaveDone \/ EngineTells

-----------------------------------------------------------------------------
\* The ten rules

\* 1. A click the recorder holds back always reaches the page, exactly once.
R01_HeldClickReachesThePageOnce ==
  /\ \A i \in Inputs : hits[i] <= 1
  /\ \A i \in Inputs : ~(heldEver[i] /\ at[i] = "picked")
  /\ ~Alive => ~AnyPending

\* 2. Every recorded interaction gets one "before" and one "after".
\*    An interaction that leaves the page keeps its "before" only.
R02_OneBeforeOneAfter ==
  pkg # "none" => \A i \in pkgHas : bef[i] # 0 /\ (aft[i] # 0 \/ left[i])

\* 3. While stopped: clicks reach the page untouched, nothing is added,
\*    tracing keeps running.
R03a_StoppedClicksAreUntouched ==
  \A i \in Inputs : made[i].phase \in {"paused", "off"} => ~touched[i]
R03b_StoppedAddsNothing ==
  /\ phase = "paused" => tl = tlAtPause
  /\ \A i \in tl : made[i].phase \notin {"paused", "off"}
R03c_TracingRunsThroughPause ==
  phase = "paused" => tracing = "on"

\* 4. Finish saves everything recorded up to that moment.
R04_FinishSavesEverything ==
  pkg # "none" =>
    \A i \in Inputs :
      (made[i].phase = "recording" /\ made[i].gen = gen
         /\ at[i] \in {"page", "picked"} /\ ev[i] # "lost") => i \in pkgHas

\* 5. Clear leaves no entry and no discard decision behind.
R05_ClearLeavesNothing ==
  /\ \A i \in tl : made[i].gen = gen
  /\ dis \subseteq tl
  /\ phase = "off" => (tl = {} /\ dis = {} /\ tracing = "off")

\* 6. Discard and restore work only while paused, and survive Continue.
R06_ReviewOnlyWhilePaused ==
  /\ phase # "paused" => dis = kept
  /\ pkg # "none" => pkgDis = kept

\* 7. An assertion never carries changes.
R07_AssertionCarriesNoChanges ==
  \A i \in tl : at[i] = "picked" =>
    /\ bef[i] = aft[i]
    /\ \A j \in tl : (j < i /\ made[j].doc = made[i].doc /\ aft[j] # 0)
                        => aft[j] <= bef[i]

\* 8. The window, the toolbar and the engine end up showing the same state.
Quiet == told = View /\ tbPush = "none" /\ tbReply = "none" /\ ~tbAsk /\ ~winBehind
R08_SurfacesAgree ==
  (Surfaces /\ phase # "dead" /\ Quiet) =>
     (win = View /\ (page = "open" => tb = View))

\* 9. An end from outside gives a complete package or a clear "empty".
R09_NeverHalfWritten ==
  /\ phase = "saved" => pkg = "complete"
  /\ phase = "empty" => pkg = "none"
  /\ phase = "dead" => pkg # "writing"

\* 10. Pressing Finish twice saves once.
R10_SavesOnce == saves <= 1

\* Not among the ten, but the design needs them.

\* What you do reaches the page in the order you did it.
X1_NothingOvertakesAHeldClick == ~overtook

\* Along the timeline, each "after" is no later than the next "before".
X2_SnapshotsInTimeOrder ==
  \A i \in tl : \A j \in tl :
    (i < j /\ made[i].doc = made[j].doc /\ aft[i] # 0 /\ bef[j] # 0)
       => aft[i] <= bef[j]

\* A report for something you did while recording is never thrown away.
X3_NothingYouDidIsDropped ==
  \A i \in Inputs :
    (ev[i] = "in" /\ made[i].phase = "recording" /\ made[i].gen = gen)
       => (i \in tl \/ i \in pkgHas)

\* Wrapping up and saving never wait for something that cannot come.
X4_WrapUpNeverGetsStuck ==
  phase \in {"wrap", "saving"} => ENABLED OnItsOwn

\* A held click lands on the document it was made on (an open question).
Q1_ClickLandsWhereItWasMade == \A i \in Inputs : ~wrong[i]

-----------------------------------------------------------------------------
-----------------------------------------------------------------------------
\* Progress, checked with fairness: steps that need nobody keep happening.
Fair ==
  /\ WF_vars(\E i \in Inputs : TakeBefore(i))
  /\ WF_vars(\E i \in Inputs : Resend(i))
  /\ WF_vars(\E i \in Inputs : ReportArrives(i))
  /\ WF_vars(GateMsgLands) /\ WF_vars(WrapUpDone)
  /\ WF_vars(StartWriting) /\ WF_vars(SaveDone) /\ WF_vars(EngineTells)
LiveSpec == Init /\ [][Next]_vars /\ Fair

\* A held click is always passed on (or its page goes away).
L1_HeldClickIsPassedOn ==
  \A i \in Inputs : Pending(i) ~> ~Pending(i)
\* Wrapping up and saving always come to an end.
L2_WrapUpEnds ==
  (phase \in {"wrap", "saving"}) ~> (phase \notin {"wrap", "saving"})

-----------------------------------------------------------------------------
\* Probes: each must BREAK, which shows the model can reach that situation.
P1_NeverSavesTwoEntries == ~(pkg = "complete" /\ Cardinality(pkgHas) = 2)
P2_NeverSavesADiscard == ~(pkg = "complete" /\ pkgDis # {})
P3_NeverRecordsAnAssertionAfterAClick ==
  ~(\E i \in tl : \E j \in tl : j < i /\ at[i] = "picked" /\ heldEver[j] /\ aft[j] # 0)
P4_NeverRecordsANavigation == ~(\E i \in pkgHas : left[i] /\ doc = 2 /\ pkg = "complete")
P5_NeverCutsASettleShort ==
  ~(\E i \in tl : \E j \in tl : i < j /\ aft[i] # 0 /\ aft[i] = bef[j] /\ heldEver[i])
P6_NeverClearsThenRecordsAgain == ~(gen = 1 /\ tl # {})
P7_NeverHoldsAClickDuringWrapUp == ~(phase = "wrap" /\ AnyPending)
P8_NeverEndsEmptyAfterRecording == ~(phase = "empty" /\ gen = 1)
P9_NeverSavesWithPageClosed == ~(pkg = "complete" /\ page = "closed" /\ pkgHas # {})

-----------------------------------------------------------------------------
\* Narrower versions of rules, to get the most everyday path to a break.
\* A held click, then typing while the page still settles.
T1_ClickThenTypingInTimeOrder ==
  \A i \in tl : \A j \in tl :
    (i < j /\ heldEver[i] /\ kind[j] = "type" /\ aft[i] # 0 /\ bef[j] # 0)
       => aft[i] <= bef[j]
\* A held click, then an assertion while the page still settles.
T2_ClickThenAssertionInTimeOrder ==
  \A i \in tl : \A j \in tl :
    (i < j /\ heldEver[i] /\ ~heldEver[j] /\ at[j] = "picked" /\ aft[i] # 0)
       => aft[i] <= bef[j]
\* Finish with a click still held, or with the gate still on.
T3_NoClickStuckAfterSaving == ~(phase = "saved" /\ AnyPending)

-----------------------------------------------------------------------------
\* Smaller step sets, only for drawing the two charts.

PickClick(i) == mode = "pick" /\ YouClick(i)

LifeNext ==
  \/ YouPressRecord \/ YouPressStop \/ YouPressContinue \/ YouPressFinish
  \/ YouPressClear \/ YouPressAssert
  \/ \E i \in Inputs : PickClick(i)
  \/ \E i \in Inputs : ReportArrives(i)
  \/ GateMsgLands \/ PageCloses \/ TerminalStop
  \/ WrapUpDone \/ StartWriting \/ SaveDone
  \/ Ended

GateInit ==
  /\ phase = "recording" /\ goal = "none" /\ gen = 0 /\ tracing = "on"
  /\ mode = "rec" /\ stops = 0
  /\ pkg = "none" /\ saves = 0 /\ pkgHas = {} /\ pkgDis = {} /\ finishAgain = FALSE
  /\ tl = {} /\ tlAtPause = {} /\ dis = {} /\ kept = {}
  /\ kind = [i \in Inputs |-> "none"]
  /\ at = [i \in Inputs |-> "notyet"]
  /\ hits = [i \in Inputs |-> 0]
  /\ ev = [i \in Inputs |-> "none"]
  /\ evStamp = [i \in Inputs |-> 0]
  /\ bef = [i \in Inputs |-> 0]
  /\ aft = [i \in Inputs |-> 0]
  /\ left = [i \in Inputs |-> FALSE]
  /\ made = [i \in Inputs |-> [phase |-> "none", gen |-> 0, doc |-> 0]]
  /\ touched = [i \in Inputs |-> FALSE]
  /\ heldEver = [i \in Inputs |-> FALSE]
  /\ navs = [i \in Inputs |-> FALSE]
  /\ wrong = [i \in Inputs |-> FALSE]
  /\ overtook = FALSE /\ clock = 1
  /\ page = "open" /\ doc = 1 /\ navFlying = FALSE
  /\ gateOn = TRUE /\ gateMsg = "none" /\ gateEver = TRUE
  /\ tb = "off" /\ tbPush = "none" /\ tbReply = "none" /\ tbAsk = FALSE
  /\ win = "off" /\ winBehind = FALSE /\ told = "off"

PageClosesWhileHeld == AnyPending /\ PageCloses

GateNext ==
  \/ \E i \in Inputs : YouClick(i)
  \/ \E i \in Inputs : TakeBefore(i)
  \/ \E i \in Inputs : Resend(i)
  \/ \E i \in Inputs : TakeAfter(i)
  \/ \E i \in Inputs : ReportArrives(i)
  \/ NavCommits \/ PageClosesWhileHeld

=============================================================================
