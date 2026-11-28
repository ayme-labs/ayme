# Onboarding

1. Inspect the project's package manager, bundler, framework, and existing POMs.
2. Follow the quickstart for the project's framework, linked from
   [Install](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/install.md). Its framework page, linked from the
   [documentation index](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md), covers what the quickstart leaves out,
   such as server rendering, Angular's manual steps and optional WebMCP
   publication.
3. Expose one of the project's existing actions on an existing POM, as
   [Page Object Models](ayme-page-objects.md) describes, in place of
   the quickstart's `ProjectsPage`.
4. For a framework without an ayme package, report that gap and stop at the
   documented integrations.
5. Set the project up for the `ayme` command as
   [Browser setup](browser-setup.md) says, start a Session beside your
   browser automation as
   [Browser automation tools](browser-automation-tools.md) says, then invoke
   the exposed action with `ayme call`.

Finish by reporting the packages and wiring changed, the action invoked, and
its observed effect. If browser or client access is unavailable, distinguish
successful build checks from the invocation still outstanding.
