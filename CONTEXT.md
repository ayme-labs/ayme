# Ayme WebMCP

Ayme WebMCP exposes selected Page Object behavior as WebMCP Tools while keeping the Page Object Model as the source of that behavior.

## Language

**Page Object Model (POM)**:
A class that describes a page or a meaningful part of a page through the elements and actions it provides. A class is one when it is marked as such, directly or through a class it extends; being used by a POM does not make a class one.

**Page Object**:
An instance of a Page Object Model. It represents one occurrence of the page or part of a page described by that model.

**Page Object Child**:
A named part of a Page Object. It may refer to one or more elements, or to one or more Page Objects.

**Page Object Action**:
A meaningful operation provided by a Page Object.

**Generated WebMCP Tool**:
A WebMCP Tool generated from a Page Object Action selected for WebMCP exposure.

**Structural Page State**:
A model-facing observation of the currently presented page structure and its Page Object associations. Normally scrollable content and modal-blocked content remain represented. Known hidden or unreachable off-canvas Page Object subtrees are omitted. Structural inclusion does not imply interaction availability.

**Structural Ref**:
A capture-scoped address for a node in Structural Page State. The ref itself has no identity guarantee across captures; within a Page State Session, an earlier ref may resolve to the current incarnation of a reconciled node.

**Page State Session**:
The lifetime within one browser document during which Ayme maintains best-effort continuity between successive Structural Page States.

**Page Object Root**:
The page element that anchors one Page Object instance in the observed structure.

**Page Object Presence**:
Whether a rooted Page Object can be associated with rendered UI in the current layout's normally scroll-reachable area, independently of modal blocking or obstruction.

**Page Object Availability**:
Whether a live Page Object is currently available for interaction through its root in the user-facing page. Rooted Page Objects must be present to be available. Page Objects without a root retain registration-driven availability. DOM presence alone does not imply either structural presence or availability.

**Ref Tool**:
An operation that applies to one Structural Ref. Click and fill are built in; an app may register its own. One registration makes it a WebMCP Tool and an operation the Goal Loop may choose.

**Settled Page**:
A page that has shown no activity for a quiet window after an action. A wait for it is bounded by a deadline and reports whether the page became stable.

**Change Record**:
What changed around an action: the difference between the Structural Page State the caller last received and the Settled Page after the action.

**Goal Loop**:
Drives the page toward a natural-language goal in steps. Each step is one judgement by a System One model (a fast model that picks among given options, currently Jev), not by the calling agent's LLM. The calling agent starts it and receives a Handover.

**Handover**:
The Goal Loop returning control to the calling agent, with the reason it stopped, what it did, and what to do next.

**Decision Endpoint**:
The route in an app's own backend that adds the model key to a decision request and forwards it to the model provider. Ayme provides its definition; the app deploys and gates it.
_Avoid_: relay (means the WebMCP local relay), proxy.
