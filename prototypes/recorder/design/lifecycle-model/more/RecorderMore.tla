---------------------------- MODULE RecorderMore ----------------------------
\* Narrower checks on the same model, each to confirm one sentence of the
\* report that the shortest path of a broader rule does not show.
EXTENDS Recorder

\* Something done while paused never ends up in the timeline.
M1_PausedClickNeverRecorded == \A i \in tl : made[i].phase # "paused"

\* Something done while recording, before a Clear, never ends up in the
\* timeline of the next recording.
M2_ClickBeforeClearNeverComesBack ==
  \A i \in tl : ~(made[i].phase = "recording" /\ made[i].gen < gen)

\* A held click is in the saved package (it was made before Finish).
M3_HeldClickIsSaved ==
  pkg # "none" =>
    \A i \in Inputs :
      (heldEver[i] /\ made[i].phase = "recording" /\ made[i].gen = gen
         /\ at[i] = "page" /\ ev[i] # "lost") => i \in pkgHas
=============================================================================
