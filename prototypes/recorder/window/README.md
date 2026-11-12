# Recorder window trial

Throwaway extension of [the recorder prototype](../README.md), on gate-b.
No package, dependency, lockfile or released source files added. No change to
`lib/recorder.mjs` or `lib/package.mjs`.

From the repo root, after the prototype's install and core build:

```sh
devbox run -- node prototypes/recorder/window/trial.mjs
```

This opens the local fixture in visible Chromium and prints **Recorder window**.
Open that URL in any browser. The window is deliberately not opened in the
recorded context. Click Other, type slowly in Name, click the shadow and iframe
buttons, and click Notify later then wait. Hover badges in the window. Click
Assert visibility in either surface, move over a page element, then click it.
Click Finish in either surface. The window says finished; the terminal prints
the package path. Ctrl+C closes the trial's browser and local server.

`--url https://www.saucedemo.com`, `--pw 1.62`, `--out /absolute/output/path`
and `--headless` are optional. Defaults write under `window/out/`: recording
JSON/text, stock `trace.zip`, event journal and a released-format Recording
Package in `.ayme/recordings/`. Keep these local: traces can contain page data.

Verification (raw CDP inputs, no Playwright input actions):

```sh
devbox run -- node prototypes/recorder/window/probe.mjs 1.65
devbox run -- node prototypes/recorder/window/probe.mjs 1.62
devbox run -- node prototypes/recorder/window/probe.mjs 1.65 --headed
devbox run -- python3 prototypes/recorder/window/trace-audit.py prototypes/recorder/window/out/pw-1.65/trace.zip
```

The probe asserts toolbar gate exclusion and focus preservation, hidden UI in
ARIA, own pick drawing, assert action delivery, fill updates with the same id,
main/iframe/shadow hover lookup, removed lookup, unchanged layout, pending late
changes, a second visit, window controls and finishing from both surfaces.
`evidence/` contains summaries, not the trace archives. See [FINDINGS.md](FINDINGS.md)
for what these checks do and do not establish.
