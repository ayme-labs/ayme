---
status: accepted
---

# A project keeps everything ayme in one `ayme` folder, without a dot

## Why

A project needs one place for its Page Object Models, for what ayme's skills write, and for what ayme's tools generate. That place was `.ayme/`, and the dot broke Angular.

Angular's dev server ignores every folder whose name starts with a dot. With Page Object Models in `.ayme/pom/`, on older Angular versions and when the dev server polls for changes, an edit to one of them, or to a type one imports, rebuilt nothing. A watcher in ayme's Angular plugin forced the rebuild, but Angular's own type check went on reading the file as it was when the dev server started. Using a member just added to a Page Object Model then failed the build. In a trial of the same app on one Angular version, with the folder renamed to `ayme/`, each edit rebuilt once and the build had no such error.

## Decision

A project keeps everything ayme in one folder, `ayme/`, at its root, beside `package.json`.

- Page Object Models live in `ayme/pom/`, one class per file, whether or not the app ships ayme.
- App code and tests import a Page Object Model through one alias in the app's `package.json`, `#pom/*`, so an import reads the same from any file. Files inside the folder import each other by relative path.
- What people and skills write in the folder is committed. What a tool generates there is ignored, through the folder's own `.gitignore`.
- No tool reads `.ayme/` as a fallback.

## Considered and rejected

- `.ayme/` as a package of its own, imported by package name. The Angular dev server still ignores it, and a subclass outside the folder silently gets no tools.
- `.ayme/` with a watcher in ayme's Angular plugin. Rebuilds worked, but Angular's own type check could not be reached, and the plugin would depend on Angular's internals.
- Page Object Models in `pom/` beside `.ayme/`. It works, and splits the home in two.

## Cost

A project that used `.ayme/` moves it, and changes its imports and aliases with it.
