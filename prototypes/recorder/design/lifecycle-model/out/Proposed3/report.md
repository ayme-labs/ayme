# Recorder

TLC reached 24,095,359 states, more than the chart budget of 500, so the command wrote no chart.mmd.

## Rules that hold
R01_HeldClickReachesThePageOnce, R02_OneBeforeOneAfter, R03a_StoppedClicksAreUntouched, R03b_StoppedAddsNothing, R03c_TracingRunsThroughPause, R04_FinishSavesEverything, R05_ClearLeavesNothing, R06_ReviewOnlyWhilePaused, R07_AssertionCarriesNoChanges, R09_NeverHalfWritten, R10_SavesOnce, X1_NothingOvertakesAHeldClick, X2_SnapshotsInTimeOrder, X3_NothingYouDidIsDropped, X4_WrapUpNeverGetsStuck, NoDeadlock
