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

**Page Object Tool**:
A tool generated from a Page Object Action marked for exposure. The Goal Loop may choose it, and WebMCP publication offers it to agents.

**Structural Page State**:
A model-facing observation of the currently presented page structure and its Page Object associations. Normally scrollable content and modal-blocked content remain represented. Known hidden or unreachable off-canvas Page Object subtrees are omitted. Structural inclusion does not imply interaction availability.

**Structural Ref**:
A capture-scoped address for a node in Structural Page State. The ref itself has no identity guarantee across captures; within a Page State Session, an earlier ref may resolve to the current incarnation of a reconciled node.

**Page State Session**:
The lifetime within one browser document during which Ayme maintains best-effort continuity between successive Structural Page States. It also records the document's interaction history: its Visits, the actions taken and what each caused.

**Visit**:
One stretch of a Page State Session between navigations: from document load, or from a same-document navigation, to the next. Interaction history is scoped by Visits.

**Page Object Root**:
The page element that anchors one Page Object instance in the observed structure.

**Page Object Presence**:
Whether a rooted Page Object can be associated with rendered UI in the current layout's normally scroll-reachable area, independently of modal blocking or obstruction.

**Page Object Availability**:
Whether a live Page Object is currently available for interaction through its root in the user-facing page. Rooted Page Objects must be present to be available. Page Objects without a root retain registration-driven availability. DOM presence alone does not imply either structural presence or availability.

**Browser Tool**:
A built-in operation on the page itself, as opposed to one a Page Object provides. It addresses its target by Structural Ref or by selector. One that acts on a single element is also an operation the Goal Loop may choose.

**Locator Recommendation**:
A Playwright locator string derived for one element, optionally relative to a container element. It matches exactly that element and never contains a Structural Ref. It is code for a Page Object Model, not an address for a later tool call.
_Avoid_: selector suggestion

**Custom Tool**:
An operation an app registers that applies to one element. One registration makes it a published tool and an operation the Goal Loop may choose.

**Settled Page**:
A page that has shown no activity for a quiet window after an action. A wait for it is bounded by a deadline and reports whether the page became stable.

**Change Record**:
What changed around an action: the difference between the Structural Page State the caller last received and the Settled Page after the action. It is read in two parts: what changed before the action, and what the action changed.

**Run**:
One execution of a tool, from its start to its outcome. It is started by a Caller, or inside another Run, which is then its parent. A goal Run's children are the Runs its Goal Loop's steps executed; a Custom Tool's children are the Runs it starts.
_Avoid_: tool call, invocation

**Caller**:
Whoever starts a top-level Run from outside: an agent through WebMCP or the Ayme MCP server, the Inspector, or the app's own code. A Caller names itself. A Run started inside another Run has a parent instead.

**Interaction**:
One input a Run gives the page: a click, fill, key press, hover or selection on one element. A Run's Interactions are the ones it performed itself; its child Runs have their own.
_Avoid_: step, page operation, action (on its own)

**Goal Loop**:
Drives the page toward a natural-language goal in steps. Each step is one judgement by a System One model (a fast model that picks among given options, currently Jev), not by the calling agent's LLM. The calling agent starts it and receives a Handover.

**Goal Values**:
Labelled strings or numbers the calling agent passes with a goal. At any step the Goal Loop may pick one for a parameter it cannot fill from the page; it never writes a value itself.

**Handover**:
The Goal Loop returning control to the calling agent, with the reason it stopped, what it did, and what to do next.

**Decision Endpoint**:
The route in an app's own backend that adds the provider's key and Jev model to a decision request and forwards it to that provider. Ayme provides its definition; the app deploys and gates it.
_Avoid_: relay (means the WebMCP local relay), proxy.

**Inspector**:
The in-page panel that shows a page's Page Objects, its Structural Page State and its tools, and lets a developer run those tools by hand.
_Avoid_: debug panel, debugger, POM inspector

**Demo Mode**:
The Inspector's setting for showing people what an agent does: it pauses briefly before each action and shows a cue where each click lands, whoever makes the call (the panel, an agent or WebMCP). Off by default, so calls run at full speed.
_Avoid_: slow mode, demo trace

**Agent Connection**:
The link between one coding agent's Ayme MCP server and one page, plus the App Processes paired beside it, through which the agent calls their tools.

**Peek**:
A named view of application state that a coding agent can read on demand while the app runs, from the browser or from the app's own server process. Reading it changes nothing.

**Peek Tool**:
The tool through which an agent reads one Peek, from every live instance of it.

**App Process**:
A Node process of the app being developed, such as its dev server, that pairs beside the page.
