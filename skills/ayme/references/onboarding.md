# Onboarding

1. Inspect the project's package manager, bundler, framework, and existing POMs.
2. Follow the quickstart for the project's framework, linked from
   [Install](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/install.md). Its framework page, linked from the
   [documentation index](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md), covers what the quickstart leaves out,
   such as server rendering and Angular's manual steps.
3. Expose one of the project's existing actions on an existing POM, as
   [Page Object Models](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md) describes, in place of
   the quickstart's `CounterPage`.
4. For a framework without an Ayme package, report that gap and stop at the
   documented integrations.
5. Follow [Browser setup](browser-setup.md), then invoke the exposed action
   through the client.

When installing the skill elsewhere, keep the references directory and these
links.

Finish by reporting the packages and wiring changed, the action invoked, and
its observed effect. If browser or client access is unavailable, distinguish
successful build checks from the invocation still outstanding.
