---
status: accepted
supersedes: ADR-0026
---

# Test support lives beside src and is never published

Test support is the code only tests may use: page objects of our own UI, fakes for a seam the product depends on, builders and harnesses. ADR-0026 kept it in `src` and built it as a second entry, which the published packages also published so that consumers could test their own integration. We know of no consumer that did, no other repository of ours imported a published entry, and the guide never documented one. That entry still cost every consumer an install: a package depended on a library only its test entry used.

We decided that all of a package's test support lives in one `testing/` folder beside `src`, and that it is never built and never published. `src` keeps the product and the tests next to the units they test. Other workspaces import test support from source through the package's `testing` entry, which resolves to the folder's front door; the rest of the folder is for the package's own tests. Only test files may import it, which lint enforces.

## Considered options

- A documented test kit, published from the packages a consumer could plausibly use. Publishing means documenting it and keeping it stable, and nobody has asked. If someone does, it comes back as product code in `src`.
- The same folder as a build entry, left out of the tarball when the package is packed. It still compiles test code into `dist`, which importing from source makes unnecessary.
- A private workspace package per owner. No manifest needs an entry left out, but it adds a workspace per package and separates the test support from the package it describes.
- A path alias in each importing workspace. Every importer repeats it in its TypeScript and its runner configuration.

## Consequences

- The importing workspace compiles the test support, so it cannot contain source that needs its package's own build. ayme's In-page Module is such source: a build plugin makes it, and a document holds one copy of it (ADR-0049). The Inspector's tests need the runtime side of the Inspector contract from the same build as the Inspector they test, so that part lives in ayme's internal entry, not in test support; what the example app's tests read of the Goal Loop lives there for the same reason. ayme therefore has no `testing` entry for other workspaces.
- A test that imports a package's test support from source and also imports the built package loads that package's modules twice, and the two copies share no state. The recorder fixture does this, and each of its tests uses only one copy.
- A published package lists the `testing` entry in its exports for the workspace and omits it from the manifest it publishes. Packing replaces the exports whole, so such a package states its exports twice. The package verification lane checks that the two agree and that no tarball carries test support.
- A subfolder of `testing/` named after a slice belongs to that slice: it may use the slice's own files, and other slices through their front doors (ADR-0046). The layer order does not apply to it.
- Two places that are not test files may import test support: the example certification app, whose product is test builders, and the inspector fixture's dogfood page object, which registers the Inspector's page objects as its own. The fixture keeps a TypeScript path alias for that one import, because the ayme plugin derives a page object's metadata only from a file of the project.
- Fixtures that sit next to the one test that reads them stay in `src`.
