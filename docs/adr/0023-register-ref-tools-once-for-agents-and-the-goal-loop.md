---
status: accepted
---

# Ref Tools are one registration, visible to agents and to the Goal Loop

An operation on a Structural Ref is registered once. That registration publishes it as a WebMCP Tool for the calling agent and offers it to the Goal Loop as an operation. Click and fill are the built-in Ref Tools. There is no per-tool visibility flag and no flag that ends a Goal Loop run; the model judges whether the goal is met after every step.

A Ref Tool's `filter` limits only which elements the Goal Loop offers the model; it is not enforced for a direct call. Without a `filter`, every node with a ref is offered, because an app's tool may apply to non-interactive elements. Ayme has no pointing or highlighting concept; that is an app's Ref Tool.

Rejected: separate registrations for agents and for the Goal Loop (two lists to keep in step), and a loop-only tool kind (an app that does not use the Goal Loop would lose the tool for its own agent).
