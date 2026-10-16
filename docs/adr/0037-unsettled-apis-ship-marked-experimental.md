---
status: accepted
---

# Unsettled APIs ship marked experimental

Ayme is source-available and built on `main`, and some features we mean to keep land before their API has settled. Such an API ships in the published packages marked experimental: we intend to keep the feature, but its names, options and behaviour may change in any release without a migration note. The mark is TSDoc's `@experimental` tag on what a consumer calls or sets to use the feature, plus an entry on the guide's Experimental APIs page. The docs check fails when the two disagree, so that page is the only list and no ADR names what is on it. Work that isn't ready even for that stays unmerged on its branch. We rejected three alternatives. A private fork that gets work first and passes finished work upstream would add a sync to every change, while the source is public anyway. A runtime flag would mean every experimental feature had to be threaded through the runtime and each framework package. An `experimental` subpath export would break every import when the feature graduates.
