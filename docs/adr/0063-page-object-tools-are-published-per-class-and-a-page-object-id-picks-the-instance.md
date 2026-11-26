---
status: accepted
supersedes: ADR-0043, ADR-0059
---

# Page Object Tools are published per class, and a Page Object Id picks the instance

## Why

A Page Object Tool was named by the member path from the registered Page Object that reached it, while the page state and an action's return type named the class. An agent read that a call showed a class and had to find its tool under a path prefix, and a class reached from several places, or from several registered Page Objects, was published once per path, with collections given a tool shape of their own.

An agent then named the instance by the Structural Ref of its root, read from ayme's page state. But ayme sits next to Playwright, which prints refs of the same shape for every other element. An agent holding both could pass Playwright's ref where ayme's was meant, and the call ran on whatever that ref resolved to, without failing.

## Decision

ayme publishes one Page Object Tool per Page Object Action of a class, named after the class. Class names are already unique across everything registered, so they are safe as the tool namespace. Path names go, with no aliases.

- A tool of a class with a Page Object Root takes the Page Object Id of the instance, which picks it wherever it was reached: in a Child Collection, at any depth of a recursive tree, or as a single child. The tool is listed while any instance is present, and availability is judged per instance at the call.
- A tool of a class without a root takes no id. A root-less class reached from more than one place, a child of a collection item included, is refused, by the build where it can prove it and at registration otherwise: nothing could pick between its instances.
- The page numbers its Page Objects in the order it first shows them. The id belongs to the Page Object, its class and its root element: two classes rooted at one element are two Page Objects with two ids, and each class's tools take only its own. Two instances of one class on one root element are one Page Object with one id, since a model whose members hang off its root resolves them to the same elements.
- An id stays with its Page Object while the root element is on the page and is never given to another, so an agent can keep it across calls without reading the page again. After a full page load the old ids mean nothing: the new document has new Page Objects.
- A malformed id is refused as wrong input. An id whose Page Object is gone fails with the reason only.
- A Page Object Id is not a Structural Ref, and neither stands in for the other. The id lives in the Page Object module of the ayme package, as a type of its own that cannot be mixed with a Structural Ref, and core's structural observation model does not change for it. A ref stays the address of a node in one capture and names elements only, for Browser Tools and Custom Tools.
- The Structural Page State marks each Page Object Root with its class and shows the id beside it, so the names an agent reads are the names it calls. The Goal Loop and the Inspector pass the id too.

## Considered and rejected

- Keeping path names. They publish a class once per path and leave the agent two vocabularies.
- Class names with the path as an argument. The agent would have to know the model's tree to call a tool.
- Leaving the root's ref out where a class has one instance. Deferred while the ref picked the instance, since making it optional later breaks no caller. The id replaced the ref without revisiting that deferral.
- Naming the instance by its root's Structural Ref, with the description saying which refs to use. The wrong-element call stays silent, and an agent may ignore the description.
- Accepting both a ref and an id for good. The wrong-element call stays possible as long as the ref is accepted.
- Keeping the id in core's structural observation model. It addresses nodes of a single capture, and an id that outlives captures and belongs to a Page Object is not that.
- Listing only existing ids in the tool's schema. The schema goes stale as soon as the page changes, and would refuse an id the agent just read.
- One id per root element, shared by every class rooted there. The id would not say which Page Object it names, and a tool of one class would take the id an agent read for another.

## Cost

Every call to a rooted Page Object carries an id, even when only one instance exists. A root-less class shared by two parents needs a root before it registers. A caller that named a tool by its path finds no alias, and application code that called a rooted Page Object Tool by ref breaks. Agents have a second kind of name to tell apart from refs.
