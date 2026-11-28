#!/bin/sh
# Writes every .cfg from one table. Run it after changing the table.
# Constants, in order:
#   N MaxDoc MaxGen MaxRounds MaxKeys MaxStops Closes Surfaces TimeLimit FinishTwice Quick
#   LateRevisions LeaveOutB2 LateTypingReport, then after what to check, when
#   not the defaults: SlowFlush SlowPickEnd Buttons SlowHeldMessage StartBlank ActOnBlank ContinueOnBlank PageNavigates NavAfterReports TypeAfterStopOnNewPage ReadHeardLate SameFieldElsewhere AddressChanges StartFails ReadsTimeOut
# LeaveOutB2 leaves a known limit out, to check every other path of the same
# rule; it is not a fix. LateRevisions, LateTypingReport, SlowFlush,
# SlowPickEnd and SlowHeldMessage allow five races. Buttons is what the person
# clicks with: left and right unless a config says otherwise; a middle click
# acts as a right-click, apart from its button, and has configs of its own,
# as have clicks on a checkbox, which Playwright reports as a check. Deadlock is not
# checked: a state where nothing is left to do is often a bound of the model
# (no more Record). X4 checks that a wrap-up ends.
cd "$(dirname "$0")" || exit 2
# The rules that hold at a person's speed. The rules that break are checked
# in configs of their own (Limit-*, Race-*), one shortest path each, so that a
# break does not cut the other rules' runs short (the statechart tool bounds
# every run after the first break).
HOLD="R01_HeldClickReachesThePageOnce R02_OneBeforeOneAfter R03a_StoppedClicksAreUntouched R03b_StoppedAddsNothing R03c_TracingRunsThroughPause R04_FinishSavesEverything R05_ClearLeavesNothing R06_ReviewUntilFinishOrClear R07_AssertionCarriesNoChanges R09_NeverHalfWritten R10_SavesOnce X1_NothingOvertakesAHeldClick X3_NothingYouDidIsDropped X6_TypingWrittenWhole X7_EntryHasItsOwnReport S1_StorageSavedOnceTheTraceIsOver S3_EveryEndSavesTheStorage S4_NoStorageWithoutTheFlag"
FILLS="F1_ShowsOnceItHasItsPlace F2_StaysInPlace F3_NextActionMakesItFinal F4_StopAndFinishKeepLastText F5_ClearRemovesForGood F6_WindowIsWhatIsSaved"
# The rules over a step: F3's, that decisions change only by a press,
# and that saving the storage state adds nothing to the recording.
PROPS="PROPERTIES F3_FinalKeepsItsChanges R06_DecisionsChangeOnlyByAPress S2_StorageSaveAddsNothing"
ALLB='{"left", "right", "middle"}'
LR='{"left", "right"}'
LEFT='{"left"}'
BOX='{"left", "middleOnCheckbox"}'
MIX='{"left", "right", "middle", "leftOnCheckbox", "middleOnCheckbox"}'
RULES="$HOLD X2_SnapshotsInTimeOrder X8_StartsNoLaterThanTheInput X4_WrapUpNeverGetsStuck X5_StopWindowIsRecorded"
PROBES="P1_NeverSavesTwoEntries P3_NeverRecordsAnAssertionAfterAClick P4_NeverRecordsANavigation P5_NeverCutsASettleShort P7_NeverHoldsAClickDuringWrapUp P9_NeverSavesWithPageClosed P10_NeverHoldsTyping P11_NeverWritesRevisedTyping P12_NeverWritesTypingWhileRecording P13_NeverEndsTypingAtAClick P14_NeverPausesWithTypingWritten"
WPROBES="P15_NeverTextAheadOfRows P16_NeverStopsWithTextAhead P17_NeverFinishesWithTextAhead P18_NeverClearsALiveFill P20_NeverShowsTextOnly P21_NeverWaitsToShow"
# The configs with --save-storage given (SaveStorage), which check the
# storage save at the end; every other one ends as with no such step. And
# those in which the package cannot be written (WriteFails).
SAVES=" Rules-Ends Rules-StartRecording Surfaces TimeLimit-Holds Races Probes-Storage "
WRITEFAILS=" Rules-Ends Probes-Storage "
mk() { # name "INIT/NEXT or SPECIFICATION" N MaxDoc MaxGen MaxRounds MaxKeys MaxStops Closes Surfaces TimeLimit FinishTwice Quick LateRevisions LeaveOutB2 LateTypingReport "what to check" [SlowFlush SlowPickEnd Buttons SlowHeldMessage StartBlank ActOnBlank ContinueOnBlank PageNavigates NavAfterReports TypeAfterStopOnNewPage ReadHeardLate SameFieldElsewhere AddressChanges StartFails ReadsTimeOut]
  name=$1; head=$2; shift 2
  laterev=${12}; lob2=${13}; latetype=${14}; what=${15}
  slowflush=${16:-FALSE}; slowpick=${17:-FALSE}; buttons=${18:-$LR}; slowheld=${19:-FALSE}; startblank=${20:-FALSE}; actonblank=${21:-FALSE}; continueonblank=${22:-FALSE}; pagenavigates=${23:-FALSE}; navafterreports=${24:-TRUE}; typeafterstop=${25:-TRUE}; readlate=${26:-FALSE}; samefield=${27:-FALSE}; addrchanges=${28:-FALSE}; startfails=${29:-FALSE}; readstimeout=${30:-FALSE}
  case $SAVES in *" $name "*) savestorage=TRUE ;; *) savestorage=FALSE ;; esac
  case $WRITEFAILS in *" $name "*) writefails=TRUE ;; *) writefails=FALSE ;; esac
  {
    printf '%s\n' "$head"
    cat <<CFG
CONSTANTS
  N = $1
  MaxDoc = $2
  MaxGen = $3
  MaxRounds = $4
  MaxKeys = $5
  MaxStops = $6
  Closes = $7
  Surfaces = $8
  TimeLimit = $9
  FinishTwice = ${10}
  Quick = ${11}
  LateRevisions = $laterev
  LeaveOutB2 = $lob2
  LateTypingReport = $latetype
  SlowFlush = $slowflush
  SlowPickEnd = $slowpick
  SlowHeldMessage = $slowheld
  StartBlank = $startblank
  ActOnBlank = $actonblank
  ContinueOnBlank = $continueonblank
  PageNavigates = $pagenavigates
  NavAfterReports = $navafterreports
  TypeAfterStopOnNewPage = $typeafterstop
  ReadHeardLate = $readlate
  SameFieldElsewhere = $samefield
  AddressChanges = $addrchanges
  StartFails = $startfails
  ReadsTimeOut = $readstimeout
  SaveStorage = $savestorage
  WriteFails = $writefails
  Buttons = $buttons
CHECK_DEADLOCK FALSE
CFG
    printf '%s\n' "$what"
  } > "$name.cfg" || exit 2
}
IN="INIT Init
NEXT Next"
T=TRUE; F=FALSE
#  name             head  N Doc Gen Rnd Keys Stops Closes Surf Time Twice Quick LateRev B2 LateType
mk Rules            "$IN" 2 1   1   1   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS $HOLD $FILLS X5_StopWindowIsRecorded D1_TypingWaitsForSomethingNewer
$PROPS"
mk Rules-Pages      "$IN" 2 2   1   1   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS $HOLD $FILLS X5_StopWindowIsRecorded
$PROPS"
mk Rules-Rounds     "$IN" 2 1   1   2   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS $HOLD $FILLS X5_StopWindowIsRecorded
$PROPS"
# Rules-Ends also has a Record that cannot start (StartFails).
mk Rules-Ends       "$IN" 2 1   1   1   1    2     $T     $F   $F   $T    $T    $F      $F $F "INVARIANTS $HOLD $FILLS F7_MeasuredFromFirstKey
$PROPS" $F $F "$LR" $F $F $F $F $F $T $T $F $F $F $T
mk Surfaces         "$IN" 1 1   1   2   1    0     $F     $T   $F   $F    $T    $F      $F $F "INVARIANTS R08_SurfacesAgree $HOLD $FILLS X5_StopWindowIsRecorded" $F $F "$LEFT"
mk TimeLimit        "$IN" 2 1   1   1   1    0     $F     $F   $T   $F    $T    $F      $F $F "INVARIANTS $RULES $FILLS
$PROPS"
# The rules TimeLimit cannot check past the tool's bound after its first break.
mk TimeLimit-Holds  "$IN" 2 1   1   1   1    0     $F     $F   $T   $F    $T    $F      $F $F "INVARIANTS R01_HeldClickReachesThePageOnce R02_OneBeforeOneAfter R03b_StoppedAddsNothing R03c_TracingRunsThroughPause R05_ClearLeavesNothing R06_ReviewUntilFinishOrClear R07_AssertionCarriesNoChanges R09_NeverHalfWritten R10_SavesOnce X6_TypingWrittenWhole X7_EntryHasItsOwnReport X4_WrapUpNeverGetsStuck S1_StorageSavedOnceTheTraceIsOver S3_EveryEndSavesTheStorage $FILLS
$PROPS"
# Rules 7 and 12: rule 7 with its exception for the known limit B2; without
# it; and with B2 left out.
mk Rule7            "$IN" 2 1   1   1   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT F7_MeasuredFromFirstKey"
mk Rule7-Strict     "$IN" 2 1   1   1   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT F7s_MeasuredStrictly"
# Rule 3 where the next click's press moved the focus: its focus rows go
# from the fill to the click once it is written (TL pressedAfter).
mk Fold-AfterStep   "$IN" 2 1   1   1   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS F3_NextActionMakesItFinal F6_WindowIsWhatIsSaved
$PROPS"
# codegen --start-recording: the page opens blank, Record is the first step,
# and the page goes to its address once the pages hold inputs back. The
# person acts on the page once it is at its address, and presses Continue
# once it is there; acting on the blank page, and Continue while it is still
# blank, have configs of their own.
mk Rules-StartRecording "$IN" 2 2 1  2   1    1     $T     $F   $F   $F    $T    $F      $F $F "INVARIANTS $HOLD $FILLS
$PROPS" $F $F "$LR" $F $T
mk Rule7-StartRecording "$IN" 2 2 1  1   1    1     $T     $F   $F   $F    $T    $F      $F $F "INVARIANT F7_MeasuredFromFirstKey" $F $F "$LR" $F $T
mk Path-StartRecording-Stop "$IN" 2 2 1 1 1   1     $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS X4_WrapUpNeverGetsStuck X5_StopWindowIsRecorded N1_AfterStopInTimeOrder X2_SnapshotsInTimeOrder X8_StartsNoLaterThanTheInput F7_MeasuredFromFirstKey" $F $F "$LR" $F $T
mk Path-StartRecording-BlankPage "$IN" 2 2 1 1 1 1   $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS X3v_NothingDroppedOffTheBlankPage R04v_FinishSavesAllOffTheBlankPage F1v_ShowsOffTheBlankPage" $F $F "$LR" $F $T $T
# Known limit: a click on the blank page, or an element picked there, is not
# recorded.
mk Limit-BlankPageInput "$IN" 2 2 1 1 0    1     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS X3_NothingYouDidIsDropped R04_FinishSavesEverything F1_ShowsOnceItHasItsPlace" $F $F "$LR" $F $T $T
mk Path-StartRecording-Continue "$IN" 2 2 1 2 1 0    $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS F1_ShowsOnceItHasItsPlace X3_NothingYouDidIsDropped R04_FinishSavesEverything" $F $F "$LR" $F $T $F $T
# Rule 7 and 12 after Continue: typing right after picking an element, before
# the recorder has read the page for it (12c8bf83).
mk Rule7-AssertThenType "$IN" 2 1 1  2   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS F7_MeasuredFromFirstKey X12a_AssertionReadsInTimeOrder"
# A navigation no held input made (the browser's Back button, a redirect),
# then typing in the new document; B2 left out.
mk Path-NavigationThenType "$IN" 2 2 1 1 1  0     $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS X10_FillStartsInItsDocument F1_ShowsOnceItHasItsPlace F6_WindowIsWhatIsSaved" $F $F "$LR" $F $F $F $F $T $T
# A read taken before a navigation and heard after it (5ecea373).
mk Path-ReadAcrossNavigation "$IN" 2 2 1 1 0 0   $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS X11_LatestReadIsOfThisDocument X10_FillStartsInItsDocument" $F $F "$LR" $F $F $F $F $T $T $T $T
# An input whose read a navigation overtook (5ecea373): kept, with that read,
# in the Visit of the page it was done in (0b1e6b9f).
mk Input-ReadAcrossNavigation "$IN" 2 2 1 1 0 0  $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS X3_NothingYouDidIsDropped R04_FinishSavesEverything" $F $F "$LR" $F $F $F $F $T $T $T $T
# Typing after a navigation that Playwright reports as a revision of the last
# fill: a fill of its own in the new document (8d1c4656).
mk Path-TypingAfterNavigation "$IN" 2 2 1 1 1 1  $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS X10_FillStartsInItsDocument F4n_KeyElsewhereIsNotTheFillsText X3_NothingYouDidIsDropped $FILLS
$PROPS" $F $F "$LR" $F $F $F $F $T $T $T $F $T
# Typing while the page changes its address within its document: the fill
# goes on (b2af1120).
mk Path-AddressChangeWhileTyping "$IN" 1 1 1 1 1 0 $F    $F   $F   $F    $T    $F      $F $F "INVARIANTS $FILLS F7_MeasuredFromFirstKey
$PROPS" $F $F "$LR" $F $F $F $F $F $T $T $F $F $T
# The same, with a navigation that commits before the report of a key typed
# in the document it leaves.
mk Race-NavigationBeforeTypingReport "$IN" 2 2 1 1 0 0 $F  $F   $F   $F    $T    $F      $T $F "INVARIANT X10_FillStartsInItsDocument" $F $F "$LR" $F $F $F $F $T $F
mk Rule7-Navigation "$IN" 2 2   1   1   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT F7_MeasuredFromFirstKey" $F $F "$LR" $F $F $F $F $F $T $F
# Rule 7 when you type in a page the recorder has not read yet, after Stop
# and before "Paused", with the pages no longer holding.
mk Rule7-TypeAfterStopOnNewPage "$IN" 2 2 1 1 1 0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT F7_MeasuredFromFirstKey"
mk Rules-WithoutB2  "$IN" 2 1   1   1   1    0     $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS F7s_MeasuredStrictly X2_SnapshotsInTimeOrder X8_StartsNoLaterThanTheInput X4_WrapUpNeverGetsStuck X5_StopWindowIsRecorded"
# A read that held inputs, the wrap-up or a Continue wait for may not be
# answered in its time (#1525): the held input goes on from the page's latest
# read, or a lost one, and an "after" is given up.
mk Rules-ReadsTimeOut "$IN" 2 1  1   1   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS $HOLD $FILLS X5_StopWindowIsRecorded D1_TypingWaitsForSomethingNewer
$PROPS" $F $F "$LR" $F $F $F $F $F $T $T $F $F $F $F $T
mk Rules-Pages-ReadsTimeOut "$IN" 2 2 1 1  1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS $HOLD $FILLS X5_StopWindowIsRecorded
$PROPS" $F $F "$LR" $F $F $F $F $F $T $T $F $F $F $F $T
mk Rules-WithoutB2-ReadsTimeOut "$IN" 2 1 1 1 1  0     $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS F7s_MeasuredStrictly X2_SnapshotsInTimeOrder X8_StartsNoLaterThanTheInput X4_WrapUpNeverGetsStuck X5_StopWindowIsRecorded" $F $F "$LR" $F $F $F $F $F $T $T $F $F $F $F $T
# Known limits: each its own path.
mk Limit-TypingThenTyping "$IN" 2 1 1 1  0    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS N3_TypingThenTypingInTimeOrder N5_RecordingInTimeOrder N6_RecordingStartsInTime"
mk Limit-ClosedPageWaits "$IN" 1 1 1 1   0    0     $T     $F   $F   $F    $T    $F      $F $F "INVARIANT X4_WrapUpNeverGetsStuck"
# Paths the engine once broke: each must hold.
mk Path-AfterStop   "$IN" 2 1   1   1   0    0     $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS N1_AfterStopInTimeOrder N1b_AfterStopBothInTimeOrder N2_AfterStopStartsInTime"
mk Path-StopClickCtrlC "$IN" 2 1 1   1   0    1     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT X5_StopWindowIsRecorded"
mk Path-HeldKeyAfterStop "$IN" 2 1 1 1   0    1     $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS N1_AfterStopInTimeOrder X5_StopWindowIsRecorded"
mk Path-PickOnNewPage "$IN" 2 2  1   1   0    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT X4_WrapUpNeverGetsStuck"
mk Path-PickOnNewPage-NextClick "$IN" 3 2 1 1 0 0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT X7_EntryHasItsOwnReport" $F $F "$LEFT"
mk Path-TypingAfterContinue "$IN" 1 1 1 2  1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS X6_TypingWrittenWhole F4_StopAndFinishKeepLastText"
# Races: actions within a few milliseconds.
mk Races            "$IN" 1 1   1   2   0    1     $T     $F   $F   $F    $F    $F      $F $F "INVARIANTS $RULES"
mk Race-LateRevision "$IN" 2 1  1   1   1    0     $F     $F   $F   $F    $T    $T      $F $F "INVARIANTS $HOLD $FILLS
$PROPS"
mk Race-LateRevision-Stop "$IN" 2 1 1 1   1    0     $F     $F   $F   $F    $T    $T      $F $F "INVARIANT F7_MeasuredFromFirstKey"
mk Race-LateTypingReport "$IN" 2 1 1 1   0    1     $F     $F   $F   $F    $T    $F      $T $T "INVARIANTS N1_AfterStopInTimeOrder X5_StopWindowIsRecorded"
mk Race-LastText    "$IN" 1 1   1   1   1    1     $T     $F   $F   $F    $F    $F      $F $F "INVARIANT F4_StopAndFinishKeepLastText"
mk Race-ClickLostAfterStop "$IN" 2 1 1 1  0    1     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT X5_StopWindowIsRecorded" $T $F "$LEFT"
mk Race-ClickAfterPicking "$IN" 1 1 1 1   0    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT X3_NothingYouDidIsDropped" $F $T "$LEFT"
mk Race-HeldMessageAfterStop "$IN" 2 1 1 1 0  0     $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS N1_AfterStopInTimeOrder X2_SnapshotsInTimeOrder X5_StopWindowIsRecorded X3_NothingYouDidIsDropped X1_NothingOvertakesAHeldClick" $F $F "$LEFT" $T
# Middle clicks: held and matched by their button, as right-clicks.
mk Clicks-Middle    "$IN" 2 1   1   1   0    1     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS X7_EntryHasItsOwnReport X1_NothingOvertakesAHeldClick X3_NothingYouDidIsDropped X5_StopWindowIsRecorded R04_FinishSavesEverything" $F $F "$ALLB"
mk Clicks-Middle-Fill "$IN" 2 1 1   1   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS F7_MeasuredFromFirstKey $FILLS
$PROPS" $F $F "$ALLB"
# A middle click on a checkbox: Playwright reports a check, with no button.
mk Clicks-MiddleOnCheckbox "$IN" 2 1 1 1  0    1     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS X3_NothingYouDidIsDropped X4_WrapUpNeverGetsStuck X7_EntryHasItsOwnReport X5_StopWindowIsRecorded R04_FinishSavesEverything" $F $F "$BOX"
# Left, right and middle clicks, on checkboxes and not, mixed; B2 left out.
mk Clicks-Mixed     "$IN" 2 1   1   1   0    1     $F     $F   $F   $F    $T    $F      $T $F "INVARIANTS $RULES" $F $F "$MIX"
# Progress with fairness: blocked, TLC checks it too slowly (see README).
mk Progress         "SPECIFICATION LiveSpec" 1 1 1 1 0 0 $T $F $T $F $T $F $F $F "PROPERTIES L1_HeldClickIsPassedOn L2_WrapUpEnds"
# Probes: each must break, which shows the model reaches that situation.
mk Probes           "$IN" 2 2   1   1   1    0     $T     $F   $F   $F    $T    $F      $F $F "INVARIANTS $PROBES"
# P2's path is longer than the statechart tool's bound after a first break.
mk Probes-Discard   "$IN" 2 2   1   1   1    0     $T     $F   $F   $F    $T    $F      $F $F "INVARIANTS P2_NeverSavesADiscard P24_NeverDiscardsWhileRecording P25_NeverTypesOnInADiscardedFill"
mk Probes-Clear     "$IN" 1 1   1   2   0    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS P6_NeverClearsThenRecordsAgain P8_NeverEndsEmptyAfterRecording"
mk Probes-Window    "$IN" 2 1   1   1   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANTS $WPROBES"
mk Probes-Window-Navigation "$IN" 2 2 1 1 1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT P19_NeverNavigatesUnderALiveFill"
mk Probes-Continue  "$IN" 1 1   1   2   1    0     $F     $F   $F   $F    $T    $F      $F $F "INVARIANT P22_NeverStartsAFillFromARevision"
mk Probes-LateRevision "$IN" 2 1 1   1   1    0     $F     $F   $F   $F    $T    $T      $F $F "INVARIANT P23_NeverSetsAFinalFillsText"
# --save-storage: the save is reached with nothing recorded, with a package,
# and fails.
mk Probes-Storage   "$IN" 1 1   1   1   0    1     $T     $F   $F   $F    $T    $F      $F $F "INVARIANTS P26_NeverSavesStorageWithNothingRecorded P27_NeverSavesStorageWithAPackage P28_NeverWarnsOfTheStorage P29_NeverSavesStorageAfterTheTraceFailedToStart P30_NeverSavesStorageAfterAFailedStartsTraceIsGone P31_NeverSavesStorageAfterAFailedWrite" $F $F "$LR" $F $F $F $F $F $T $T $F $F $F $T
# The three charts.
mk Chart-Lifecycle  "INIT Init
NEXT LifeNext" 0 1 1 2 0 1 $T $F $F $F $T $F $F $F "INVARIANTS $HOLD" $F $F "$LEFT"
mk Chart-Gate       "INIT StartedRecording
NEXT GateNext" 1 2 1 1 0 0 $T $F $F $F $T $F $F $F "INVARIANTS R01_HeldClickReachesThePageOnce R02_OneBeforeOneAfter X2_SnapshotsInTimeOrder" $F $F "$LEFT"
mk Chart-Fill       "INIT StartedRecording
NEXT FillNext" 2 1 1 1 1 0 $F $F $F $F $T $F $F $F "INVARIANTS F1_ShowsOnceItHasItsPlace F2_StaysInPlace F3_NextActionMakesItFinal F4_StopAndFinishKeepLastText" $F $F "$LEFT"
ls *.cfg
