# Lookup log

Proposal (continued without user settlement as instructed): repository, pulls and releases pages; shared breadcrumb; repeated pull rows; clone panel. Test follows all eight kept interactions. No discarded entries found.

Trace commands below count snapshot queries per lookup; opening the trace was one additional shared setup command. All three queries used after phase. Queries were run before implementation, but this log was written after the first test launch, rather than incrementally; that is a process deviation.

| Element / package ref | Need | Package selector? | Found by | Trace commands | Confidence |
|---|---|---|---|---|---|
| Clone panel e4344 | Component root | No | Content and ancestors of GitHub CLI button at position 152; div.tmp-m-3 containing Remote URL selector | 1 | High; CSS class is presentation based, constrained by semantic child |
| Pull title e1483 | Recorded visibility assertion and stable locator | Yes, role/link | Content and ancestors at position 54; discovered data-testid=listitem-title-link | 1 (shared with next entry) | High |
| Pull row containing e1483 | Repeated component boundary | No | Content and ancestors of title, li with descriptive aria-label | 1 (same query) | High |
| Release title e2798 | Recorded visibility assertion | Yes, region then role/link | Content and ancestors at position 111; two links exist, recorded region disambiguates | 1 | High |

Totals: 4 element lookups; package selector 0; role/name 0; content/ancestors 4; other 0; not found 0. Three distinct snapshot commands plus trace open. No uncertain or failed element lookup.

Package-only locator choices (not trace lookups): Pull requests e104 uses role/name prefix to avoid volatile count; breadcrumb e77 scoped to named navigation; Releases e2613 exact role/name; Code e3457 exact role/name; CLI e4359 translated to actual button e4358 as skill advises. HTTPS e4363 and command e4384 use named textboxes supplied by tree. These needed no additional trace queries.

Compromises: clone root uses CSS because no named container exists in inspected subtree. It contains all clone controls but excludes repository actions, which this test never touches. Release entries stay plain named link locators since the flow reads no other parts of a release. Pull row component is provided but assertion uses the page's title collection, avoiding a race in enumerating rows.

Skill wording: discarded-entry section says use interaction.id for trace commands, contradicting later stock-trace instructions requiring position numbers; not applicable here. Package output was too large for one tool read and was truncated; extracted all eight interactions separately and inspected relevant trace snapshots. No alternative flow or weaker assertion was substituted.

Environment deviation: project Devbox shell was not started because that would read repository configuration outside the permitted kit. Commands use the explicitly supplied standalone Playwright installation. Browser requests are restricted in config to github.com; npm installation used registry only.

Live outcome: two browser runs reached and passed the pull-title check, returned via breadcrumb, then timed out waiting for the Releases link. The failure snapshot shows a Releases heading without its link, and an unstyled expanded navigation. Restricting requests to github.com blocks GitHub's external asset hosts, preventing the recorded UI from fully loading. Cannot allow these hosts under the brief. No navigation substitution was attempted. The second run also had an ESM-incompatible diagnostic hook; removed it after inspecting the failure snapshot. This did not cause the primary click timeout. Initial module resolution failure was fixed with output/node_modules symlink.

The live missing Releases link is an additional lookup, not a trace lookup: e2613, needed for step locator, selector supplied by package, not found in live failure snapshot, zero trace commands, high confidence absent under host restriction. Overall totals including this failed lookup: 5; package selector 0; role/name 0; content/ancestors 4; other 0; not found 1.
