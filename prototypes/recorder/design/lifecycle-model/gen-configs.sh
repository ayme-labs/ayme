#!/bin/sh
# Writes every .cfg from one table. Order of the ten switches:
# WaitGate WaitHeld WaitReports RecorderOff GateStartsRight NewerCloses KeepOrder AssertWaits IgnoreSecondStop Revisions
cd "$(dirname "$0")"
RULES="R01_HeldClickReachesThePageOnce R02_OneBeforeOneAfter R03a_StoppedClicksAreUntouched R03b_StoppedAddsNothing R03c_TracingRunsThroughPause R04_FinishSavesEverything R05_ClearLeavesNothing R06_ReviewOnlyWhilePaused R07_AssertionCarriesNoChanges R09_NeverHalfWritten R10_SavesOnce X1_NothingOvertakesAHeldClick X2_SnapshotsInTimeOrder X3_NothingYouDidIsDropped X4_WrapUpNeverGetsStuck"
mk() { # name head N MaxDoc Surfaces flags(10) tail
  name=$1; head=$2; n=$3; maxdoc=$4; surf=$5; shift 5
  {
    printf '%s\n' "$head"
    cat <<CFG
CONSTANTS
  N = $n
  MaxDoc = $maxdoc
  MaxGen = 1
  Surfaces = $surf
  WaitGate = $1
  WaitHeld = $2
  WaitReports = $3
  RecorderOff = $4
  GateStartsRight = $5
  NewerCloses = $6
  KeepOrder = $7
  AssertWaits = $8
  IgnoreSecondStop = $9
  Revisions = ${10}
CFG
    printf '%s\n' "${11}"
  } > "$name.cfg"
}
IN="INIT Init
NEXT Next"
T=TRUE; F=FALSE
ALL="INVARIANTS $RULES"
mk Simple            "$IN" 2 2 $F  $F $F $F $F $F $F $F $F $F $F "$ALL"
mk SimpleRest        "$IN" 2 2 $F  $F $F $F $F $F $F $F $F $F $F "INVARIANTS R02_OneBeforeOneAfter R03c_TracingRunsThroughPause R06_ReviewOnlyWhilePaused R10_SavesOnce X4_WrapUpNeverGetsStuck"
mk Proposed          "$IN" 2 2 $F  $T $T $T $T $T $T $T $T $T $T "$ALL"
mk Proposed3         "$IN" 3 2 $F  $T $T $T $T $T $T $T $T $T $T "$ALL"
mk No1-WaitGate      "$IN" 2 2 $F  $F $T $T $T $T $T $T $T $T $T "$ALL"
mk No2-WaitHeld      "$IN" 2 2 $F  $T $F $T $T $T $T $T $T $T $T "$ALL"
mk No3-WaitReports   "$IN" 2 2 $F  $T $T $F $T $T $T $T $T $T $T "$ALL"
mk No4-RecorderOff   "$IN" 2 2 $F  $T $T $T $F $T $T $T $T $T $T "$ALL"
mk No5-GateStartsRight "$IN" 2 2 $F $T $T $T $T $F $T $T $T $T $T "$ALL"
mk No6-NewerCloses   "$IN" 2 2 $F  $T $T $T $T $T $F $T $T $T $T "$ALL"
mk No7-KeepOrder     "$IN" 2 2 $F  $T $T $T $T $T $T $F $T $T $T "$ALL"
mk No8-AssertWaits   "$IN" 2 2 $F  $T $T $T $T $T $T $T $F $T $T "$ALL"
mk No9-IgnoreSecondStop "$IN" 2 2 $F $T $T $T $T $T $T $T $T $F $T "$ALL"
mk Question-WrongPage "$IN" 2 2 $F $T $T $T $T $T $T $T $T $T $T "INVARIANT Q1_ClickLandsWhereItWasMade"
mk Probes            "$IN" 2 2 $F  $T $T $T $T $T $T $T $T $T $T "INVARIANTS P1_NeverSavesTwoEntries P2_NeverSavesADiscard P3_NeverRecordsAnAssertionAfterAClick P4_NeverRecordsANavigation P5_NeverCutsASettleShort P6_NeverClearsThenRecordsAgain P7_NeverHoldsAClickDuringWrapUp P8_NeverEndsEmptyAfterRecording P9_NeverSavesWithPageClosed"
mk Path-No6-ClickThenTyping "$IN" 2 2 $F $T $T $T $T $T $F $T $T $T $T "INVARIANTS T1_ClickThenTypingInTimeOrder T2_ClickThenAssertionInTimeOrder"
mk Path-No1-StuckAfterSaving "$IN" 2 2 $F $F $T $T $T $T $T $T $T $T $T "INVARIANT T3_NoClickStuckAfterSaving"
mk Path-No2-StuckAfterSaving "$IN" 2 2 $F $T $F $T $T $T $T $T $T $T $T "INVARIANT T3_NoClickStuckAfterSaving"
mk Surfaces          "$IN" 1 2 $T  $T $T $T $T $T $T $T $T $T $T "INVARIANTS R08_SurfacesAgree $RULES"
mk Surfaces-No10-Revisions "$IN" 1 2 $T $T $T $T $T $T $T $T $T $T $F "INVARIANT R08_SurfacesAgree"
mk Progress          "SPECIFICATION LiveSpec" 2 2 $F $T $T $T $T $T $T $T $T $T $T "PROPERTIES L1_HeldClickIsPassedOn L2_WrapUpEnds"
mk Chart-Lifecycle   "INIT Init
NEXT LifeNext" 1 1 $F $T $T $T $T $T $T $T $T $T $T "INVARIANTS $RULES"
mk Chart-Gate        "INIT GateInit
NEXT GateNext" 1 2 $F $T $T $T $T $T $T $T $T $T $T "INVARIANTS R01_HeldClickReachesThePageOnce R02_OneBeforeOneAfter X2_SnapshotsInTimeOrder
CHECK_DEADLOCK FALSE"
ls *.cfg
